import { describe, expect, it } from "vitest";
import { redactText, redactValue, scanForSecrets } from "../src/index.js";
import { DevkitError } from "../src/errors.js";

// Assembled at runtime so this test file itself never contains a token-shaped literal.
const FAKE_AWS_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const FAKE_GITHUB_TOKEN = ["ghp_", "Abcdefghijklmnopqrstuvwxyz012345"].join("");
const FAKE_OPENAI_KEY = ["sk-", "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lz"].join("");
const FAKE_JWT = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  "TJVA95OrM7E2cBab30RM",
].join(".");

describe("scanForSecrets", () => {
  it("detects an AWS access key id", () => {
    const findings = scanForSecrets(`key = ${FAKE_AWS_KEY}`, "config.yaml");
    expect(findings.map((f) => f.ruleId)).toContain("aws-access-key-id");
  });

  it("detects a GitHub token", () => {
    const findings = scanForSecrets(FAKE_GITHUB_TOKEN, "file.md");
    expect(findings.map((f) => f.ruleId)).toContain("github-token");
  });

  it("detects an OpenAI-style key and a JWT", () => {
    expect(scanForSecrets(FAKE_OPENAI_KEY, "f").length).toBeGreaterThan(0);
    expect(scanForSecrets(FAKE_JWT, "f").length).toBeGreaterThan(0);
  });

  it("detects a private key block", () => {
    const findings = scanForSecrets("-----BEGIN RSA PRIVATE KEY-----", "key.pem");
    expect(findings.map((f) => f.ruleId)).toContain("private-key-block");
  });

  it("detects generic high-entropy credential assignments", () => {
    const findings = scanForSecrets('apiKey: "q7Zp3vX9mK2rT8wL5nB1cD4f"', "integration.yaml");
    expect(findings.map((f) => f.ruleId)).toContain("credential-assignment");
  });

  it("allows secret references and placeholders", () => {
    expect(scanForSecrets("credential: raia-secret://integrations/order-service", "m")).toEqual([]);
    expect(scanForSecrets("apiKey: env://ORDER_SERVICE_KEY", "m")).toEqual([]);
    expect(scanForSecrets("password: PLACEHOLDER", "m")).toEqual([]);
  });

  it("never includes the secret value in findings", () => {
    const findings = scanForSecrets(`token = ${FAKE_GITHUB_TOKEN}`, "config");
    expect(JSON.stringify(findings)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(findings[0]?.line).toBe(1);
  });

  it("reports findings in deterministic order", () => {
    const text = `a = ${FAKE_AWS_KEY}\nb = ${FAKE_GITHUB_TOKEN}`;
    const first = scanForSecrets(text, "f");
    const second = scanForSecrets(text, "f");
    expect(first).toEqual(second);
    expect(first.map((f) => f.line)).toEqual([1, 2]);
  });
});

describe("redaction", () => {
  it("masks secrets in free text", () => {
    const redacted = redactText(`before ${FAKE_AWS_KEY} after`);
    expect(redacted).not.toContain(FAKE_AWS_KEY);
    expect(redacted).toContain("[REDACTED:aws-access-key-id]");
  });

  it("redacts sensitive keys in structured values", () => {
    const value = redactValue({
      authorization: "Bearer abc",
      nested: { api_key: "value", safe: "keep" },
      list: [{ token: "x" }],
    }) as Record<string, unknown>;
    expect(value["authorization"]).toBe("[REDACTED]");
    expect((value["nested"] as Record<string, unknown>)["api_key"]).toBe("[REDACTED]");
    expect((value["nested"] as Record<string, unknown>)["safe"]).toBe("keep");
    expect((value["list"] as Array<Record<string, unknown>>)[0]?.["token"]).toBe("[REDACTED]");
  });

  it("redacts secret material inside DevkitError messages and details", () => {
    const error = new DevkitError("SECRET_DETECTED", `found ${FAKE_AWS_KEY} in config`, {
      details: { sample: FAKE_AWS_KEY, token: "raw" },
    });
    expect(error.message).not.toContain(FAKE_AWS_KEY);
    expect(JSON.stringify(error.details)).not.toContain(FAKE_AWS_KEY);
    expect((error.details as Record<string, unknown>)["token"]).toBe("[REDACTED]");
  });
});
