import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => unknown;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA_FILES = [
  "agent-manifest.schema.json",
  "agent-lock.schema.json",
  "eval-suite.schema.json",
  "release-policy.schema.json",
  "workflow-state.schema.json",
];

describe("normative JSON Schemas", () => {
  for (const file of SCHEMA_FILES) {
    it(`${file} passes 2020-12 metaschema validation and compiles`, async () => {
      const raw = await readFile(path.join(packageRoot, "schemas", file), "utf8");
      const schema = JSON.parse(raw) as Record<string, unknown>;
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      addFormats(ajv);
      expect(ajv.validateSchema(schema)).toBe(true);
      expect(ajv.errors ?? null).toBeNull();
      expect(() => ajv.compile(schema)).not.toThrow();
    });
  }
});
