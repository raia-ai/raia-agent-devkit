/**
 * Fixture-mode evaluation runner (build spec section 21). Pure with respect to
 * the filesystem: it consumes suites already loaded by @raia/core, so runs are
 * deterministic and the engine needs no I/O of its own.
 */
import type { EvalCase, Sha256 } from "@raia/contracts";
import { hashCanonical, type LoadedSuite } from "@raia/core";
import { evaluateAssertion } from "./evaluators.js";
import {
  ENGINE_VERSION,
  type AssertionOutcome,
  type CaseRepetition,
  type CaseResult,
  type EvaluationRunResult,
  type FixtureData,
  type GateResult,
  type RubricEvaluator,
  type SuiteRunResult,
} from "./types.js";

export interface RunOptions {
  suites: LoadedSuite[];
  candidateSha256?: Sha256;
  seed?: number;
  repetitions?: number;
  rubricEvaluator?: RubricEvaluator;
  /** Injectable clock for the informational timestamps. */
  now?: () => string;
  /**
   * Test seam: executes one case repetition. Defaults to the deterministic
   * fixture executor; live mode plugs in here behind explicit selection.
   */
  caseExecutor?: CaseExecutor;
  /** Recorded run mode; "live" is only meaningful with a caseExecutor. */
  mode?: "fixture" | "live";
  /** Recorded executor identity, e.g. the live runtime profile name. */
  providerLabel?: string;
}

export type CaseExecutor = (
  suite: LoadedSuite,
  evalCase: EvalCase,
  repetition: number,
) => Promise<{ fixture: FixtureData } | { skippedReason: string }>;

function lastFixtureRef(evalCase: EvalCase): string | undefined {
  if (!("turns" in evalCase.conversation)) {
    return undefined;
  }
  for (let index = evalCase.conversation.turns.length - 1; index >= 0; index -= 1) {
    const fixtureRef = evalCase.conversation.turns[index]?.fixtureRef;
    if (fixtureRef !== undefined) {
      return fixtureRef;
    }
  }
  return undefined;
}

const defaultExecutor: CaseExecutor = (suite, evalCase) => {
  if (!("turns" in evalCase.conversation)) {
    return Promise.resolve({
      skippedReason: "simulator conversations require live mode (explicitly selected).",
    });
  }
  const fixtureRef = lastFixtureRef(evalCase);
  if (fixtureRef === undefined) {
    return Promise.resolve({
      skippedReason: "no fixtureRef on any turn; fixture mode cannot execute this case.",
    });
  }
  const fixture = suite.fixtures.get(fixtureRef);
  if (fixture === undefined) {
    return Promise.resolve({ skippedReason: `fixture "${fixtureRef}" was not loaded.` });
  }
  return Promise.resolve({ fixture: JSON.parse(fixture.content) as FixtureData });
};

/** Implicit checks derived from the case definition (tool policy, expected states). */
function implicitAssertions(evalCase: EvalCase, fixture: FixtureData): AssertionOutcome[] {
  const outcomes: AssertionOutcome[] = [];
  const toolNames = (fixture.toolCalls ?? []).map((call) => call.name);

  if (evalCase.toolPolicy?.allowed !== undefined) {
    const allowed = new Set(evalCase.toolPolicy.allowed);
    const violations = toolNames.filter((name) => !allowed.has(name));
    outcomes.push({
      assertionId: "tool-policy-allowed",
      type: "tool-policy",
      status: violations.length === 0 ? "passed" : "failed",
      critical: true,
      ...(violations.length > 0
        ? { message: `tools outside the allowed list were called: ${violations.join(", ")}` }
        : {}),
    });
  }
  if (evalCase.toolPolicy?.forbidden !== undefined) {
    const forbidden = new Set(evalCase.toolPolicy.forbidden);
    const violations = toolNames.filter((name) => forbidden.has(name));
    outcomes.push({
      assertionId: "tool-policy-forbidden",
      type: "tool-policy",
      status: violations.length === 0 ? "passed" : "failed",
      critical: true,
      ...(violations.length > 0
        ? { message: `forbidden tools were called: ${violations.join(", ")}` }
        : {}),
    });
  }
  if (evalCase.expectedStates !== undefined && evalCase.expectedStates.length > 0) {
    const observed = new Set([...(fixture.stateTransitions ?? []), fixture.finalState ?? ""]);
    const missing = evalCase.expectedStates.filter((state) => !observed.has(state));
    outcomes.push({
      assertionId: "expected-states",
      type: "conversation-state",
      status: missing.length === 0 ? "passed" : "failed",
      critical: true,
      ...(missing.length > 0
        ? { message: `expected states not observed: ${missing.join(", ")}` }
        : {}),
    });
  }
  return outcomes;
}

