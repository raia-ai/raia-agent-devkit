/**
 * Compiled JSON Schema validators (Ajv 2020-12 with formats, build spec section 9).
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { schemas, type SchemaName } from "@raia/contracts";

// ajv-formats ships CJS; under Node ESM the callable sits on `.default`.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => unknown;

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const compiled = new Map<SchemaName, ValidateFunction>();

export interface SchemaIssue {
  instancePath: string;
  message: string;
}

export function validateAgainstSchema(
  name: SchemaName,
  value: unknown,
): { valid: boolean; issues: SchemaIssue[] } {
  let validator = compiled.get(name);
  if (!validator) {
    validator = ajv.compile(schemas[name] as unknown as object);
    compiled.set(name, validator);
  }
  const valid = validator(value) as boolean;
  const issues: SchemaIssue[] = (validator.errors ?? []).map((error) => ({
    instancePath: error.instancePath || "/",
    message: error.message ?? "schema violation",
  }));
  issues.sort(
    (a, b) => a.instancePath.localeCompare(b.instancePath) || a.message.localeCompare(b.message),
  );
  return { valid, issues };
}
