/**
 * `raia test` (build spec sections 20 and 21): execute fixture-mode suites and
 * write JSON/JUnit/Markdown evidence. Fixture mode is the default; live mode
 * must be selected explicitly and is refused until a conversation runtime
 * exists (WP6) — with a clear cost/network notice either way.
 */
import path from "node:path";
import { ProviderError } from "@raia/contracts";
import { loadEvaluationSuite, validateProject, type LoadedSuite } from "@raia/core";
import {
  compareRuns,
  renderJsonReport,
  renderJunitReport,
  renderMarkdownReport,
  runEvaluation,
  type BaselineComparison,
  type EvaluationRunResult,
} from "@raia/eval-engine";
import { EXIT, UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { readTextIfExists, writeFileAtomic } from "../project-files.js";

export interface TestOptions {
  mode: string;
  suite: string[] | undefined;
  baseline: string | undefined;
  seed: number | undefined;
  repetitions: number | undefined;
}

export const EVALUATION_REPORT_DIR = "reports/latest";

export async function runTest(
  io: CliIO,
  flags: GlobalFlags,
  options: TestOptions,
): Promise<number> {
  const projectRoot = io.cwd;

  if (options.mode === "live") {
    throw new ProviderError(
      "Live evaluation may create remote conversations and incur model usage costs. " +
        "It requires a configured conversation runtime, which arrives in a later work package (WP6). " +
        "Fixture mode remains the deterministic default: re-run without --mode live.",
      "UNAVAILABLE",
    );
  }
  if (options.mode !== "fixture") {
    throw new UsageError(`Unknown --mode "${options.mode}" (fixture | live).`);
  }

  const validation = await validateProject(projectRoot);
  if (validation.manifestSha256 === undefined) {
    throw new UsageError("The project manifest could not be loaded; run `raia validate` first.");
  }

  const suitePaths =
    options.suite !== undefined && options.suite.length > 0
      ? options.suite
      : Object.keys(validation.suiteSha256ByPath ?? {});
  if (suitePaths.length === 0) {
    throw new UsageError("No evaluation suites configured or selected (--suite <path>).");
  }

  const suites: LoadedSuite[] = [];
  for (const suitePath of suitePaths) {
    suites.push(await loadEvaluationSuite(projectRoot, suitePath));
  }

  const run = await runEvaluation({
    suites,
    ...(validation.candidateSha256 !== undefined
      ? { candidateSha256: validation.candidateSha256 }
      : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.repetitions !== undefined ? { repetitions: options.repetitions } : {}),
  });

  let comparison: BaselineComparison | undefined;
  if (options.baseline !== undefined) {
    const baselineRaw = await readTextIfExists(path.resolve(projectRoot, options.baseline));
    if (baselineRaw === undefined) {
      throw new UsageError(`Baseline report not found: ${options.baseline}`);
    }
    comparison = compareRuns(JSON.parse(baselineRaw) as EvaluationRunResult, run);
  }

  const reportPaths = {
    json: `${EVALUATION_REPORT_DIR}/evaluation.json`,
    junit: `${EVALUATION_REPORT_DIR}/evaluation.junit.xml`,
    markdown: `${EVALUATION_REPORT_DIR}/evaluation.md`,
  };
  await writeFileAtomic(
    path.join(projectRoot, reportPaths.json),
    renderJsonReport(run, comparison),
  );
  await writeFileAtomic(path.join(projectRoot, reportPaths.junit), renderJunitReport(run));
  await writeFileAtomic(
    path.join(projectRoot, reportPaths.markdown),
    renderMarkdownReport(run, comparison),
  );

  const nonInformationalFailure = run.suites.some((suite) =>
    suite.cases.some(
      (c) => c.criticality !== "informational" && (c.status === "failed" || c.status === "flaky"),
    ),
  );
  const gateFailed = !run.gate.passed || nonInformationalFailure;

  const human: string[] = [
    `evaluation: ${gateFailed ? "FAIL" : "PASS"} — ${run.totals.passed}/${run.totals.cases} cases, ` +
      `pass rate ${(run.totals.passRate * 100).toFixed(1)}% (mode ${run.mode}, seed ${run.seed})`,
  ];
  for (const reason of run.gate.reasons) {
    human.push(`  ⛔ ${reason}`);
  }
  if (comparison !== undefined) {
    human.push(
      `  baseline: ${comparison.regressions.length} regression(s), ${comparison.improvements.length} improvement(s), ` +
        `${comparison.unchangedFailures.length} unchanged failure(s), ${comparison.flaky.length} flaky`,
    );
  }
  human.push(`  reports:  ${reportPaths.json}, ${reportPaths.junit}, ${reportPaths.markdown}`);

  emitResult(
    io,
    flags,
    { ok: !gateFailed, run, ...(comparison ? { comparison } : {}), reportPaths },
    human,
  );
  return gateFailed ? EXIT.EVAL_GATE : EXIT.OK;
}
