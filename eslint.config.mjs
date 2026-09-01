import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "whatsapp-worker.js",
    "src/lib/compile-prompt.js",
    "src/lib/compute-config-hash.js",
    "src/lib/models.js",
    "src/lib/gemini.js",
    "src/lib/generation-runner.js",
    "src/lib/verify-plan.js",
    "src/lib/ai-complete.js",
    ".wwebjs_auth/**",
  ]),
]);

export default eslintConfig;
