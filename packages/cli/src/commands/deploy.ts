/**
 * `raia deploy <environment>` (build spec sections 20 and 22): deploy an
 * approved, immutable release candidate. The environment is restricted to the
 * literal `staging` (development is reserved for later; production does not
 * exist in this tool by design). Deployment progression is polled through the
 * provider: QUEUED → DEPLOYING → HEALTHY, or FAILED with a rollback target.
 */
import type { Deployment, Sha256 } from "@raia/contracts";
import {
  loadWorkflowState,
  reconcileCandidate,
  saveWorkflowState,
  validateProject,
  type CandidateIdentity,
} from "@raia/core";
import { EXIT, UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { readBinding } from "../project-files.js";
import { operationContext, providerForBinding } from "../provider.js";

export interface DeployOptions {
  environment: string;
  yes: boolean;
}

const MAX_POLLS = 10;

export async function runDeploy(
  io: CliIO,
  flags: GlobalFlags,
  options: DeployOptions,
): Promise<number> {
  const projectRoot = io.cwd;

  if (options.environment === "production") {
    throw new UsageError(
      "Production deployment does not exist in this tool: production promotion is reserved for the raia management UI (build spec section 22).",
    );
  }
  if (options.environment !== "staging") {
    throw new UsageError(
      `Unsupported environment "${options.environment}". This tool deploys to: staging.`,
    );
  }

  const binding = await readBinding(projectRoot);
  if (binding === undefined) {
    throw new UsageError("Not a raia project (missing .raia/project.json). Run `raia init` first.");
  }
  let state = await loadWorkflowState(projectRoot);
  if (state === undefined || state.remote?.releaseCandidateId === undefined) {
    throw new UsageError("No release candidate exists; run `raia release create --yes` first.");
  }

  // The deployment must reference the release of the *current* candidate.
  const validation = await validateProject(projectRoot);
  if (validation.candidateSha256 !== state.candidate.candidateSha256) {
    const { state: reconciled } = reconcileCandidate(
      state,
      {
        ...(state.candidate as CandidateIdentity),
        candidateSha256: (validation.candidateSha256 ?? state.candidate.candidateSha256) as Sha256,
      },
      new Date().toISOString(),
    );
    await saveWorkflowState(projectRoot, reconciled);
    throw new UsageError(
      "Local sources changed after the release; the candidate is invalidated. Re-run validate/test/release before deploying.",
    );
  }
  const releaseCandidateId = state.remote.releaseCandidateId;

  if (!options.yes && !flags.nonInteractive) {
    throw new UsageError(
      `deploy would promote release ${releaseCandidateId} to staging for agent ${binding.agentId}.\n` +
        `Re-run with --yes to deploy.`,
    );
  }

  const provider = providerForBinding(projectRoot, binding);
  const created = await provider.createDeployment(
    { ...operationContext(), idempotencyKey: `dep-${releaseCandidateId}-staging` },
    { releaseCandidateId, environment: "staging" },
  );

  const progression: string[] = [created.state];
  let deployment: Deployment = created;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    if (["HEALTHY", "FAILED", "ROLLED_BACK", "SUPERSEDED"].includes(deployment.state)) {
      break;
    }
    deployment = await provider.getDeployment(operationContext(), deployment.id);
    if (progression.at(-1) !== deployment.state) {
      progression.push(deployment.state);
    }
  }

  const healthy = deployment.state === "HEALTHY";
  state = {
    ...state,
    remote: {
      ...state.remote,
      deploymentIds: [...new Set([...(state.remote?.deploymentIds ?? []), deployment.id])],
    },
    evidence: [
      ...state.evidence,
      {
        id: deployment.id,
        type: "deployment",
        sha256: state.candidate.candidateSha256,
        candidateSha256: state.candidate.candidateSha256,
        status: healthy ? "healthy" : "error",
        remoteId: deployment.id,
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  await saveWorkflowState(projectRoot, state);

  const human: string[] = [
    `deploy staging: ${progression.join(" → ")}`,
    `  deployment: ${deployment.id}  release: ${releaseCandidateId}`,
    `  candidate:  ${state.candidate.candidateSha256}`,
  ];
  if (deployment.rollbackTargetId !== undefined) {
    human.push(`  rollback target: ${deployment.rollbackTargetId}`);
  }
  if (!healthy) {
    human.push(`  deployment did not reach HEALTHY (state ${deployment.state}).`);
  }

  emitResult(
    io,
    flags,
    {
      ok: healthy,
      deploymentId: deployment.id,
      releaseCandidateId,
      environment: "staging",
      state: deployment.state,
      progression,
      rollbackTargetId: deployment.rollbackTargetId ?? null,
      requestId: null,
    },
    human,
  );
  return healthy ? EXIT.OK : EXIT.OPERATIONAL;
}
