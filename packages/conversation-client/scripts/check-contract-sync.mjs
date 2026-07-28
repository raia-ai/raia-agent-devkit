// CI drift gate: the committed generated constants must match a fresh
// deterministic regeneration from the pinned vendor contract, and the pinned
// files must match their recorded checksums (the generator enforces that).
// Any mismatch fails closed.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { renderContractConstants } from "./generate-contract.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = path.join(packageRoot, "src", "generated", "contract-constants.ts");

let expected;
try {
  expected = await renderContractConstants();
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}
const actual = await readFile(generatedPath, "utf8").catch(() => null);
if (actual !== expected) {
  console.error(
    "OUT OF SYNC: src/generated/contract-constants.ts does not match the pinned vendor contract. " +
      "Run `pnpm --filter @raia/conversation-client generate` after a reviewed contract update.",
  );
  process.exit(1);
}
console.log("Conversation contract constants in sync with the pinned vendor contract.");
