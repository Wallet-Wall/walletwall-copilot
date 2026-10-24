import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const FORBIDDEN_MODULES = [
  "fs", "fs/promises", "net", "http", "https", "http2", "dgram", "dns", "dns/promises", "tls", "child_process",
  "cluster", "worker_threads", "os", "vm", "inspector", "readline", "repl", "v8", "perf_hooks",
].flatMap((m) => [m, `node:${m}`]);

export default defineConfig(
  { ignores: ["node_modules/**", "plugin/server/**", "plugin/com.github.copilot/**/fixtures.mjs", "packages/mcp/src/generated/**", "conformance/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/only-throw-error": "error",
      eqeqeq: ["error", "always"],
      "no-console": "off",
    },
  },
  {
    // The engine is a pure function library plus a stdio server. It must stay incapable of I/O beyond stdio.
    files: ["packages/mcp/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: FORBIDDEN_MODULES.map((name) => ({ name, message: "The engine must not use this module (offline, read-only, no persistence)." })) }],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "No network access." },
        { name: "XMLHttpRequest", message: "No network access." },
        { name: "WebSocket", message: "No network access." },
        { name: "localStorage", message: "No persistence." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "The engine reads no environment." },
        { object: "Date", property: "now", message: "Evaluation time is an explicit input." },
        { object: "Math", property: "random", message: "No generated identifiers." },
      ],
      "no-eval": "error",
      "no-new-func": "error",
      "no-console": "error",
    },
  },
  {
    files: ["packages/mcp/src/main.ts"],
    rules: { "no-restricted-properties": "off", "no-console": "error" },
  },
  {
    files: ["scripts/**/*.ts", "evals/**/*.ts", "packages/mcp/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  { files: ["eslint.config.js"], ...tseslint.configs.disableTypeChecked },
  {
    // The Evidence Explorer canvas extension (plain .mjs, run by the Copilot app). It may bind one loopback listener and
    // start the bundled MCP server; it must not touch the filesystem, the network beyond that, or any browser storage.
    files: ["plugin/com.github.copilot/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["plugin/com.github.copilot/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly", URL: "readonly", setTimeout: "readonly", clearTimeout: "readonly", structuredClone: "readonly" },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["fs", "fs/promises", "net", "https", "http2", "dgram", "dns", "dns/promises", "tls", "cluster", "worker_threads", "os", "vm", "inspector", "readline", "repl", "v8", "perf_hooks"]
            .flatMap((m) => [m, `node:${m}`])
            .map((name) => ({ name, message: "The canvas extension must not use this module (no disk, no outbound network)." })),
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "No outbound network access." },
        { name: "XMLHttpRequest", message: "No outbound network access." },
        { name: "WebSocket", message: "No outbound network access." },
        { name: "localStorage", message: "No persistence." },
        { name: "sessionStorage", message: "No persistence." },
        { name: "indexedDB", message: "No persistence." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "No clock reads." },
        { object: "Math", property: "random", message: "No generated identifiers." },
      ],
      "no-eval": "error",
      "no-new-func": "error",
      "no-console": "error",
    },
  },
);
