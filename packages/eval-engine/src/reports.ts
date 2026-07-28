/**
 * Evidence report rendering: JSON, JUnit XML, and Markdown (build spec
 * section 21). Reports are byte-stable apart from the informational
 * timestamps carried inside the run result itself.
 */
import type { EvaluationRunResult } from "./types.js";
import type { BaselineComparison } from "./baseline.js";

export function renderJsonReport(
  run: EvaluationRunResult,
  comparison?: BaselineComparison,
): string {
  return JSON.stringify({ ...run, ...(comparison ? { comparison } : {}) }, null, 2) + "\n";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderJunitReport(run: EvaluationRunResult): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const totalTests = run.totals.cases;
  const totalFailures = run.totals.failed + run.totals.flaky;
  lines.push(
    `<testsuites name="raia-eval ${escapeXml(run.runId)}" tests="${totalTests}" failures="${totalFailures}" skipped="${run.totals.skipped}">`,
  );
  for (const suite of run.suites) {
    const failures = suite.cases.filter((c) => c.status === "failed" || c.status === "flaky");
    const skipped = suite.cases.filter((c) => c.status === "skipped");
    lines.push(
      `  <testsuite name="${escapeXml(suite.suiteName)}" tests="${suite.cases.length}" failures="${failures.length}" skipped="${skipped.length}">`,
    );
    for (const caseResult of suite.cases) {
      const seconds = ((caseResult.repetitions[0]?.latencyMs ?? 0) / 1000).toFixed(3);
      const open = `    <testcase classname="${escapeXml(suite.suitePath)}" name="${escapeXml(caseResult.caseId)}" time="${seconds}"`;
      if (caseResult.status === "passed") {
        lines.push(`${open}/>`);
        continue;
      }
      lines.push(`${open}>`);
      if (caseResult.status === "skipped") {
        const reason = caseResult.repetitions[0]?.assertions[0]?.message ?? "skipped";
        lines.push(`      <skipped message="${escapeXml(reason)}"/>`);
      } else {
        const failedAssertions = caseResult.repetitions
          .flatMap((rep) => rep.assertions)
          .filter((a) => a.status === "failed");
        for (const assertion of failedAssertions) {
          lines.push(
            `      <failure message="${escapeXml(`${assertion.assertionId}: ${assertion.message ?? "failed"}`)}"${
              assertion.critical ? ' type="critical"' : ""
            }/>`,
          );
        }
      }
      lines.push("    </testcase>");
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n") + "\n";
}

export function renderMarkdownReport(
  run: EvaluationRunResult,
  comparison?: BaselineComparison,
): string {
  const lines: string[] = [
    `# Evaluation report ${run.runId}`,
    "",
    `- Mode: ${run.mode} (provider ${run.provider}, engine v${run.engineVersion})`,
    `- Candidate: ${run.candidateSha256 ?? "unknown"}`,
    `- Seed ${run.seed}, repetitions ${run.repetitions}, concurrency ${run.concurrency}`,
    `- Totals: ${run.totals.passed}/${run.totals.cases} passed, ${run.totals.failed} failed, ` +
      `${run.totals.flaky} flaky, ${run.totals.skipped} skipped (pass rate ${(run.totals.passRate * 100).toFixed(1)}%)`,
    `- Gate: **${run.gate.passed ? "PASSED" : "FAILED"}**`,
    "",
  ];
  if (!run.gate.passed) {
    lines.push("## Blocking failures", "");
    for (const reason of run.gate.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }
  lines.push(
    "## Cases",
    "",
    "| Suite | Case | Criticality | Status |",
    "| --- | --- | --- | --- |",
  );
  for (const suite of run.suites) {
    for (const caseResult of suite.cases) {
      lines.push(
        `| ${suite.suitePath} | ${caseResult.caseId} | ${caseResult.criticality} | ${caseResult.status}${
          caseResult.gateFailure ? " ⛔" : ""
        } |`,
      );
    }
  }
  if (comparison !== undefined) {
    lines.push(
      "",
      "## Baseline comparison",
      "",
      `- Baseline run: ${comparison.baselineRunId}`,
      `- Regressions: ${comparison.regressions.length}`,
      `- Improvements: ${comparison.improvements.length}`,
      `- Unchanged failures: ${comparison.unchangedFailures.length}`,
      `- Flaky: ${comparison.flaky.length}`,
    );
    for (const [label, items] of [
      ["Regressions", comparison.regressions],
      ["Improvements", comparison.improvements],
      ["Unchanged failures", comparison.unchangedFailures],
      ["Flaky", comparison.flaky],
    ] as const) {
      if (items.length > 0) {
        lines.push("", `### ${label}`, "");
        for (const item of items) {
          lines.push(`- ${item.suitePath} › ${item.caseId}`);
        }
      }
    }
  }
  lines.push("", `Evidence hash: \`${run.evidenceSha256}\``, "");
  return lines.join("\n");
}
