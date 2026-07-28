import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const ALLOWED_BARE_IMPORTS = new Set([
  "@raia/contracts",
  "yaml",
  "ajv/dist/2020.js",
  "ajv-formats",
]);
const ALLOWED_NODE_MODULES = new Set(["node:crypto", "node:fs/promises", "node:path"]);

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe("package boundaries (build spec section 10)", () => {
  it("core imports only its allowlist: contracts public API, yaml, ajv, and safe node built-ins", async () => {
    const files = await collectTsFiles(srcRoot);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith(".")) {
          expect(specifier, `${file} deep-imports another package`).not.toContain("packages/");
          continue;
        }
        if (specifier.startsWith("node:")) {
          expect(
            ALLOWED_NODE_MODULES.has(specifier),
            `${file} imports disallowed node module ${specifier}`,
          ).toBe(true);
          continue;
        }
        expect(
          ALLOWED_BARE_IMPORTS.has(specifier),
          `${file} imports disallowed module ${specifier}`,
        ).toBe(true);
        expect(specifier).not.toMatch(/^@raia\/.+\/src\//);
      }
    }
  });

  it("core never imports providers, CLI, MCP, or network libraries", async () => {
    const files = await collectTsFiles(srcRoot);
    const forbidden = [
      /^node:https?/,
      /^undici/,
      /^axios/,
      /^node-fetch/,
      /provider-(mock|http)/,
      /mcp/i,
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        for (const pattern of forbidden) {
          expect(pattern.test(specifier), `${file} imports forbidden ${specifier}`).toBe(false);
        }
      }
    }
  });
});
