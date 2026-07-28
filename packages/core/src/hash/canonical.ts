/**
 * Canonicalization and hashing (build spec section 13, ADR 0001 section 4).
 * Objects get recursively sorted keys; array order is preserved; serialization
 * is compact UTF-8 JSON; hashes are `sha256:<64 lowercase hex>`.
 */
import { createHash } from "node:crypto";
import { DevkitError } from "../errors.js";

export type Sha256 = `sha256:${string}`;

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function canonicalValue(value: unknown, pointer: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DevkitError(
        "CANONICALIZATION_ERROR",
        `Non-finite number cannot be canonicalized at ${pointer}.`,
        { path: pointer },
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalValue(item, `${pointer}/${index}`));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const member = source[key];
      if (member === undefined) {
        continue;
      }
      sorted[key] = canonicalValue(member, `${pointer}/${key}`);
    }
    return sorted;
  }
  throw new DevkitError(
    "CANONICALIZATION_ERROR",
    `Unsupported value type "${typeof value}" at ${pointer}.`,
    { path: pointer },
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, ""));
}

export function sha256OfUtf8(content: string): Sha256 {
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  return `sha256:${digest}`;
}

/** Hash of a structured value's canonical JSON serialization. */
export function hashCanonical(value: unknown): Sha256 {
  return sha256OfUtf8(canonicalJson(value));
}

/** Hash of file content after line-ending normalization (LF, UTF-8). */
export function hashFileContent(content: string): Sha256 {
  return sha256OfUtf8(normalizeLineEndings(content));
}

export function isSha256(value: string): value is Sha256 {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}
