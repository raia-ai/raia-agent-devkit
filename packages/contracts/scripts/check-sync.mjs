// Verifies that the copies embedded in @raia/contracts are byte-identical to the
// normative files under docs/raia-devkit-spec/contracts/ (ADR 0001 section 2).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const specContracts = path.join(repoRoot, "docs", "raia-devkit-spec", "contracts");

const PAIRS = [
  ["agent-manifest.schema.json", "schemas/agent-manifest.schema.json"],
  ["agent-lock.schema.json", "schemas/agent-lock.schema.json"],
  ["eval-suite.schema.json", "schemas/eval-suite.schema.json"],
  ["release-policy.schema.json", "schemas/release-policy.schema.json"],
  ["workflow-state.schema.json", "schemas/workflow-state.schema.json"],
  ["provider-contract.ts", "src/provider-contract.ts"],
];

let failed = false;
for (const [specRel, pkgRel] of PAIRS) {
  const specContent = await readFile(path.join(specContracts, specRel), "utf8").catch(() => null);
  const pkgContent = await readFile(path.join(packageRoot, pkgRel), "utf8").catch(() => null);
  if (specContent === null || pkgContent === null || specContent !== pkgContent) {
    console.error(`OUT OF SYNC: ${pkgRel} != docs/raia-devkit-spec/contracts/${specRel}`);
    failed = true;
  }
}
if (failed) {
  console.error("Contract copies diverge from the normative spec package.");
  process.exit(1);
}
console.log(`Contracts in sync (${PAIRS.length} files).`);
