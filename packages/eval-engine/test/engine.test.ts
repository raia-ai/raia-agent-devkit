import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEvaluationSuite, loadManifest, type LoadedSuite } from "@raia/core";
import {
  compareRuns,
  renderJsonReport,
  renderJunitReport,
  renderMarkdownReport,
  runEvaluation,
  type EvaluationRunResult,
} from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "raia-eval-"));
  await cp(HELPDESK, projectRoot, { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

async function loadSuites(): Promise<LoadedSuite[]> {
  const loaded = await loadManifest(projectRoot);
  const suites: LoadedSuite[] = [];
  for (const suitePath of loaded.manifest.spec.evaluations?.suites ?? []) {
    suites.push(await loadEvaluationSuite(projectRoot, suitePath));
  }
  return suites;
}

const FIXED_NOW = () => "2026-07-28T00:00:00.000Z";

async function runHelpdesk(): Promise<EvaluationRunResult> {
  return runEvaluation({ suites: await loadSuites(), seed: 42, now: FIXED_NOW });
}

describe("fixture-mode execution", () => {
  it("passes the pristine helpdesk suites and the gate", async () => {
    const run = await runHelpdesk();
    expect(run.totals).toMatchObject({ cases: 5, failed: 0, flaky: 0, skipped: 0 });
    expect(run.totals.passRate).toBe(1);
    expect(run.gate).toMatchObject({ passed: true, blockingFailures: [] });
    expect(run.mode).toBe("fixture");
  });

  it("is deterministic: identical results and evidence hash across runs", async () => {
    const first = await runHelpdesk();
    const second = await runHelpdesk();
    expect(second).toEqual(first);
    expect(renderJsonReport(second)).toBe(renderJsonReport(first));
  });

  it("records candidate, suite, case, and fixture identifiers", async () => {
    const run = await runHelpdesk();
    expect(run.runId).toMatch(/^run_[a-f0-9]{12}$/);
    expect(Object.keys(run.fixtureSha256ByPath)).toHaveLength(5);
    for (const suite of run.suites) {
      expect(suite.suiteSha256).toMatch(/^sha256:/);
      for (const caseResult of suite.cases) {
        expect(caseResult.caseSha256).toMatch(/^sha256:/);
      }
    }
  });

  it("fails the gate when a blocking fixture regresses (spec scenario 6)", async () => {
    const fixturePath = path.join(projectRoot, "fixtures", "password-refusal.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    fixture["assistantMessage"] = "Sure, send me your password and I will log in for you.";
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));

    const run = await runHelpdesk();
    expect(run.gate.passed).toBe(false);
    expect(run.gate.blockingFailures).toContainEqual(
      expect.objectContaining({ caseId: "refuses-password-request" }),
    );
    // Aggregate pass rate stays high (4/5) but cannot mask the gate failure.
    expect(run.totals.passRate).toBeGreaterThanOrEqual(0.8);
  });

  it("enforces tool policy as critical implicit assertions", async () => {
    const fixturePath = path.join(projectRoot, "fixtures", "order-shipped.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      toolCalls: Array<{ name: string }>;
    };
    fixture.toolCalls.push({ name: "issue-refund" });
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));

    const run = await runHelpdesk();
    expect(run.gate.passed).toBe(false);
    const orderCase = run.suites
      .flatMap((suite) => suite.cases)
      .find((c) => c.caseId === "order-lookup");
    const policyOutcome = orderCase?.repetitions[0]?.assertions.find(
      (a) => a.assertionId === "tool-policy-forbidden",
    );
    expect(policyOutcome).toMatchObject({ status: "failed", critical: true });
  });

  it("enforces expectedStates from the case definition", async () => {
    const fixturePath = path.join(projectRoot, "fixtures", "fraud-escalation.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    fixture["stateTransitions"] = [];
    fixture["finalState"] = "resolved";
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));

    const run = await runHelpdesk();
    const fraudCase = run.suites
      .flatMap((suite) => suite.cases)
      .find((c) => c.caseId === "escalates-fraud-claim");
    expect(fraudCase?.status).toBe("failed");
    const states = fraudCase?.repetitions[0]?.assertions.find(
      (a) => a.assertionId === "expected-states",
    );
    expect(states?.status).toBe("failed");
  });

  it("marks repetition-variant outcomes as flaky", async () => {
    const suites = await loadSuites();
    let call = 0;
    const run = await runEvaluation({
      suites: [suites[0]!],
      repetitions: 2,
      now: FIXED_NOW,
      caseExecutor: (suite, evalCase, repetition) => {
        call += 1;
        if (evalCase.id === "order-lookup" && repetition === 2) {
          return Promise.resolve({
            fixture: { assistantMessage: "no tools were used", toolCalls: [] },
          });
        }
        const ref = evalCase.conversation as { turns: Array<{ fixtureRef?: string }> };
        const fixtureRef =
          [...ref.turns].reverse().find((turn) => turn.fixtureRef !== undefined)?.fixtureRef ?? "";
        return Promise.resolve({
          fixture: JSON.parse(suite.fixtures.get(fixtureRef)!.content),
        });
      },
    });
    expect(call).toBe(4);
    const orderCase = run.suites[0]!.cases.find((c) => c.caseId === "order-lookup");
    expect(orderCase?.status).toBe("flaky");
    expect(run.gate.passed).toBe(false);
  });

  it("skips rubric assertions when no evaluator provider is configured, and runs them when one is", async () => {
    const suites = await loadSuites();
    const smoke = structuredClone(suites[0]!);
    smoke.suite.spec.cases[0]!.assertions.push({
      id: "tone-check",
      type: "rubric",
      rubric: "Answer is calm and professional.",
      minimumScore: 0.5,
    } as (typeof smoke.suite.spec.cases)[number]["assertions"][number]);

    const withoutProvider = await runEvaluation({ suites: [smoke], now: FIXED_NOW });
    const rubricOutcome = withoutProvider.suites[0]!.cases[0]!.repetitions[0]!.assertions.find(
      (a) => a.assertionId === "tone-check",
    );
    expect(rubricOutcome).toMatchObject({ status: "skipped" });
    expect(withoutProvider.gate.passed).toBe(true);

    const withProvider = await runEvaluation({
      suites: [smoke],
      now: FIXED_NOW,
      rubricEvaluator: {
        id: "fake",
        evaluate: () => Promise.resolve({ score: 0.9 }),
      },
    });
    const scored = withProvider.suites[0]!.cases[0]!.repetitions[0]!.assertions.find(
      (a) => a.assertionId === "tone-check",
    );
    expect(scored).toMatchObject({ status: "passed" });
  });
});

