import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    watch: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**"],
      exclude: [
        "packages/contracts/src/generated/**",
        "packages/contracts/src/provider-contract.ts",
      ],
    },
  },
});
