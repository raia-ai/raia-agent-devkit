/**
 * `raia release create` (build spec sections 20 and 22): recalculate all local
 * hashes, verify required evidence against those hashes, check the remote
 * base/ETag, and submit one idempotent request. The workflow state is driven
 * through the pure lifecycle engine; the resulting candidate is immutable.
 */
import type { Sha256, WorkflowEvidence } from "@raia/contracts";
import {
  applyTransition,
  CORE_VERSION,
  initialWorkflowState,
  loadWorkflowState,
  reconcileCandidate,
  saveWorkflowState,
  type CandidateIdentity,
} from "@raia/core";
import { EXIT, UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { aggregateReadiness, type ReadinessAggregate } from "../readiness.js";
import { operationContext, providerForBinding } from "../provider.js";

export interface ReleaseOptions {
  yes: boolean;
}

function candidateIdentity(aggregate: ReadinessAggregate): CandidateIdentity {
  const { validation } = aggregate;
  if (
    validation.candidateSha256 === undefined ||
    validation.lockSha256 === undefined ||
    validation.manifestSha256 === undefined
  ) {
    throw new UsageError("The project does not produce a complete candidate identity.");
  }
  return {
    baseVersionId: aggregate.baseVersionId,
    expectedEtag: aggregate.expectedEtag,
    manifestSha256: validation.manifestSha256,
    lockSha256: validation.lockSha256,
    candidateSha256: validation.candidateSha256,
    coreVersion: CORE_VERSION,
    ...(validation.releasePolicySha256 !== undefined
      ? { releasePolicySha256: validation.releasePolicySha256 }
      : {}),
  };
}

export async function runReleaseCreate(
  io: CliIO,
  flags: GlobalFlags,
  options: ReleaseOptions,
): Promise<number> {
  const projectRoot = io.cwd;
  const aggregate = await aggregateReadiness(projectRoot);

  if (!aggregate.ready) {
    const human = ["release: NOT ready — resolve these blockers first:"];
    for (const blocker of aggregate.blockers) {
      human.push(`  ⛔ ${blocker}`);
    }
    emitResult(io, flags, { ok: false, ready: false, blockers: aggregate.blockers }, human);
    return EXIT.VALIDATION;
  }

  const identity = candidateIdentity(aggregate);
  const now = () => new Date().toISOString();

  let state =
    (await loadWorkflowState(projectRoot)) ??
    initialWorkflowState({
      agentId: aggregate.binding.agentId,
      workspaceId: aggregate.binding.workspaceId,
      candidate: identity,
      now: now(),
    });
  state = reconcileCandidate(state, identity, now()).state;

  // Idempotent local completion: this exact candidate is already released.
  if (state.stage === "RELEASED" && state.remote?.releaseCandidateId !== undefined) {
    emitResult(
      io,
      flags,
      {
        ok: true,
        releaseCandidateId: state.remote.releaseCandidateId,
        candidateSha256: identity.candidateSha256,
        stage: state.stage,
        alreadyReleased: true,
      },
      [
        `release: candidate already released as ${state.remote.releaseCandidateId} (idempotent re-run)`,
      ],
    );
    return EXIT.OK;
  }

  if (!options.yes && !flags.nonInteractive) {
    throw new UsageError(
      `release create would submit an immutable candidate for agent ${aggregate.binding.agentId}\n` +
        `  candidate: ${identity.candidateSha256}\n` +
        `  base:      ${identity.baseVersionId} (etag ${identity.expectedEtag})\n` +
        `Re-run with --yes to submit.`,
    );
  }

  const evidence = (
    id: string,
    type: WorkflowEvidence["type"],
    sha256: Sha256,
    status: WorkflowEvidence["status"],
  ): WorkflowEvidence => ({
    id,
    type,
    sha256,
    candidateSha256: identity.candidateSha256,
    status,
    createdAt: now(),
  });

  const validationEvidence = evidence(
    `val_${aggregate.validation.evidenceSha256!.slice(7, 19)}`,
    "validation",
    aggregate.validation.evidenceSha256!,
    "passed",
  );
  const planEvidence = evidence(
    `plan_${identity.candidateSha256.slice(7, 19)}`,
    "plan",
    aggregate.validation.evidenceSha256!,
    "passed",
  );
  const evaluationEvidence = evidence(
    aggregate.evaluationSummary!.runId,
    "evaluation",
    aggregate.evaluationSummary!.evidenceSha256,
    "passed",
  );

  if (state.stage === "DRAFT") {
    state = applyTransition(state, "PLANNED", { now: now(), evidence: [planEvidence] });
    await saveWorkflowState(projectRoot, state);
  }
  if (state.stage === "PLANNED") {
    state = applyTransition(state, "VALIDATED", { now: now(), evidence: [validationEvidence] });
    await saveWorkflowState(projectRoot, state);
  }
  if (state.stage === "VALIDATED") {
    state = applyTransition(state, "EVALUATED", { now: now(), evidence: [evaluationEvidence] });
    await saveWorkflowState(projectRoot, state);
  }
  if (state.stage === "EVALUATED") {
    // Staging requires zero approvals in the MVP policy (verified by readiness).
    state = applyTransition(state, "APPROVED", { now: now() });
    await saveWorkflowState(projectRoot, state);
  }

  const provider = providerForBinding(projectRoot, aggregate.binding);
  const release = await provider.createReleaseCandidate(
    {
      ...operationContext(),
      idempotencyKey: `rc-${identity.candidateSha256}`,
      baseVersionId: identity.baseVersionId,
      expectedEtag: identity.expectedEtag,
    },
    {
      agentId: aggregate.binding.agentId,
      candidateSha256: identity.candidateSha256,
      manifestSha256: identity.manifestSha256,
      lockSha256: identity.lockSha256,
      evidence: [
        {
          type: "validation",
          id: validationEvidence.id,
          sha256: validationEvidence.sha256 as Sha256,
        },
        {
          type: "evaluation",
          id: evaluationEvidence.id,
          sha256: evaluationEvidence.sha256 as Sha256,
        },
      ],
    },
  );

  state = applyTransition(state, "RELEASED", {
    now: now(),
    evidence: [evidence(release.id, "release", identity.candidateSha256, "created")],
    remote: { releaseCandidateId: release.id },
  });
  await saveWorkflowState(projectRoot, state);

  emitResult(
    io,
    flags,
    {
      ok: true,
      releaseCandidateId: release.id,
      candidateSha256: identity.candidateSha256,
      baseVersionId: release.baseVersionId,
      stage: state.stage,
      alreadyReleased: false,
    },
    [
      `release: created immutable candidate ${release.id}`,
      `  candidate: ${identity.candidateSha256}`,
      `  base:      ${release.baseVersionId}`,
      `  stage:     ${state.stage}`,
      `Next: raia deploy staging --yes`,
    ],
  );
  return EXIT.OK;
}
