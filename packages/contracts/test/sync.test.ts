import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const specContracts = path.resolve(
  packageRoot,
  "..",
  "..",
  "docs",
  "raia-devkit-spec",
  "contracts",
);

const PAIRS: Array<[string, string]> = [
  ["agent-manifest.schema.json", "schemas/agent-manifest.schema.json"],
  ["agent-lock.schema.json", "schemas/agent-lock.schema.json"],
  ["eval-suite.schema.json", "schemas/eval-suite.schema.json"],
  ["release-policy.schema.json", "schemas/release-policy.schema.json"],
  ["workflow-state.schema.json", "schemas/workflow-state.schema.json"],
  ["provider-contract.ts", "src/provider-contract.ts"],
];

describe("contract copies stay byte-identical to the normative spec package", () => {
  for (const [specRel, pkgRel] of PAIRS) {
    it(`${pkgRel} matches docs/raia-devkit-spec/contracts/${specRel}`, async () => {
      const specContent = await readFile(path.join(specContracts, specRel), "utf8");
      const pkgContent = await readFile(path.join(packageRoot, pkgRel), "utf8");
      expect(pkgContent).toBe(specContent);
    });
  }
});
