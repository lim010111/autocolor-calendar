import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "node_modules/",
      "dist/",
      ".wrangler/",
      "drizzle/",
      "coverage/",
      "gas/",
      "private/",
      "docs/",
      "*.config.js",
      "evals/dataset-builder/",
      // Local Python virtualenvs (gitignored; embedding-eval / dataset-builder
      // operator harnesses). eslint must never lint a venv's bundled JS.
      "**/.venv/",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "evals/scripts/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        CryptoKey: "readonly",
        atob: "readonly",
        btoa: "readonly",
        process: "readonly",
        Hyperdrive: "readonly",
        Ai: "readonly",
        ExecutionContext: "readonly",
        RequestInit: "readonly",
        RequestInfo: "readonly",
        Queue: "readonly",
        Message: "readonly",
        MessageBatch: "readonly",
        ScheduledEvent: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        structuredClone: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Watch module privacy seam (architecture-deepening #06). The bare
      // registerWatchChannel / stopWatchChannel primitives are module-private
      // to src/services/watch/: new code paths compose `reRegisterWatch` (or,
      // for account teardown, `teardownWatchesForUser`) instead of stop/register
      // directly. This promotes the prose rule in src/CLAUDE.md "Watch
      // self-heal" to a structural seam. The override below re-enables the
      // primitives for siblings inside the watch folder.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/watch/core", "**/services/watch/core"],
              importNames: ["registerWatchChannel", "stopWatchChannel"],
              message:
                "registerWatchChannel / stopWatchChannel are module-private to src/services/watch/. Compose reRegisterWatch — or, for account teardown, teardownWatchesForUser — instead of the bare register/stop primitives.",
            },
          ],
        },
      ],
    },
  },
  {
    // Watch-module siblings (e.g. teardown.ts needs stopWatchChannel) are the
    // sanctioned holders of the private primitives — lift the restriction here.
    files: ["src/services/watch/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  prettier,
];
