/**
 * `raia status` (build spec section 20): local and remote drift, evidence,
 * release, and deployment summary. Read-only.
 */
import path from "node:path";
import { loadManifest, loadWorkflowState, parseLock, validateProject } from "@raia/core";
import { UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { readBinding, readTextIfExists, VALIDATION_REPORT_PATH } from "../project-files.js";
import { operationContext, providerForBinding } from "../provider.js";

export async function runStatus(io: CliIO, flags: GlobalFlags): Promise<number> {
  const projectRoot = io.cwd;
  const binding = await readBinding(projectRoot);
  if (binding === undefined) {
    throw new UsageError("Not a raia project (missing .raia/project.json). Run `raia init` first.");
  }

  const lockRaw = await readTextIfExists(path.join(projectRoot, "raia.lock.json"));
  const lock = lockRaw === undefined ? undefined : parseLock(lockRaw);

  const local = await loadManifest(projectRoot);
  const validation = await validateProject(projectRoot);

  const provider = providerForBinding(projectRoot, binding);
  const remotePage = await provider.listAgents(operationContext(), binding.workspaceId);
  const remote = remotePage.items.find((agent) => agent.id === binding.agentId);

  const baseVersionId = lock?.remote?.baseVersionId;
  const localDrift = lock !== undefined && lock.manifestSha256 !== local.manifestSha256;
  const remoteDrift =
    remote !== undefined &&
    baseVersionId !== undefined &&
    remote.currentVersionId !== baseVersionId;

  const reportRaw = await readTextIfExists(path.join(projectRoot, VALIDATION_REPORT_PATH));
  let evidence: { present: boolean; ok?: boolean; current?: boolean } = { present: false };
  if (reportRaw !== undefined) {
    const report = JSON.parse(reportRaw) as { ok?: boolean; candidateSha256?: string };
    evidence = {
      present: true,
      ok: report.ok === true,
      current: report.candidateSha256 === validation.candidateSha256,
    };
  }

  // Workflow stage (read-only): a changed candidate reads as DRAFT without
  // persisting the reconciliation — status has no side effects.
  const workflow = await loadWorkflowState(projectRoot);
  let stage: string | null = null;
  let release: { releaseCandidateId: string } | null = null;
  let deployment: { deploymentId: string } | null = null;
  let candidateInvalidated = false;
  if (workflow !== undefined && validation.candidateSha256 !== undefined) {
    candidateInvalidated = workflow.candidate.candidateSha256 !== validation.candidateSha256;
    stage = candidateInvalidated ? "DRAFT" : workflow.stage;
    if (!candidateInvalidated && workflow.remote?.releaseCandidateId !== undefined) {
      release = { releaseCandidateId: workflow.remote.releaseCandidateId };
    }
    const lastDeployment = workflow.remote?.deploymentIds?.at(-1);
    if (!candidateInvalidated && lastDeployment !== undefined) {
      deployment = { deploymentId: lastDeployment };
    }
  }

  const payload = {
    ok: true,
    agentId: binding.agentId,
    workspaceId: binding.workspaceId,
    provider: binding.provider,
    candidateSha256: validation.candidateSha256,
    manifestSha256: local.manifestSha256,
    baseVersionId: baseVersionId ?? null,
    remoteCurrentVersionId: remote?.currentVersionId ?? null,
    localDrift,
    remoteDrift,
    validationOk: validation.ok,
    evidence,
    stage,
    candidateInvalidated,
    release,
    deployment,
  };

  emitResult(io, flags, payload, [
    `agent:      ${binding.agentId} (workspace ${binding.workspaceId}, provider ${binding.provider})`,
    `candidate:  ${validation.candidateSha256 ?? "unknown"}`,
    `base:       ${baseVersionId ?? "none"}  remote current: ${remote?.currentVersionId ?? "unknown"}`,
    `drift:      local ${localDrift ? "YES (manifest differs from lock)" : "no"}, remote ${
      remoteDrift ? "YES (remote advanced past lock base)" : "no"
    }`,
    `validation: ${validation.ok ? "pass" : "FAIL"}; evidence ${
      evidence.present ? (evidence.current ? "current" : "stale") : "none"
    }`,
    `stage:      ${stage ?? "none"}${candidateInvalidated ? " (prior evidence invalidated by source change)" : ""}`,
    `release:    ${release?.releaseCandidateId ?? "none"}  deployment: ${deployment?.deploymentId ?? "none"}`,
  ]);
  return 0;
}
