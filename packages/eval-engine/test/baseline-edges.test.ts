/**
 * Baseline comparison edge labels: new, removed, flaky, and unchanged
 * failures — beyond the regression/improvement paths covered by CLI tests.
 */
import { describe, expect, it } from "vitest";
import { compareRuns } from "../src/index.js";
import type { EvaluationRunResult } from "../src/index.js";

function runWith(
  runId: string,
  cases: Array<{ caseId: string; status: "passed" | "failed" | "flaky" | "skipped" }>,
): EvaluationRunResult {
  return {
    runId,
    suites: [{ suitePath: "evals/smoke.eval.yaml", suiteName: "smoke", cases }],
  } as unknown as EvaluationRunResult;
}

describe("compareRuns edge labels", () => {
  it("labels new, removed, flaky, and unchanged-failure cases deterministically", () => {
    const baseline = runWith("run_base", [
      { caseId: "stays-failing", status: "failed" },
      { caseId: "goes-flaky", status: "passed" },
      { caseId: "was-flaky", status: "flaky" },
      { caseId: "removed-case", status: "passed" },
    ]);
    const current = runWith("run_curr", [
      { caseId: "stays-failing", status: "failed" },
      { caseId: "goes-flaky", status: "flaky" },
      { caseId: "was-flaky", status: "passed" },
      { caseId: "brand-new", status: "passed" },
    ]);
    const comparison = compareRuns(baseline, current);
    expect(comparison.baselineRunId).toBe("run_base");
    expect(comparison.unchangedFailures.map((c) => c.caseId)).toEqual(["stays-failing"]);
    expect(comparison.flaky.map((c) => c.caseId).sort()).toEqual(["goes-flaky", "was-flaky"]);
    expect(comparison.newCases).toEqual([
      {
        suitePath: "evals/smoke.eval.yaml",
        caseId: "brand-new",
        baselineStatus: "absent",
        currentStatus: "passed",
      },
    ]);
    expect(comparison.removedCases).toEqual([
      {
        suitePath: "evals/smoke.eval.yaml",
        caseId: "removed-case",
        baselineStatus: "passed",
        currentStatus: "absent",
      },
    ]);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([]);
  });

  it("skipped-status transitions produce no regression/improvement labels", () => {
    const comparison = compareRuns(
      runWith("run_base", [{ caseId: "case", status: "skipped" }]),
      runWith("run_curr", [{ caseId: "case", status: "passed" }]),
    );
    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([]);
    expect(comparison.unchangedFailures).toEqual([]);
  });
});
