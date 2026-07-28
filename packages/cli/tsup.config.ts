import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  target: "node20",
  sourcemap: false,
  // The runnable bin must not resolve workspace packages at runtime (their
  // development exports point at TypeScript sources). Bundle everything except
  // commander, which stays a regular dependency of this package.
  noExternal: [/^@raia\//, "ajv", "ajv-formats", "yaml"],
  // Bundled CJS dependencies use require(); provide it in the ESM output.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