describe("reports", () => {
  it("renders JSON, JUnit XML, and Markdown", async () => {
    const run = await runHelpdesk();
    const json = renderJsonReport(run);
    expect(() => JSON.parse(json)).not.toThrow();

    const junit = renderJunitReport(run);
    expect(junit).toContain('<?xml version="1.0"');
    expect(junit).toContain('tests="5"');
    expect(junit).toContain('failures="0"');

    const markdown = renderMarkdownReport(run);
    expect(markdown).toContain("# Evaluation report");
    expect(markdown).toContain("Gate: **PASSED**");
    expect(markdown).toContain(run.evidenceSha256);
  });

  it("marks failures in JUnit output", async () => {
    const fixturePath = path.join(projectRoot, "fixtures", "password-refusal.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    fixture["assistantMessage"] = "ok";
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
    const run = await runHelpdesk();
    const junit = renderJunitReport(run);
    expect(junit).toContain('type="critical"');
    expect(junit).toContain("refuses-password-request");
  });
});

describe("baseline comparison", () => {
  it("labels regressions, improvements, unchanged failures, and flakes", async () => {
    const baseline = await runHelpdesk();

    const fixturePath = path.join(projectRoot, "fixtures", "order-shipped.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    fixture["assistantMessage"] = "I cannot help with that.";
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
    const current = await runHelpdesk();

    const comparison = compareRuns(baseline, current);
    expect(comparison.regressions.map((c) => c.caseId)).toContain("order-lookup");
    expect(comparison.improvements).toEqual([]);
    expect(comparison.unchangedFailures).toEqual([]);

    const reversed = compareRuns(current, baseline);
    expect(reversed.improvements.map((c) => c.caseId)).toContain("order-lookup");
  });
});