export async function runEvaluation(options: RunOptions): Promise<EvaluationRunResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const seed = options.seed ?? 42;
  const repetitions = Math.min(Math.max(options.repetitions ?? 1, 1), 20);
  const executor = options.caseExecutor ?? defaultExecutor;
  const rubricOptions = {
    ...(options.rubricEvaluator !== undefined ? { rubricEvaluator: options.rubricEvaluator } : {}),
  };

  const suites: SuiteRunResult[] = [];
  const fixtureSha256ByPath: Record<string, Sha256> = {};
  const gate: GateResult = { passed: true, reasons: [], blockingFailures: [] };
  let redactions = 0;

  for (const suite of options.suites) {
    for (const [fixturePath, fixture] of suite.fixtures) {
      fixtureSha256ByPath[fixturePath] = fixture.sha256;
    }
    const cases: CaseResult[] = [];
    for (const evalCase of suite.suite.spec.cases) {
      const reps: CaseRepetition[] = [];
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const executed = await executor(suite, evalCase, repetition);
        if ("skippedReason" in executed) {
          reps.push({
            repetition,
            status: "skipped",
            assertions: [
              {
                assertionId: "execution",
                type: "execution",
                status: "skipped",
                critical: false,
                message: executed.skippedReason,
              },
            ],
          });
          continue;
        }
        const fixture = executed.fixture;
        const assertions: AssertionOutcome[] = implicitAssertions(evalCase, fixture);
        for (const assertion of evalCase.assertions) {
          assertions.push(await evaluateAssertion(assertion, evalCase, fixture, rubricOptions));
        }
        redactions += assertions.filter((a) => a.message?.includes("[REDACTED")).length;
        const failed = assertions.some((a) => a.status === "failed");
        reps.push({
          repetition,
          status: failed ? "failed" : "passed",
          assertions,
          ...(fixture.latencyMs !== undefined ? { latencyMs: fixture.latencyMs } : {}),
          ...(fixture.costUsd !== undefined ? { costUsd: fixture.costUsd } : {}),
        });
      }

      const statuses = new Set(reps.map((rep) => rep.status));
      const status: CaseResult["status"] =
        statuses.size > 1 ? "flaky" : ((reps[0]?.status ?? "skipped") as CaseResult["status"]);

      const criticalFailure = reps.some((rep) =>
        rep.assertions.some((a) => a.status === "failed" && a.critical),
      );
      const caseFailed = status === "failed" || status === "flaky";
      const gateFailure = (caseFailed && evalCase.criticality === "blocking") || criticalFailure;

      if (gateFailure) {
        gate.passed = false;
        const failedCritical = reps
          .flatMap((rep) => rep.assertions)
          .find((a) => a.status === "failed" && a.critical);
        gate.blockingFailures.push({
          suitePath: suite.posixRelative,
          caseId: evalCase.id,
          ...(failedCritical !== undefined ? { assertionId: failedCritical.assertionId } : {}),
        });
        gate.reasons.push(
          `${suite.posixRelative} › ${evalCase.id}: ` +
            (evalCase.criticality === "blocking"
              ? "blocking case failed"
              : "critical assertion failed"),
        );
      }

      cases.push({
        suitePath: suite.posixRelative,
        caseId: evalCase.id,
        description: evalCase.description,
        criticality: evalCase.criticality,
        tags: [...(evalCase.tags ?? [])],
        caseSha256: hashCanonical(evalCase),
        status,
        gateFailure,
        repetitions: reps,
      });
    }
    suites.push({
      suitePath: suite.posixRelative,
      suiteName: suite.suite.metadata.name,
      suiteSha256: suite.sha256,
      cases,
    });
  }

  const allCases = suites.flatMap((suite) => suite.cases);
  const counted = allCases.filter((c) => c.criticality !== "informational");
  const passed = counted.filter((c) => c.status === "passed").length;
  const totals = {
    cases: allCases.length,
    passed: allCases.filter((c) => c.status === "passed").length,
    failed: allCases.filter((c) => c.status === "failed").length,
    flaky: allCases.filter((c) => c.status === "flaky").length,
    skipped: allCases.filter((c) => c.status === "skipped").length,
    passRate: counted.length === 0 ? 1 : Number((passed / counted.length).toFixed(4)),
  };

  const runId = `run_${hashCanonical({
    candidate: options.candidateSha256 ?? null,
    suites: options.suites.map((suite) => suite.sha256),
    seed,
    repetitions,
    engineVersion: ENGINE_VERSION,
  }).slice(7, 19)}`;

  const withoutEvidence = {
    engineVersion: ENGINE_VERSION,
    runId,
    mode: options.mode ?? ("fixture" as const),
    provider: options.providerLabel ?? "fixture",
    candidateSha256: options.candidateSha256 ?? null,
    seed,
    repetitions,
    concurrency: 1 as const,
    suites,
    fixtureSha256ByPath,
    totals,
    gate,
    redactions,
  };
  const evidenceSha256 = hashCanonical(withoutEvidence);

  return { ...withoutEvidence, startedAt, completedAt: now(), evidenceSha256 };
}
