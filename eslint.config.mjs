import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "docs/raia-devkit-spec/**",
      "packages/contracts/src/generated/**",
      "packages/contracts/src/provider-contract.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@raia/*/src/*", "**/../contracts/src/*", "**/../core/src/*"],
              message: "Import another package only through its public entry point.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@raia/*/src/*"],
              message: "Import another package only through its public entry point.",
            },
            {
              group: [
                "node:http*",
                "node:https*",
                "node:net",
                "node:tls",
                "node:dgram",
                "undici*",
                "axios*",
                "node-fetch*",
              ],
              message: "core must not import network libraries (build spec section 10).",
            },
          ],
        },
      ],
    },
  },
);
