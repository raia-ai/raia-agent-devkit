import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  hashCanonical,
  hashFileContent,
  isSha256,
  normalizeLineEndings,
} from "../src/index.js";
import { DevkitError } from "../src/errors.js";

describe("canonical JSON", () => {
  it("sorts object keys recursively and preserves array order", () => {
    const a = { b: 2, a: 1, nested: { z: [3, 1, 2], y: { k: 1, j: 2 } } };
    const b = { nested: { y: { j: 2, k: 1 }, z: [3, 1, 2] }, a: 1, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":1,"b":2,"nested":{"y":{"j":2,"k":1},"z":[3,1,2]}}');
  });

  it("keeps array order significant", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("omits undefined members and preserves null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrowError(DevkitError);
  });
});

describe("hashing", () => {
  it("produces the sha256:<64hex> format", () => {
    const hash = hashCanonical({ hello: "world" });
    expect(isSha256(hash)).toBe(true);
  });

  it("is deterministic across repeated calls and key orders", () => {
    const first = hashCanonical({ x: 1, y: { b: 2, a: [1, 2, 3] } });
    const second = hashCanonical({ y: { a: [1, 2, 3], b: 2 }, x: 1 });
    expect(first).toBe(second);
  });

  it("normalizes CRLF and CR to LF for file content", () => {
    expect(hashFileContent("line1\r\nline2\r")).toBe(hashFileContent("line1\nline2\n"));
    expect(normalizeLineEndings("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("distinguishes different content", () => {
    expect(hashFileContent("a")).not.toBe(hashFileContent("b"));
  });
});
