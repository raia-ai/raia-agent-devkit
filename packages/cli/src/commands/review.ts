/**
 * `raia review` (build spec sections 20 and 22): aggregate diff, validation,
 * evaluation, risk, and release-policy evidence into a signed-by-hash summary.
 * Report only — no remote object is created. Exit 0 when release-ready,
 * exit 3 when blockers remain.
 */
import path from "node:path";
import {
  diffManifests,
  evaluateReleasePolicy,
  hashCanonical,
  loadManifest,
  loadReleasePolicy,
  parseLock,
  validateProject,
  type PolicyEvaluationInput,
} from "@raia/core";
import type { EvaluationRunResult } from "@raia/eval-engine";
import type { BaselineComparison } from "@raia/eval-engine";
import { EXIT, UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { readBinding, readTextIfExists, writeFileAtomic } from "../project-files.js";
import { operationContext, providerForBinding } from "../provider.js";
import { snapshotFromExport, snapshotFromLocal } from "../snapshots.js";

const REVIEW_JSON = "reports/latest/review.json";
const REVIEW_MD = "reports/latest/review.md";
const EVALUATION_JSON = "reports/latest/evaluation.json";

export async function runReview(io: CliIO, flags: GlobalFlags): Promise<number> {
  const projectRoot = io.cwd;
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

  const validation = await validateProject(projectRoot);
  const local = await loadManifest(projectRoot);

  // Semantic diff and remote drift against the lock's base version.
  const provider = providerForBinding(projectRoot, binding);
  const exported = await provider.exportAgent(operationContext(), binding.agentId, baseVersionId);
  const { changes, risk } = diffManifests(snapshotFromExport(exported), snapshotFromLocal(local));
  const remoteSummary = await provider.listAgents(operationContext(), binding.workspaceId);
  const remoteCurrent = remoteSummary.items.find((agent) => agent.id === binding.agentId);
  const drift = {
    local: lock.manifestSha256 !== local.manifestSha256,
    remote:
      remoteCurrent !== undefined &&
      baseVersionId !== undefined &&
      remoteCurrent.currentVersionId !== baseVersionId,
  };

  // Evaluation evidence must be bound to the exact current candidate.
  let evaluation: PolicyEvaluationInput["evaluation"];
  let evaluationSummary: {
    runId: string;
    evidenceSha256: string;
    gatePassed: boolean;
    bound: boolean;
  } | null = null;
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
  const ready = blockers.length === 0;

  const reviewPayload = {
    ready,
    candidateSha256: validation.candidateSha256 ?? null,
    manifestSha256: local.manifestSha256,
    lockSha256: validation.lockSha256 ?? null,
    baseVersionId: baseVersionId ?? null,
    risk,
    changeCount: changes.length,
    changes,
    drift,
    validation: {
      ok: validation.ok,
      findings: validation.findings,
      evidenceSha256: validation.evidenceSha256 ?? null,
    },
    evaluation: evaluationSummary,
    policy: { name: policy.policy.metadata.name, requirements: policyResult.requirements },
    blockers,
  };
  const evidenceSha256 = hashCanonical(reviewPayload);
  const report = { generatedAt: new Date().toISOString(), evidenceSha256, ...reviewPayload };

  await writeFileAtomic(
    path.join(projectRoot, REVIEW_JSON),
    JSON.stringify(report, null, 2) + "\n",
  );
  const md: string[] = [
    `# Release review`,
    "",
    `- Ready: **${ready ? "YES" : "NO"}**`,
    `- Candidate: ${reviewPayload.candidateSha256 ?? "unknown"}`,
    `- Risk: ${risk} (${changes.length} semantic change(s) vs base ${baseVersionId ?? "?"})`,
    `- Validation: ${validation.ok ? "pass" : "FAIL"}`,
    `- Evaluation: ${
      evaluationSummary === null
        ? "missing"
        : `${evaluationSummary.runId} (gate ${evaluationSummary.gatePassed ? "passed" : "failed"}, ${
            evaluationSummary.bound ? "bound" : "STALE"
          })`
    }`,
    "",
    "## Policy requirements",
    "",
    "| Requirement | Satisfied | Detail |",
    "| --- | --- | --- |",
    ...policyResult.requirements.map(
      (r) => `| ${r.id} | ${r.satisfied ? "✅" : "❌"} | ${r.message} |`,
    ),
    "",
    `Evidence hash: \`${evidenceSha256}\``,
    "",
  ];
  await writeFileAtomic(path.join(projectRoot, REVIEW_MD), md.join("\n"));

  const human: string[] = [
    `review: ${ready ? "READY for release" : "NOT ready"} — risk ${risk}, ${changes.length} change(s)`,
  ];
  for (const blocker of blockers) {
    human.push(`  ⛔ ${blocker}`);
  }
  human.push(`  reports: ${REVIEW_JSON}, ${REVIEW_MD}`);

  emitResult(io, flags, { ok: ready, ...report, reportPaths: [REVIEW_JSON, REVIEW_MD] }, human);
  return ready ? EXIT.OK : EXIT.VALIDATION;
}
