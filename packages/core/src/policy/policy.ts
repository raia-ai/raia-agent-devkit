/**
 * Release-policy evaluation (build spec section 15 `policy`): pure decisions,
 * no network side effects. Requirements are deterministic and ordered; anything
 * the policy demands that cannot be proven is unsatisfied (fail closed).
 */
import type { RaiaAgentReleasePolicy, RiskLevel } from "@raia/contracts";

export interface PolicyEvaluationInput {
  validation: {
    ok: boolean;
    findingCodes: string[];
  };
  drift: {
    local: boolean;
    remote: boolean;
  };
  risk: RiskLevel;
  evaluation:
    | {
        suitesRun: string[];
        executedTags: string[];
        passRate: number;
        gatePassed: boolean;
        regressionCount: number | undefined;
      }
    | undefined;
}

export interface PolicyRequirementResult {
  id: string;
  satisfied: boolean;
  message: string;
}

export interface PolicyEvaluationResult {
  satisfied: boolean;
  requirements: PolicyRequirementResult[];
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function evaluateReleasePolicy(
  policy: RaiaAgentReleasePolicy,
  input: PolicyEvaluationInput,
): PolicyEvaluationResult {
  const requirements: PolicyRequirementResult[] = [];
  const add = (id: string, satisfied: boolean, message: string): void => {
    requirements.push({ id, satisfied, message });
  };
  const spec = policy.spec;

  if (spec.validation.requireSchema) {
    const schemaClean =
      input.validation.ok ||
      !input.validation.findingCodes.some(
        (code) => code === "SCHEMA_INVALID" || code === "MANIFEST_INVALID",
      );
    add(
      "validation.schema",
      schemaClean,
      schemaClean ? "schema validation passed" : "schema validation failed",
    );
  }
  if (spec.validation.requireSecretScan) {
    const clean = !input.validation.findingCodes.includes("SECRET_DETECTED");
    add(
      "validation.secret-scan",
      clean,
      clean ? "secret scan found nothing" : "secret scan reported findings",
    );
  }
  add(
    "validation.overall",
    input.validation.ok,
    input.validation.ok ? "validation passed" : "validation has blocking findings",
  );
  if (spec.validation.requireNoDrift) {
    const noDrift = !input.drift.local && !input.drift.remote;
    add(
      "validation.no-drift",
      noDrift,
      noDrift
        ? "no local or remote drift"
        : `drift detected (local: ${input.drift.local}, remote: ${input.drift.remote})`,
    );
  }
  const maximumRisk = spec.validation.maximumRisk ?? "critical";
  const riskOk = RISK_ORDER[input.risk] <= RISK_ORDER[maximumRisk];
  add(
    "validation.maximum-risk",
    riskOk,
    riskOk
      ? `risk ${input.risk} within maximum ${maximumRisk}`
      : `risk ${input.risk} exceeds maximum ${maximumRisk}`,
  );

  const evaluation = input.evaluation;
  if (evaluation === undefined) {
    add("evaluation.evidence", false, "no evaluation evidence for the current candidate");
  } else {
    add("evaluation.evidence", true, "evaluation evidence bound to the current candidate");
    const missingSuites = spec.evaluation.requiredSuites.filter(
      (suite) => !evaluation.suitesRun.includes(suite),
    );
    add(
      "evaluation.required-suites",
      missingSuites.length === 0,
      missingSuites.length === 0
        ? "all required suites executed"
        : `required suites not executed: ${missingSuites.join(", ")}`,
    );
    const requiredTags = spec.evaluation.requiredTags ?? [];
    const missingTags = requiredTags.filter((tag) => !evaluation.executedTags.includes(tag));
    if (requiredTags.length > 0) {
      add(
        "evaluation.required-tags",
        missingTags.length === 0,
        missingTags.length === 0
          ? "all required tags covered"
          : `required tags not covered: ${missingTags.join(", ")}`,
      );
    }
    const minimumPassRate = spec.evaluation.minimumPassRate;
    if (minimumPassRate !== undefined) {
      const ok = evaluation.passRate >= minimumPassRate;
      add(
        "evaluation.pass-rate",
        ok,
        `pass rate ${evaluation.passRate} ${ok ? ">=" : "<"} required ${minimumPassRate}`,
      );
    }
    if (spec.evaluation.blockOnCriticalFailure) {
      add(
        "evaluation.no-critical-failure",
        evaluation.gatePassed,
        evaluation.gatePassed
          ? "no blocking or critical failures"
          : "evaluation gate reported blocking or critical failures",
      );
    }
    const maximumRegressions = spec.evaluation.maximumRegressionCount;
    if (maximumRegressions !== undefined) {
      if (evaluation.regressionCount === undefined) {
        add(
          "evaluation.regressions",
          true,
          "no baseline comparison available; regression budget not exercised",
        );
      } else {
        const ok = evaluation.regressionCount <= maximumRegressions;
        add(
          "evaluation.regressions",
          ok,
          `regressions ${evaluation.regressionCount} ${ok ? "<=" : ">"} allowed ${maximumRegressions}`,
        );
      }
    }
  }

  const stagingApprovals = spec.approval.stagingApprovals;
  add(
    "approval.staging",
    stagingApprovals === 0,
    stagingApprovals === 0
      ? "staging requires no approvals"
      : `staging requires ${stagingApprovals} approval(s); approval records arrive in a later work package`,
  );

  requirements.sort((a, b) => a.id.localeCompare(b.id));
  return { satisfied: requirements.every((r) => r.satisfied), requirements };
}
