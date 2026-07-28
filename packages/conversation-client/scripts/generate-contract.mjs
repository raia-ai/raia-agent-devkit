// Generates src/generated/contract-constants.ts from the pinned, audited
// vendor contract under docs/raia-devkit-spec/contracts/vendor/ (build spec
// section 16: generated clients are produced from the pinned projected local
// file, never from a remote URL). The output embeds the contract checksums so
// the runtime can fail closed on drift.
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.resolve(
  packageRoot,
  "..",
  "..",
  "docs",
  "raia-devkit-spec",
  "contracts",
  "vendor",
);

export async function renderContractConstants() {
  const rawBytes = await readFile(path.join(vendorDir, "raia-external-api.raw.openapi.json"));
  const projectedBytes = await readFile(path.join(vendorDir, "raia-external-api.openapi.json"));
  const normalization = JSON.parse(
    await readFile(path.join(vendorDir, "raia-external-api.normalization.json"), "utf8"),
  );
  const document = JSON.parse(projectedBytes.toString("utf8"));

  const rawSha256 = createHash("sha256").update(rawBytes).digest("hex");
  const projectedSha256 = createHash("sha256").update(projectedBytes).digest("hex");
  if (rawSha256 !== normalization.rawSha256 || projectedSha256 !== normalization.normalizedSha256) {
    throw new Error(
      "Vendor contract drift: the pinned files no longer match the recorded checksums in " +
        "raia-external-api.normalization.json. Re-run the reviewed normalization workflow first.",
    );
  }

  const operations = {};
  for (const [pathKey, methods] of Object.entries(document.paths).sort()) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method)) continue;
      operations[operation.operationId] = { method: method.toUpperCase(), path: pathKey };
    }
  }

  const securitySchemes = Object.keys(document.components?.securitySchemes ?? {}).sort();

  return `/*
 * GENERATED FILE — do not edit by hand.
 * Source: docs/raia-devkit-spec/contracts/vendor/raia-external-api.openapi.json
 * Regenerate: pnpm --filter @raia/conversation-client generate
 * Drift check: pnpm --filter @raia/conversation-client check-sync
 */

/** SHA-256 of the byte-for-byte published vendor OpenAPI snapshot. */
export const RAW_CONTRACT_SHA256 = "${rawSha256}";

/** SHA-256 of the audited projected contract that defines external-openapi-v1. */
export const PROJECTED_CONTRACT_SHA256 = "${projectedSha256}";

export const CONTRACT_RETRIEVED_AT = ${JSON.stringify(normalization.retrievedAt)};

export const CONTRACT_SERVERS = {
  us: "https://api.raia2.com",
  eu: "https://api-eu.raia2.com",
} as const;

/** Security schemes published by the vendor contract. */
export const CONTRACT_SECURITY_SCHEMES = ${JSON.stringify(securitySchemes)} as const;

/** operationId → wire method and path template, projected from the pinned contract. */
export const CONTRACT_OPERATIONS = ${JSON.stringify(operations, null, 2)} as const;
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const content = await renderContractConstants();
  const outDir = path.join(packageRoot, "src", "generated");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "contract-constants.ts"), content);
  console.log("Generated src/generated/contract-constants.ts");
}
