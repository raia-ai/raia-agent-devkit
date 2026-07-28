/**
 * `raia test` (build spec sections 20 and 21): execute evaluation suites and
 * write JSON/JUnit/Markdown evidence. Fixture mode is the deterministic
 * default. Live mode requires explicit `--mode live`, prints a cost/network
 * notice, and runs only when the configured runtime profile has a pinned
 * valid contract and an Agent Secret Key — otherwise it fails closed.
 */
import path from "node:path";
import { ProviderError } from "@raia/contracts";
import {
  createConversationRuntime,
  createLiveCaseExecutor,
  describeRuntime,
  CapabilityUnavailableError,
} from "@raia/conversation-client";
import { loadEvaluationSuite, validateProject, type LoadedSuite } from "@raia/core";
import {
  compareRuns,
  renderJsonReport,
  renderJunitReport,
  renderMarkdownReport,
  runEvaluation,
  type BaselineComparison,
  type CaseExecutor,
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

  let liveExecutor: CaseExecutor | undefined;
  let liveProfile: string | undefined;
  if (options.mode === "live") {
    // Explicit selection + clear cost/network notice (spec item 18).
    io.stderr(
      "live mode: this sends real conversations to the configured raia runtime and may incur model usage costs.",
    );
    const env = process.env;
    const region = flags.region === "eu" ? ("eu" as const) : ("us" as const);
    const description = describeRuntime({ env, region });
    if (!description.available) {
      const reason = description.unavailableReason ?? "the conversation runtime is not configured.";
      throw new ProviderError(
        `Live evaluation is unavailable: ${reason} Fixture mode remains the deterministic default.`,
        description.credentialPresent ? "UNAVAILABLE" : "AUTHENTICATION_REQUIRED",
      );
    }
    try {
      const runtime = createConversationRuntime({
        env,
        region,
        ...(env["RAIA_CONVERSATION_USER_ID"] !== undefined
          ? { conversationUserId: env["RAIA_CONVERSATION_USER_ID"] }
          : {}),
      });
      liveExecutor = createLiveCaseExecutor({ provider: runtime });
      liveProfile = description.profile;
    } catch (error) {
      if (error instanceof CapabilityUnavailableError) {
        throw new ProviderError(error.message, "UNAVAILABLE");
      }
      throw error;
    }
  } else if (options.mode !== "fixture") {
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
    ...(liveExecutor !== undefined && liveProfile !== undefined
      ? { caseExecutor: liveExecutor, mode: "live" as const, providerLabel: liveProfile }
      : {}),
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
