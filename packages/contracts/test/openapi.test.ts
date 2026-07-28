/**
 * OpenAPI document validation (build spec section 27): both wire contracts —
 * the proposed management API and the pinned vendor projection — must be
 * standards-valid OpenAPI 3.1 documents, validated offline.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Validator } from "@seriousme/openapi-schema-validator";
import { parse as parseYaml } from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const contracts = path.join(repoRoot, "docs", "raia-devkit-spec", "contracts");

async function validateDocument(document: unknown): Promise<{ valid: boolean; errors?: unknown }> {
  const validator = new Validator();
  const result = await validator.validate(document as never);
  return { valid: result.valid, errors: result.errors };
}

describe("OpenAPI contract validity", () => {
  it("raia-management.openapi.yaml is valid OpenAPI 3.1", async () => {
    const document = parseYaml(
      await readFile(path.join(contracts, "raia-management.openapi.yaml"), "utf8"),
    ) as { openapi: string };
    expect(document.openapi).toBe("3.1.0");
    const result = await validateDocument(document);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("the pinned vendor projection is valid OpenAPI", async () => {
    const document = JSON.parse(
      await readFile(path.join(contracts, "vendor", "raia-external-api.openapi.json"), "utf8"),
    ) as object;
    const result = await validateDocument(document);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
