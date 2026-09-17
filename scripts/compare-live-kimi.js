/**
 * Live prompt comparison runner for Kimi K3.
 * Compares git HEAD (previous) vs working tree (uncommitted) prompts.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { performance } = require('perf_hooks');

// Read API key
let apiKey = process.env.FIREWORKS_API_KEY;
if (!apiKey && fs.existsSync(path.resolve(__dirname, '../.env.local'))) {
  const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
  const match = envContent.match(/FIREWORKS_API_KEY=(.+)/);
  if (match) apiKey = match[1].trim();
}

if (!apiKey) {
  console.error('ERROR: FIREWORKS_API_KEY not found.');
  process.exit(1);
}

const { verifyPlan } = require('../src/lib/verify-plan.js');
const {
  FIREWORKS_API_URL,
  buildFireworksPayload,
  createFireworksStreamExtractor,
  parseFireworksErrorText
} = require('../src/lib/fireworks.js');

const targetDay = (process.argv[2] || 'MONDAY').toUpperCase();

// Load config
const backupConfigPath = path.resolve(__dirname, '../backups/2026-09-01/configs.json');
const configs = JSON.parse(fs.readFileSync(backupConfigPath, 'utf8'));
const config = configs[0];

// Compilers
const currentCompiler = require('../src/lib/compile-prompt.js');
const prevCode = execSync('git show HEAD:src/lib/compile-prompt.js', { encoding: 'utf8' });
const prevCompilerPath = path.resolve(__dirname, '../.tmp_compile_prompt_prev.js');
fs.writeFileSync(prevCompilerPath, prevCode);
const prevCompiler = require(prevCompilerPath);

async function* parseSSEResponse(response, customExtractor) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const chunk = customExtractor(parsed);
          if (chunk.text || chunk.thought || chunk.finishReason) {
            yield chunk;
          }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function runModelStream(label, prompt) {
  const modelId = process.env.MODEL_ID || 'accounts/fireworks/routers/kimi-k3-fast';
  const payload = buildFireworksPayload(modelId, prompt, {
    temperature: 0.1,
    stream: true,
    maxTokens: 16384,
    reasoningEffort: 'low'
  });

  console.log(`\n========================================================================`);
  console.log(` Starting run: ${label}`);
  console.log(` Prompt length: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  console.log(` Model: ${modelId} (reasoningEffort: "low", maxTokens: 16384)`);
  console.log(`========================================================================`);

  const startTime = performance.now();
  const response = await fetch(FIREWORKS_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(parseFireworksErrorText(errorText, `HTTP ${response.status}`));
  }

  const extractor = createFireworksStreamExtractor();
  let fullText = '';
  let fullThought = '';
  let finishReason = '';
  let firstTokenTime = null;
  let lastDot = 0;

  process.stdout.write(`  Streaming: `);
  for await (const chunk of parseSSEResponse(response, extractor)) {
    if (!firstTokenTime) {
      firstTokenTime = (performance.now() - startTime) / 1000;
    }
    if (chunk.finishReason) finishReason = chunk.finishReason;
    if (chunk.thought) fullThought += chunk.thought;
    if (chunk.text) fullText += chunk.text;

    // print progress dots
    const totalChars = fullThought.length + fullText.length;
    if (totalChars - lastDot > 1000) {
      process.stdout.write(`.`);
      lastDot = totalChars;
    }
  }

  const tail = extractor.flush();
  if (tail.thought) fullThought += tail.thought;
  if (tail.text) fullText += tail.text;

  const durationSec = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(` DONE in ${durationSec}s (TTFT: ${firstTokenTime ? firstTokenTime.toFixed(2) : '-'}s)`);
  console.log(`  Finish reason: ${finishReason || 'stop'}`);
  console.log(`  Reasoning characters: ${fullThought.length}`);
  console.log(`  Output characters: ${fullText.length}`);

  // Run verification
  console.log(`  Running verifier...`);
  const verification = verifyPlan(config, targetDay, fullText);
  console.log(`  Verification: ${verification.errorCount === 0 ? '✅ PASS' : '❌ FAIL'} (${verification.errorCount} errors, ${verification.warningCount} warnings)`);

  if (verification.issues && verification.issues.length > 0) {
    for (const issue of verification.issues) {
      console.log(`    - [${issue.severity.toUpperCase()}/${issue.category}] ${issue.message}`);
    }
  }

  return {
    label,
    prompt,
    durationSec,
    ttft: firstTokenTime ? firstTokenTime.toFixed(2) : '-',
    finishReason: finishReason || 'stop',
    thought: fullThought,
    text: fullText,
    verification
  };
}

async function main() {
  const prevPrompt = prevCompiler.compilePromptText(config, { mode: 'single', selectedDay: targetDay });
  const currPrompt = currentCompiler.compilePromptText(config, { mode: 'single', selectedDay: targetDay });

  const outDir = path.resolve(__dirname, '../benchmark-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. Run Previous Prompt
  const prevResult = await runModelStream('PREVIOUS PROMPT (HEAD)', prevPrompt);
  fs.writeFileSync(
    path.join(outDir, `kimi-k3-prev-${targetDay.toLowerCase()}.md`),
    `# Kimi K3 Fast - Previous Prompt (HEAD)\nDuration: ${prevResult.durationSec}s | TTFT: ${prevResult.ttft}s | Errors: ${prevResult.verification.errorCount} | Warnings: ${prevResult.verification.warningCount} | Finish: ${prevResult.finishReason}\n\n## Thinking\n${prevResult.thought}\n\n## Output\n${prevResult.text}`
  );

  // 2. Run New Prompt
  const newResult = await runModelStream('NEW PROMPT (UNCOMMITTED)', currPrompt);
  fs.writeFileSync(
    path.join(outDir, `kimi-k3-new-${targetDay.toLowerCase()}.md`),
    `# Kimi K3 Fast - New Prompt (Uncommitted)\nDuration: ${newResult.durationSec}s | TTFT: ${newResult.ttft}s | Errors: ${newResult.verification.errorCount} | Warnings: ${newResult.verification.warningCount} | Finish: ${newResult.finishReason}\n\n## Thinking\n${newResult.thought}\n\n## Output\n${newResult.text}`
  );

  // Clean up tmp compiler
  if (fs.existsSync(prevCompilerPath)) fs.unlinkSync(prevCompilerPath);

  // Save JSON summary
  const summary = {
    targetDay,
    timestamp: new Date().toISOString(),
    comparison: [
      {
        version: 'Previous Prompt (HEAD)',
        durationSec: prevResult.durationSec,
        ttft: prevResult.ttft,
        thoughtChars: prevResult.thought.length,
        outputChars: prevResult.text.length,
        finishReason: prevResult.finishReason,
        errorCount: prevResult.verification.errorCount,
        warningCount: prevResult.verification.warningCount,
        issues: prevResult.verification.issues
      },
      {
        version: 'New Prompt (Uncommitted)',
        durationSec: newResult.durationSec,
        ttft: newResult.ttft,
        thoughtChars: newResult.thought.length,
        outputChars: newResult.text.length,
        finishReason: newResult.finishReason,
        errorCount: newResult.verification.errorCount,
        warningCount: newResult.verification.warningCount,
        issues: newResult.verification.issues
      }
    ]
  };

  fs.writeFileSync(path.join(outDir, `kimi-k3-comparison-${targetDay.toLowerCase()}.json`), JSON.stringify(summary, null, 2));

  console.log(`\n========================================================================`);
  console.log(` COMPARISON SUMMARY `);
  console.log(`========================================================================`);
  console.log(`Metric                   | Previous (HEAD)       | New (Uncommitted)     `);
  console.log(`-------------------------|-----------------------|-----------------------`);
  console.log(`Errors                   | ${String(prevResult.verification.errorCount).padEnd(21)} | ${String(newResult.verification.errorCount).padEnd(21)}`);
  console.log(`Warnings                 | ${String(prevResult.verification.warningCount).padEnd(21)} | ${String(newResult.verification.warningCount).padEnd(21)}`);
  console.log(`Duration (s)             | ${String(prevResult.durationSec).padEnd(21)} | ${String(newResult.durationSec).padEnd(21)}`);
  console.log(`TTFT (s)                 | ${String(prevResult.ttft).padEnd(21)} | ${String(newResult.ttft).padEnd(21)}`);
  console.log(`Reasoning chars          | ${String(prevResult.thought.length).padEnd(21)} | ${String(newResult.thought.length).padEnd(21)}`);
  console.log(`Output chars             | ${String(prevResult.text.length).padEnd(21)} | ${String(newResult.text.length).padEnd(21)}`);
  console.log(`Finish reason            | ${String(prevResult.finishReason).padEnd(21)} | ${String(newResult.finishReason).padEnd(21)}`);
  console.log(`========================================================================\n`);
}

main().catch(err => {
  console.error(err);
  if (fs.existsSync(prevCompilerPath)) fs.unlinkSync(prevCompilerPath);
  process.exit(1);
});
