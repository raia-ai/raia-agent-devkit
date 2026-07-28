/**
 * Pure lifecycle decisions (build spec section 14, lifecycle framework
 * sections 5–7). No I/O: every transition is a pure function; persistence is a
 * separate adapter. Invalid transitions return INVALID_TRANSITION and change
 * nothing.
 */
import type { ChangeState, DeploymentState } from "@raia/contracts";

const CHANGE_TRANSITIONS: Record<ChangeState, readonly ChangeState[]> = {
  DRAFT: ["PLANNED", "REJECTED"],
  PLANNED: ["VALIDATED", "REJECTED"],
  VALIDATED: ["EVALUATED", "REJECTED"],
  EVALUATED: ["APPROVED", "REJECTED"],
  APPROVED: ["RELEASED", "REJECTED"],
  REJECTED: [],
  RELEASED: [],
};

const DEPLOYMENT_TRANSITIONS: Record<DeploymentState, readonly DeploymentState[]> = {
  QUEUED: ["DEPLOYING"],
  DEPLOYING: ["HEALTHY", "FAILED"],
  HEALTHY: ["SUPERSEDED", "ROLLING_BACK"],
  FAILED: ["ROLLING_BACK"],
  ROLLING_BACK: ["ROLLED_BACK"],
  ROLLED_BACK: [],
  SUPERSEDED: [],
};

export type TransitionDecision =
  { ok: true } | { ok: false; code: "INVALID_TRANSITION"; message: string };

export function decideChangeTransition(from: ChangeState, to: ChangeState): TransitionDecision {
  if (CHANGE_TRANSITIONS[from].includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "INVALID_TRANSITION",
    message: `Change state cannot move from ${from} to ${to}.`,
  };
}

export function decideDeploymentTransition(
  from: DeploymentState,
  to: DeploymentState,
): TransitionDecision {
  if (DEPLOYMENT_TRANSITIONS[from].includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "INVALID_TRANSITION",
    message: `Deployment cannot move from ${from} to ${to}.`,
  };
}

export function changeSuccessors(from: ChangeState): readonly ChangeState[] {
  return CHANGE_TRANSITIONS[from];
}

export function deploymentSuccessors(from: DeploymentState): readonly DeploymentState[] {
  return DEPLOYMENT_TRANSITIONS[from];
}

export const CHANGE_STATES = Object.keys(CHANGE_TRANSITIONS) as ChangeState[];
export const DEPLOYMENT_STATES = Object.keys(DEPLOYMENT_TRANSITIONS) as DeploymentState[];
