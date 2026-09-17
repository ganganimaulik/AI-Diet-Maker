/**
 * Streaming benchmark runner for Fireworks.ai models.
 * Tests candidate models using the same streaming and SSE parser logic
 * as the production whatsapp-worker.js.
 *
 * Usage:
 *   FIREWORKS_API_KEY="your_api_key" node scripts/benchmark-stream.js [DAY]
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const { compilePromptText } = require('../src/lib/compile-prompt.js');
const { verifyPlan } = require('../src/lib/verify-plan.js');
const {
  FIREWORKS_API_URL,
  DEFAULT_MAX_TOKENS,
  buildFireworksPayload,
  createFireworksStreamExtractor,
  parseFireworksErrorText
} = require('../src/lib/fireworks.js');

const CANDIDATE_MODELS = [
  {
    name: 'DeepSeek V4.1 Flash',
    id: 'accounts/fireworks/models/deepseek-v4p1-flash',
    reasoningEffort: 'low',
    maxTokens: 32768
  },
  {
    name: 'Kimi K3 Fast',
    id: 'accounts/fireworks/routers/kimi-k3-fast',
    reasoningEffort: 'low',
    maxTokens: 32768
  },
  {
    name: 'GLM 5.3 (Reasoning)',
    id: 'accounts/fireworks/models/glm-5p3',
    reasoningEffort: 'low',
    maxTokens: 32768
  },
  {
    name: 'Qwen 3.8 Max',
    id: 'accounts/fireworks/models/qwen3p8-max',
    reasoningEffort: 'low',
    maxTokens: 32768
  }
];

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

async function runModelStream(apiKey, candidate, prompt) {
  const payload = buildFireworksPayload(candidate.id, prompt, {
    temperature: 0.1,
    stream: true,
    maxTokens: candidate.maxTokens,
    reasoningEffort: candidate.reasoningEffort
  });

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

  for await (const chunk of parseSSEResponse(response, extractor)) {
    if (!firstTokenTime) {
      firstTokenTime = (performance.now() - startTime) / 1000;
    }
    if (chunk.finishReason) finishReason = chunk.finishReason;
    if (chunk.thought) fullThought += chunk.thought;
    if (chunk.text) fullText += chunk.text;
  }

  const tail = extractor.flush();
  if (tail.thought) fullThought += tail.thought;
  if (tail.text) fullText += tail.text;

  const durationSec = ((performance.now() - startTime) / 1000).toFixed(2);

  return {
    text: fullText,
    thought: fullThought,
    finishReason,
    firstTokenSec: firstTokenTime ? firstTokenTime.toFixed(2) : '-',
    durationSec
  };
}

async function main() {
  let apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey && fs.existsSync(path.resolve(__dirname, '../.env.local'))) {
    const envContent = fs.readFileSync(path.resolve(__dirname, '../.env.local'), 'utf8');
    const match = envContent.match(/FIREWORKS_API_KEY=(.+)/);
    if (match) apiKey = match[1].trim();
  }
  if (!apiKey) {
    console.error('ERROR: FIREWORKS_API_KEY not found in env or .env.local.');
    process.exit(1);
  }

  const targetDay = (process.argv[2] || 'MONDAY').toUpperCase();

  const backupConfigPath = path.resolve(__dirname, '../backups/2026-09-01/configs.json');
  const configs = JSON.parse(fs.readFileSync(backupConfigPath, 'utf8'));
  const config = configs[0];

  console.log(`\n========================================================================`);
  console.log(` 🥗 Fireworks AI Streaming Benchmark: AI Diet Generator `);
  console.log(` Target Day: ${targetDay}`);
  console.log(` Reasoning effort setting: "low" (to protect output token budget)`);
  console.log(`========================================================================\n`);

  const prompt = compilePromptText(config, { mode: 'single', selectedDay: targetDay });
  console.log(`Prompt size: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)\n`);

  const results = [];

  for (const candidate of CANDIDATE_MODELS) {
    console.log(`------------------------------------------------------------------------`);
    console.log(`Testing: ${candidate.name} (${candidate.id})`);
    process.stdout.write(`  Streaming generation: `);

    try {
      const result = await runModelStream(apiKey, candidate, prompt);
      console.log(`DONE in ${result.durationSec}s (TTFT: ${result.firstTokenSec}s)`);
      console.log(`  Finish reason: ${result.finishReason || 'stop'}`);
      console.log(`  Thinking characters: ${result.thought.length}`);
      console.log(`  Output content characters: ${result.text.length}`);

      // Verify plan
      console.log(`  Running deterministic verifier (verifyPlan)...`);
      const verification = verifyPlan(config, targetDay, result.text);
      const isClean = verification.errorCount === 0;

      console.log(`  Verification: ${isClean ? '✅ PASS' : '❌ FAIL'} (${verification.errorCount} errors, ${verification.warningCount} warnings)`);

      if (verification.issues && verification.issues.length > 0) {
        for (const issue of verification.issues.slice(0, 4)) {
          console.log(`    - [${issue.severity.toUpperCase()}/${issue.category}] ${issue.message}`);
        }
        if (verification.issues.length > 4) {
          console.log(`    ... and ${verification.issues.length - 4} more`);
        }
      }

      // Save output
      const outDir = path.resolve(__dirname, '../benchmark-results');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const safeName = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      fs.writeFileSync(
        path.join(outDir, `${safeName}-${targetDay.toLowerCase()}.md`),
        `# ${candidate.name} (${candidate.id})\nDuration: ${result.durationSec}s | Errors: ${verification.errorCount} | Finish: ${result.finishReason}\n\n## Thinking\n${result.thought || '(None)'}\n\n## Output\n${result.text}`
      );

      results.push({
        name: candidate.name,
        modelId: candidate.id,
        durationSec: result.durationSec,
        ttft: result.firstTokenSec,
        finishReason: result.finishReason,
        contentLen: result.text.length,
        thoughtLen: result.thought.length,
        errorCount: verification.errorCount,
        warningCount: verification.warningCount,
        passed: isClean
      });

    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({
        name: candidate.name,
        modelId: candidate.id,
        durationSec: '-',
        ttft: '-',
        finishReason: 'ERROR',
        contentLen: 0,
        thoughtLen: 0,
        errorCount: '-',
        warningCount: '-',
        passed: false,
        error: err.message
      });
    }
    console.log('');
  }

  // Print Summary Table
  console.log(`\n==================================================================================================`);
  console.log(`                                  FINAL BENCHMARK COMPARISON                                      `);
  console.log(`==================================================================================================`);
  console.log(
    `| ${'Model'.padEnd(25)} | ${'Pass/Fail'.padEnd(10)} | ${'Errors'.padEnd(7)} | ${'Warnings'.padEnd(9)} | ${'Time (s)'.padEnd(9)} | ${'TTFT (s)'.padEnd(9)} | ${'Output chars'.padEnd(12)} |`
  );
  console.log(`|---------------------------|------------|---------|-----------|-----------|-----------|--------------|`);
  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(25)} | ${(r.passed ? '✅ PASS' : '❌ FAIL').padEnd(10)} | ${String(r.errorCount).padEnd(7)} | ${String(r.warningCount).padEnd(9)} | ${String(r.durationSec).padEnd(9)} | ${String(r.ttft).padEnd(9)} | ${String(r.contentLen).padEnd(12)} |`
    );
  }
  console.log(`==================================================================================================\n`);
}

main().catch(console.error);
