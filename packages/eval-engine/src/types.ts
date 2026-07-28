/**
 * Evaluation engine result model (build spec section 21). Timestamps are
 * informational and excluded from the deterministic evidence hash.
 */
import type { Sha256 } from "@raia/contracts";

export const ENGINE_VERSION = "0.1.0";

export interface FixtureData {
  assistantMessage: string;
  toolCalls?: Array<{ name: string; arguments?: unknown; result?: unknown }>;
  stateTransitions?: string[];
  finalState?: string;
  latencyMs?: number;
  costUsd?: number;
}

export type AssertionStatus = "passed" | "failed" | "skipped";

export interface AssertionOutcome {
  assertionId: string;
  type: string;
  status: AssertionStatus;
  critical: boolean;
  /** Redacted, size-capped explanation for failures/skips. */
  message?: string;
}

export interface CaseRepetition {
  repetition: number;
  status: "passed" | "failed" | "skipped";
  assertions: AssertionOutcome[];
  latencyMs?: number;
  costUsd?: number;
}

export type CaseStatus = "passed" | "failed" | "flaky" | "skipped";

export interface CaseResult {
  suitePath: string;
  caseId: string;
  description: string;
  criticality: "informational" | "standard" | "high" | "blocking";
  tags: string[];
  caseSha256: Sha256;
  status: CaseStatus;
  /** True when this result must fail the gate (blocking case or critical assertion). */
  gateFailure: boolean;
  repetitions: CaseRepetition[];
}

export interface SuiteRunResult {
  suitePath: string;
  suiteName: string;
  suiteSha256: Sha256;
  cases: CaseResult[];
}

export interface RunTotals {
  cases: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  /** informational-criticality cases are excluded from the denominator. */
  passRate: number;
}

export interface GateResult {
  passed: boolean;
  reasons: string[];
  blockingFailures: Array<{ suitePath: string; caseId: string; assertionId?: string }>;
}

export interface EvaluationRunResult {
  engineVersion: string;
  runId: string;
  mode: "fixture" | "live";
  /** "fixture", or the live runtime profile (e.g. "external-openapi-v1"). */
  provider: string;
  candidateSha256: Sha256 | null;
  seed: number;
  repetitions: number;
  concurrency: 1;
  /** Informational; excluded from the evidence hash. */
  startedAt: string;
  completedAt: string;
  suites: SuiteRunResult[];
  fixtureSha256ByPath: Record<string, Sha256>;
  totals: RunTotals;
  gate: GateResult;
  redactions: number;
  evidenceSha256: Sha256;
}

/** Pluggable qualitative evaluator (build spec section 21). Absent by default. */
export interface RubricEvaluator {
  readonly id: string;
  evaluate(input: { rubric: string; content: string }): Promise<{ score: number }>;
}
