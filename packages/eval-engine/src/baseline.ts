/**
 * Baseline comparison (build spec section 21): labels regressions,
 * improvements, unchanged failures, and flaky cases between two runs.
 */
import type { EvaluationRunResult } from "./types.js";

export interface ComparedCase {
  suitePath: string;
  caseId: string;
  baselineStatus: string;
  currentStatus: string;
}

export interface BaselineComparison {
  baselineRunId: string;
  currentRunId: string;
  regressions: ComparedCase[];
  improvements: ComparedCase[];
  unchangedFailures: ComparedCase[];
  flaky: ComparedCase[];
  newCases: ComparedCase[];
  removedCases: ComparedCase[];
}

type CaseIndex = Map<string, { suitePath: string; caseId: string; status: string }>;

function indexCases(run: EvaluationRunResult): CaseIndex {
  const index: CaseIndex = new Map();
  for (const suite of run.suites) {
    for (const caseResult of suite.cases) {
      index.set(`${suite.suitePath}::${caseResult.caseId}`, {
        suitePath: suite.suitePath,
        caseId: caseResult.caseId,
        status: caseResult.status,
      });
    }
  }
  return index;
}

export function compareRuns(
  baseline: EvaluationRunResult,
  current: EvaluationRunResult,
): BaselineComparison {
  const baselineIndex = indexCases(baseline);
  const currentIndex = indexCases(current);
  const comparison: BaselineComparison = {
    baselineRunId: baseline.runId,
    currentRunId: current.runId,
    regressions: [],
    improvements: [],
    unchangedFailures: [],
    flaky: [],
    newCases: [],
    removedCases: [],
  };

  for (const [key, currentCase] of currentIndex) {
    const baselineCase = baselineIndex.get(key);
    const entry: ComparedCase = {
      suitePath: currentCase.suitePath,
      caseId: currentCase.caseId,
      baselineStatus: baselineCase?.status ?? "absent",
      currentStatus: currentCase.status,
    };
    if (baselineCase === undefined) {
      comparison.newCases.push(entry);
      continue;
    }
    if (currentCase.status === "flaky" || baselineCase.status === "flaky") {
      comparison.flaky.push(entry);
    } else if (baselineCase.status === "passed" && currentCase.status === "failed") {
      comparison.regressions.push(entry);
    } else if (baselineCase.status === "failed" && currentCase.status === "passed") {
      comparison.improvements.push(entry);
    } else if (baselineCase.status === "failed" && currentCase.status === "failed") {
      comparison.unchangedFailures.push(entry);
    }
  }
  for (const [key, baselineCase] of baselineIndex) {
    if (!currentIndex.has(key)) {
      comparison.removedCases.push({
        suitePath: baselineCase.suitePath,
        caseId: baselineCase.caseId,
        baselineStatus: baselineCase.status,
        currentStatus: "absent",
      });
    }
  }

  const sortCases = (a: ComparedCase, b: ComparedCase): number =>
    a.suitePath.localeCompare(b.suitePath) || a.caseId.localeCompare(b.caseId);
  comparison.regressions.sort(sortCases);
  comparison.improvements.sort(sortCases);
  comparison.unchangedFailures.sort(sortCases);
  comparison.flaky.sort(sortCases);
  comparison.newCases.sort(sortCases);
  comparison.removedCases.sort(sortCases);
  return comparison;
}
