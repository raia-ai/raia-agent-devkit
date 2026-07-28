/**
 * Shared release-readiness aggregation used by `raia review` (report) and
 * `raia release create` (gate). One code path computes the evidence so the
 * report can never disagree with the gate.
 */
import path from "node:path";
import type { RaiaAgentLockFile, SemanticChange, RiskLevel, Sha256 } from "@raia/contracts";
import {
  diffManifests,
  evaluateReleasePolicy,
  loadManifest,
  loadReleasePolicy,
  parseLock,
  validateProject,
  type LoadedManifest,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
  type ValidationResult,
} from "@raia/core";
import type { BaselineComparison, EvaluationRunResult } from "@raia/eval-engine";
import { UsageError } from "./exit-codes.js";
import { readBinding, readTextIfExists, type ProjectBinding } from "./project-files.js";
import { operationContext, providerForBinding } from "./provider.js";
import { snapshotFromExport, snapshotFromLocal } from "./snapshots.js";

const EVALUATION_JSON = "reports/latest/evaluation.json";

export interface EvaluationEvidenceSummary {
  runId: string;
  evidenceSha256: Sha256;
  gatePassed: boolean;
  bound: boolean;
}

export interface ReadinessAggregate {
  binding: ProjectBinding;
  lock: RaiaAgentLockFile;
  baseVersionId: string;
  expectedEtag: string;
  local: LoadedManifest;
  validation: ValidationResult;
  changes: SemanticChange[];
  risk: RiskLevel;
  drift: { local: boolean; remote: boolean };
  evaluationSummary: EvaluationEvidenceSummary | null;
  policyName: string;
  policyResult: PolicyEvaluationResult;
  blockers: string[];
  ready: boolean;
}

export async function aggregateReadiness(projectRoot: string): Promise<ReadinessAggregate> {
  const binding = await readBinding(projectRoot);
  if (binding === undefined) {
    throw new UsageError("Not a raia project (missing .raia/project.json). Run `raia init` first.");
  }
  const lockRaw = await readTextIfExists(path.join(projectRoot, "raia.lock.json"));
  if (lockRaw === undefined) {
    throw new UsageError("Missing raia.lock.json; run `raia init` first.");
  }
  const lock = parseLock(lockRaw);
  const baseVersionId = lock.remote?.baseVersionId;
  const expectedEtag = lock.remote?.etag;
  if (baseVersionId === undefined || expectedEtag === undefined) {
    throw new UsageError("The lock has no remote binding; cannot resolve a base version.");
  }

  const validation = await validateProject(projectRoot);
  const local = await loadManifest(projectRoot);

  const provider = providerForBinding(projectRoot, binding);
  const exported = await provider.exportAgent(operationContext(), binding.agentId, baseVersionId);
  const { changes, risk } = diffManifests(snapshotFromExport(exported), snapshotFromLocal(local));
  const remoteSummary = await provider.listAgents(operationContext(), binding.workspaceId);
  const remoteCurrent = remoteSummary.items.find((agent) => agent.id === binding.agentId);
  const drift = {
    local: lock.manifestSha256 !== local.manifestSha256,
    remote: remoteCurrent !== undefined && remoteCurrent.currentVersionId !== baseVersionId,
  };

  let evaluation: PolicyEvaluationInput["evaluation"];
  let evaluationSummary: EvaluationEvidenceSummary | null = null;
  const evaluationRaw = await readTextIfExists(path.join(projectRoot, EVALUATION_JSON));
  if (evaluationRaw !== undefined) {
    const run = JSON.parse(evaluationRaw) as EvaluationRunResult & {
      comparison?: BaselineComparison;
    };
    const bound = run.candidateSha256 === validation.candidateSha256;
    evaluationSummary = {
      runId: run.runId,
      evidenceSha256: run.evidenceSha256,
      gatePassed: run.gate.passed,
      bound,
    };
    if (bound) {
      evaluation = {
        suitesRun: run.suites.map((suite) => suite.suitePath),
        executedTags: [...new Set(run.suites.flatMap((s) => s.cases.flatMap((c) => c.tags)))],
        passRate: run.totals.passRate,
        gatePassed: run.gate.passed,
        regressionCount: run.comparison?.regressions.length,
      };
    }
  }

  const policyPath = local.manifest.spec.deployment?.releasePolicy;
  if (policyPath === undefined) {
    throw new UsageError(
      "The manifest declares no release policy (spec.deployment.releasePolicy).",
    );
  }
  const policy = await loadReleasePolicy(projectRoot, policyPath);
  const policyResult = evaluateReleasePolicy(policy.policy, {
    validation: {
      ok: validation.ok,
      findingCodes: validation.findings.map((finding) => finding.code),
    },
    drift,
    risk,
    evaluation,
  });

  const blockers = policyResult.requirements
    .filter((requirement) => !requirement.satisfied)
    .map((requirement) => `${requirement.id}: ${requirement.message}`);
  if (evaluationSummary !== null && !evaluationSummary.bound) {
    blockers.push(
      "evaluation.evidence: existing evaluation report is bound to a different candidate; re-run `raia test`",
    );
  }

  return {
    binding,
    lock,
    baseVersionId,
    expectedEtag,
    local,
    validation,
    changes,
    risk,
    drift,
    evaluationSummary,
    policyName: policy.policy.metadata.name,
    policyResult,
    blockers,
    ready: blockers.length === 0,
  };
}
