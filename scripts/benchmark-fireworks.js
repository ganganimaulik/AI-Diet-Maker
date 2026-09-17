/**
 * Benchmark runner for Fireworks.ai models on AI Diet Maker.
 * Tests candidate models on a selected day (default: MONDAY), runs deterministic
 * verification on the outputs, and outputs a side-by-side comparison.
 *
 * Usage:
 *   FIREWORKS_API_KEY="your_api_key" node scripts/benchmark-fireworks.js [DAY]
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
  extractFireworksResponse,
  parseFireworksErrorText
} = require('../src/lib/fireworks.js');

// Candidate models to test
const CANDIDATE_MODELS = [
  {
    name: 'DeepSeek V4.1 Flash',
    id: 'accounts/fireworks/models/deepseek-v4p1-flash',
    reasoningEffort: 'medium'
  },
  {
    name: 'Kimi K3 Fast',
    id: 'accounts/fireworks/routers/kimi-k3-fast',
    reasoningEffort: 'max'
  },
  {
    name: 'GLM 5.3 (Reasoning)',
    id: 'accounts/fireworks/models/glm-5p3',
    reasoningEffort: 'max'
  },
  {
    name: 'Qwen 3.8 Max',
    id: 'accounts/fireworks/models/qwen3p8-max',
    reasoningEffort: 'medium'
  }
];

async function callFireworks(apiKey, modelId, prompt, reasoningEffort, maxTokens = DEFAULT_MAX_TOKENS) {
  const payload = buildFireworksPayload(modelId, prompt, {
    temperature: 0.1,
    stream: false,
    maxTokens: maxTokens,
    reasoningEffort: reasoningEffort
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

  const durationMs = performance.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(parseFireworksErrorText(errorText, `HTTP ${response.status}`));
  }

  const data = await response.json();
  const usage = data.usage || {};
  const extracted = extractFireworksResponse(data);

  return {
    ...extracted,
    durationSec: (durationMs / 1000).toFixed(2),
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0
  };
}

async function main() {
  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    console.error('ERROR: FIREWORKS_API_KEY environment variable is required.');
    process.exit(1);
  }

  const targetDay = (process.argv[2] || 'MONDAY').toUpperCase();

  // Load configuration
  let config;
  const backupConfigPath = path.resolve(__dirname, '../backups/2026-09-01/configs.json');
  if (fs.existsSync(backupConfigPath)) {
    const configs = JSON.parse(fs.readFileSync(backupConfigPath, 'utf8'));
    config = configs[0];
  } else {
    console.error('Backup configs.json not found, using default config.');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(` 🥗 Fireworks AI Model Benchmark: AI Diet Generator `);
  console.log(` Target Day: ${targetDay}`);
  console.log(` Models to test: ${CANDIDATE_MODELS.map(m => m.name).join(', ')}`);
  console.log(`======================================================\n`);

  const prompt = compilePromptText(config, { mode: 'single', selectedDay: targetDay });
  console.log(`Prompt compiled successfully (${prompt.length} chars, ~${Math.round(prompt.length / 4)} tokens).\n`);

  const results = [];

  for (const candidate of CANDIDATE_MODELS) {
    console.log(`------------------------------------------------------`);
    console.log(`Testing: ${candidate.name}`);
    console.log(`Model ID: ${candidate.id}`);
    console.log(`Reasoning Effort: ${candidate.reasoningEffort}`);
    console.log(`Generating diet plan (this may take 15-45s)...`);

    let response = null;
    let usedModelId = candidate.id;

    try {
      response = await callFireworks(apiKey, usedModelId, prompt, candidate.reasoningEffort);
    } catch (err) {
      console.warn(`  Failed with ${usedModelId}: ${err.message}`);
    }

    if (!response || !response.text) {
      console.error(`❌ FAILED to generate output for ${candidate.name}.\n`);
      results.push({
        name: candidate.name,
        modelId: usedModelId,
        status: 'FAILED',
        error: 'API Error or Empty Response',
        durationSec: '-',
        promptTokens: 0,
        completionTokens: 0,
        thinkingChars: 0,
        errorCount: '-',
        warningCount: '-',
        issues: []
      });
      continue;
    }

    console.log(`  Completed in ${response.durationSec}s`);
    console.log(`  Tokens: ${response.completionTokens} completion, ${response.promptTokens} prompt`);
    console.log(`  Thinking trace length: ${response.thought ? response.thought.length : 0} chars`);

    // Run deterministic verification
    console.log(`  Running deterministic verifier (verifyPlan)...`);
    const verification = verifyPlan(config, targetDay, response.text);

    const isClean = verification.errorCount === 0;
    console.log(`  Verdict: ${isClean ? '✅ PASS' : '❌ FAIL'} (${verification.errorCount} errors, ${verification.warningCount} warnings)`);

    if (verification.issues && verification.issues.length > 0) {
      console.log(`  Issues breakdown:`);
      for (const issue of verification.issues.slice(0, 6)) {
        console.log(`    - [${issue.severity.toUpperCase()}/${issue.category}] ${issue.message}`);
      }
      if (verification.issues.length > 6) {
        console.log(`    ... and ${verification.issues.length - 6} more issues.`);
      }
    }

    // Save individual output for inspection
    const outDir = path.resolve(__dirname, '../benchmark-results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const safeName = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    fs.writeFileSync(
      path.join(outDir, `${safeName}-${targetDay.toLowerCase()}.md`),
      `# ${candidate.name} (${usedModelId})\nDuration: ${response.durationSec}s | Errors: ${verification.errorCount} | Warnings: ${verification.warningCount}\n\n## Thinking\n${response.thought || '(None)'}\n\n## Output\n${response.text}`
    );

    results.push({
      name: candidate.name,
      modelId: usedModelId,
      status: isClean ? 'PASS' : 'FAIL',
      durationSec: response.durationSec,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      thinkingChars: response.thought ? response.thought.length : 0,
      errorCount: verification.errorCount,
      warningCount: verification.warningCount,
      issues: verification.issues
    });

    console.log('');
  }

  // Summary Table
  console.log(`\n========================================================================================`);
  console.log(`                                BENCHMARK SUMMARY (${targetDay})                        `);
  console.log(`========================================================================================`);
  console.log(
    `| ${'Model'.padEnd(25)} | ${'Status'.padEnd(8)} | ${'Time (s)'.padEnd(9)} | ${'Tokens'.padEnd(8)} | ${'Errors'.padEnd(7)} | ${'Warnings'.padEnd(9)} |`
  );
  console.log(`|---------------------------|----------|-----------|----------|---------|-----------|`);
  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(25)} | ${r.status.padEnd(8)} | ${String(r.durationSec).padEnd(9)} | ${String(r.completionTokens).padEnd(8)} | ${String(r.errorCount).padEnd(7)} | ${String(r.warningCount).padEnd(9)} |`
    );
  }
  console.log(`========================================================================================\n`);

  // Recommendation
  const passing = results.filter(r => r.status === 'PASS');
  if (passing.length > 0) {
    passing.sort((a, b) => parseFloat(a.durationSec) - parseFloat(b.durationSec));
    console.log(`🏆 Recommended Model: ${passing[0].name} (Fastest clean generation in ${passing[0].durationSec}s with 0 errors)`);
  } else {
    results.sort((a, b) => (Number(a.errorCount) || 999) - (Number(b.errorCount) || 999));
    console.log(`⚠️ Top Performer: ${results[0].name} (Lowest error count: ${results[0].errorCount})`);
  }

  // Save JSON summary
  fs.writeFileSync(
    path.join(__dirname, '../benchmark-results/summary.json'),
    JSON.stringify({ targetDay, results, timestamp: new Date().toISOString() }, null, 2)
  );
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
