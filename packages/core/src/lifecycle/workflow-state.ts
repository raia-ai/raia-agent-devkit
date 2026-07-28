/**
 * Workflow-state persistence adapter (build spec sections 12.4 and 14,
 * framework sections 7–8). The file contains identifiers and hashes only —
 * never prompt text, trace content, tokens, or resolved secrets. Writes are
 * atomic; a changed candidate hash invalidates prior evidence instead of
 * carrying it forward.
 */
import path from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";
import type {
  RaiaAgentDevKitWorkflowState,
  Sha256,
  WorkflowEvidence,
  WorkflowStage,
} from "@raia/contracts";
import { DevkitError } from "../errors.js";
import type { FileSystem } from "../fs/file-system.js";
import { nodeFileSystem } from "../fs/file-system.js";
import { validateAgainstSchema } from "../schema/validators.js";
import { decideChangeTransition } from "./lifecycle.js";

export const WORKFLOW_STATE_PATH = ".raia/workflow-state.json";

export interface CandidateIdentity {
  baseVersionId: string;
  expectedEtag: string;
  manifestSha256: Sha256;
  lockSha256: Sha256;
  candidateSha256: Sha256;
  coreVersion: string;
  releasePolicySha256?: Sha256;
  gitCommit?: string;
}

export function initialWorkflowState(input: {
  agentId: string;
  workspaceId: string;
  candidate: CandidateIdentity;
  now: string;
  actor?: string;
}): RaiaAgentDevKitWorkflowState {
  return {
    stateVersion: 1,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    stage: "DRAFT",
    candidate: { ...input.candidate },
    evidence: [],
    history: [
      {
        from: null,
        to: "DRAFT",
        candidateSha256: input.candidate.candidateSha256,
        evidenceIds: [],
        occurredAt: input.now,
        ...(input.actor !== undefined ? { actor: input.actor } : {}),
      },
    ],
    updatedAt: input.now,
  };
}

/**
 * A source change creates a new candidate and returns the workflow to DRAFT
 * (framework section 7). History is preserved; prior evidence is dropped, not
 * silently carried forward.
 */
export function reconcileCandidate(
  state: RaiaAgentDevKitWorkflowState,
  candidate: CandidateIdentity,
  now: string,
): { state: RaiaAgentDevKitWorkflowState; invalidated: boolean } {
  if (state.candidate.candidateSha256 === candidate.candidateSha256) {
    return { state, invalidated: false };
  }
  return {
    invalidated: true,
    state: {
      ...state,
      stage: "DRAFT",
      candidate: { ...candidate },
      evidence: [],
      remote: {},
      history: [
        ...state.history,
        {
          from: state.stage,
          to: "DRAFT",
          candidateSha256: candidate.candidateSha256,
          evidenceIds: [],
          occurredAt: now,
        },
      ],
      updatedAt: now,
    },
  };
}

/** Applies a transition through the pure engine, binding evidence to the candidate. */
export function applyTransition(
  state: RaiaAgentDevKitWorkflowState,
  to: WorkflowStage,
  options: {
    now: string;
    evidence?: WorkflowEvidence[];
    remote?: RaiaAgentDevKitWorkflowState["remote"];
    actor?: string;
  },
): RaiaAgentDevKitWorkflowState {
  const decision = decideChangeTransition(state.stage, to);
  if (!decision.ok) {
    throw new DevkitError("INVALID_TRANSITION", decision.message);
  }
  const evidence = options.evidence ?? [];
  for (const item of evidence) {
    if (item.candidateSha256 !== state.candidate.candidateSha256) {
      throw new DevkitError(
        "EVIDENCE_MISMATCH",
        `Evidence ${item.id} is bound to a different candidate than the workflow state.`,
      );
    }
  }
  return {
    ...state,
    stage: to,
    evidence: [...state.evidence, ...evidence],
    ...(options.remote !== undefined ? { remote: { ...state.remote, ...options.remote } } : {}),
    history: [
      ...state.history,
      {
        from: state.stage,
        to,
        candidateSha256: state.candidate.candidateSha256,
        evidenceIds: evidence.map((item) => item.id),
        occurredAt: options.now,
        ...(options.actor !== undefined ? { actor: options.actor } : {}),
      },
    ],
    updatedAt: options.now,
  };
}

export function assertWorkflowStateValid(state: unknown): RaiaAgentDevKitWorkflowState {
  const { valid, issues } = validateAgainstSchema("workflow-state", state);
  if (!valid) {
    throw new DevkitError("SCHEMA_INVALID", "Workflow state violates its schema.", {
      details: { issues },
    });
  }
  return state as RaiaAgentDevKitWorkflowState;
}

export async function loadWorkflowState(
  projectRoot: string,
  options?: { fs?: FileSystem },
): Promise<RaiaAgentDevKitWorkflowState | undefined> {
  const fs = options?.fs ?? nodeFileSystem;
  const absolute = path.join(path.resolve(projectRoot), WORKFLOW_STATE_PATH);
  if (!(await fs.exists(absolute))) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(absolute));
  } catch {
    throw new DevkitError("SCHEMA_INVALID", "Workflow state is not valid JSON.", {
      path: WORKFLOW_STATE_PATH,
    });
  }
  return assertWorkflowStateValid(parsed);
}

export async function saveWorkflowState(
  projectRoot: string,
  state: RaiaAgentDevKitWorkflowState,
): Promise<void> {
  assertWorkflowStateValid(state);
  const absolute = path.join(path.resolve(projectRoot), WORKFLOW_STATE_PATH);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temp = `${absolute}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(temp, absolute);
}
