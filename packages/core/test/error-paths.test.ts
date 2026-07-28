/**
 * Core error-path coverage: canonicalization refusals, lock/suite/policy
 * parse failures, validation findings for broken resources, and redaction
 * boundary branches.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  loadEvaluationSuite,
  loadReleasePolicy,
  parseLock,
  redactText,
  scanForSecrets,
  validateProject,
} from "../src/index.js";
import { createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("canonicalization and lock parsing refusals", () => {
  it("refuses non-JSON value types with a pointer", () => {
    expect(() => canonicalJson({ callback: () => 1 })).toThrowError(/Unsupported value type/);
    expect(() => canonicalJson(undefined)).toThrowError(/Unsupported value type/);
  });

  it("parseLock reports invalid JSON and schema violations as LOCK_INVALID", () => {
    expect(() => parseLock("{broken")).toThrowError(
      expect.objectContaining({ code: "LOCK_INVALID" }),
    );
    expect(() => parseLock(JSON.stringify({ not: "a lock" }))).toThrowError(
      expect.objectContaining({ code: "LOCK_INVALID" }),
    );
  });
});

describe("suite and policy loading failures", () => {
  it("reports invalid YAML and schema violations as SCHEMA_INVALID", async () => {
    const suitePath = path.join(fixture.root, "evals", "smoke.eval.yaml");
    await writeFile(suitePath, "cases: [unbalanced");
    await expect(loadEvaluationSuite(fixture.root, "evals/smoke.eval.yaml")).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
    await writeFile(suitePath, "apiVersion: wrong\n");
    await expect(loadEvaluationSuite(fixture.root, "evals/smoke.eval.yaml")).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });

  it("reports invalid release policies as SCHEMA_INVALID", async () => {
    const policyPath = path.join(fixture.root, "policies", "default.release-policy.yaml");
    await writeFile(policyPath, ": not yaml [");
    await expect(
      loadReleasePolicy(fixture.root, "policies/default.release-policy.yaml"),
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await writeFile(policyPath, "kind: SomethingElse\n");
    await expect(
      loadReleasePolicy(fixture.root, "policies/default.release-policy.yaml"),
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("validateProject records broken suites, policies, and locks as findings", async () => {
    await writeFile(path.join(fixture.root, "evals", "smoke.eval.yaml"), "apiVersion: wrong\n");
    await writeFile(
      path.join(fixture.root, "policies", "default.release-policy.yaml"),
      "kind: SomethingElse\n",
    );
    await writeFile(path.join(fixture.root, "raia.lock.json"), "{broken");
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("SCHEMA_INVALID");
    expect(codes).toContain("LOCK_INVALID");
  });

  it("validateProject flags secrets inside fixture files", async () => {
    const fixturePath = path.join(fixture.root, "fixtures", "order-shipped.json");
    const parsed = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    parsed["assistantMessage"] = "Use api_key=F8kQz3Wr7Xv1Nb5TjCm2Hd6Ys4Ug0Pe9 for access.";
    await writeFile(fixturePath, JSON.stringify(parsed, null, 2));
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(
      result.findings.some(
        (finding) =>
          finding.code === "SECRET_DETECTED" && finding.path === "fixtures/order-shipped.json",
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("F8kQz3Wr7Xv1Nb5TjCm2Hd6Ys4Ug0Pe9");
  });
});

describe("redaction boundary branches", () => {
  it("keeps allowlisted references and low-entropy values intact", () => {
    const text =
      "credential: env://ORDER_SERVICE_KEY and vault://kv/orders and password=aaaaaaaaaaaaaaaa";
    expect(scanForSecrets(text, "test.txt")).toEqual([]);
    expect(redactText(text)).toBe(text);
  });

  it("redacts non-entropy rules like private key blocks wholesale", () => {
    const block = "-----BEGIN RSA PRIVATE KEY-----";
    const findings = scanForSecrets(`config:\n${block}\n`, "test.txt");
    expect(findings.some((finding) => finding.ruleId === "private-key-block")).toBe(true);
    expect(redactText(block)).toBe("[REDACTED:private-key-block]");
  });

  it("redacts only the secret value inside an assignment", () => {
    const secret = "F8kQz3Wr7Xv1Nb5TjCm2Hd6Ys4Ug0Pe9";
    const redacted = redactText(`before token=${secret} after`);
    expect(redacted).toContain("before ");
    expect(redacted).toContain(" after");
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[REDACTED:");
  });
});
