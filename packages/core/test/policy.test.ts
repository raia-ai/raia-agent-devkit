import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RaiaAgentReleasePolicy } from "@raia/contracts";
import { evaluateReleasePolicy, type PolicyEvaluationInput } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const POLICY_PATH = path.join(
  repoRoot,
  "docs",
  "raia-devkit-spec",
  "examples",
  "helpdesk-agent",
  "policies",
  "default.release-policy.yaml",
);

async function loadPolicy(): Promise<RaiaAgentReleasePolicy> {
  return parseYaml(await readFile(POLICY_PATH, "utf8")) as RaiaAgentReleasePolicy;
}

function cleanInput(): PolicyEvaluationInput {
  return {
    validation: { ok: true, findingCodes: [] },
    drift: { local: false, remote: false },
    risk: "medium",
    evaluation: {
      suitesRun: ["evals/smoke.eval.yaml", "evals/regression.eval.yaml"],
      executedTags: ["smoke", "release-gate", "regression", "tools", "safety"],
      passRate: 1,
      gatePassed: true,
      regressionCount: 0,
    },
  };
}

describe("evaluateReleasePolicy", () => {
  it("satisfies the helpdesk policy with clean evidence", async () => {
    const result = evaluateReleasePolicy(await loadPolicy(), cleanInput());
    expect(result.satisfied).toBe(true);
    expect(result.requirements.every((r) => r.satisfied)).toBe(true);
  });

  it("fails when a required suite was not executed", async () => {
    const input = cleanInput();
    input.evaluation!.suitesRun = ["evals/smoke.eval.yaml"];
    const result = evaluateReleasePolicy(await loadPolicy(), input);
    expect(result.satisfied).toBe(false);
    expect(result.requirements.find((r) => r.id === "evaluation.required-suites")?.satisfied).toBe(
      false,
    );
  });

  it("fails on drift when requireNoDrift is set", async () => {
    const input = cleanInput();
    input.drift.remote = true;
    const result = evaluateReleasePolicy(await loadPolicy(), input);
    expect(result.requirements.find((r) => r.id === "validation.no-drift")?.satisfied).toBe(false);
  });

  it("fails when risk exceeds the policy maximum", async () => {
    const input = cleanInput();
    input.risk = "critical";
    const result = evaluateReleasePolicy(await loadPolicy(), input);
    expect(result.requirements.find((r) => r.id === "validation.maximum-risk")?.satisfied).toBe(
      false,
    );
  });

  it("fails on a below-minimum pass rate and on gate failure regardless of pass rate", async () => {
    const lowRate = cleanInput();
    lowRate.evaluation!.passRate = 0.5;
    expect(evaluateReleasePolicy(await loadPolicy(), lowRate).satisfied).toBe(false);

    const gateFailed = cleanInput();
    gateFailed.evaluation!.gatePassed = false;
    const result = evaluateReleasePolicy(await loadPolicy(), gateFailed);
    expect(result.satisfied).toBe(false);
    expect(
      result.requirements.find((r) => r.id === "evaluation.no-critical-failure")?.satisfied,
    ).toBe(false);
  });

  it("fails closed with no evaluation evidence", async () => {
    const input = cleanInput();
    input.evaluation = undefined;
    const result = evaluateReleasePolicy(await loadPolicy(), input);
    expect(result.satisfied).toBe(false);
    expect(result.requirements.find((r) => r.id === "evaluation.evidence")?.satisfied).toBe(false);
  });

  it("treats a missing baseline as an unexercised regression budget", async () => {
    const input = cleanInput();
    input.evaluation!.regressionCount = undefined;
    const result = evaluateReleasePolicy(await loadPolicy(), input);
    expect(result.requirements.find((r) => r.id === "evaluation.regressions")?.satisfied).toBe(
      true,
    );
  });

  it("secret findings fail the secret-scan requirement", async () => {
    const input = cleanInput();
    input.validation = { ok: false, findingCodes: ["SECRET_DETECTED"] };
    const result = evaluateReleasePolicy(await loadPolicy(), input);
    expect(result.requirements.find((r) => r.id === "validation.secret-scan")?.satisfied).toBe(
      false,
    );
  });
});
