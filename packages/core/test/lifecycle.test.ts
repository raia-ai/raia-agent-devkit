import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChangeState, DeploymentState, Sha256 } from "@raia/contracts";
import {
  applyTransition,
  CHANGE_STATES,
  changeSuccessors,
  decideChangeTransition,
  decideDeploymentTransition,
  DEPLOYMENT_STATES,
  deploymentSuccessors,
  initialWorkflowState,
  loadWorkflowState,
  reconcileCandidate,
  saveWorkflowState,
  type CandidateIdentity,
} from "../src/index.js";

const NOW = "2026-07-28T00:00:00Z";

function candidate(seed: string): CandidateIdentity {
  const pad = (c: string): Sha256 => `sha256:${c.repeat(64)}` as Sha256;
  return {
    baseVersionId: "v1",
    expectedEtag: 'W/"agent-v1"',
    manifestSha256: pad(seed),
    lockSha256: pad(seed),
    candidateSha256: pad(seed),
    coreVersion: "0.1.0",
  };
}

function freshState() {
  return initialWorkflowState({
    agentId: "agent_mock_helpdesk",
    workspaceId: "ws_mock_acme",
    candidate: candidate("a"),
    now: NOW,
  });
}

describe("pure change transitions (exhaustive)", () => {
  const valid: Array<[ChangeState, ChangeState]> = [
    ["DRAFT", "PLANNED"],
    ["PLANNED", "VALIDATED"],
    ["VALIDATED", "EVALUATED"],
    ["EVALUATED", "APPROVED"],
    ["APPROVED", "RELEASED"],
    ["DRAFT", "REJECTED"],
    ["PLANNED", "REJECTED"],
    ["VALIDATED", "REJECTED"],
    ["EVALUATED", "REJECTED"],
    ["APPROVED", "REJECTED"],
  ];

  it("permits exactly the specified transitions and denies every other pair", () => {
    const validSet = new Set(valid.map(([f, t]) => `${f}->${t}`));
    for (const from of CHANGE_STATES) {
      for (const to of CHANGE_STATES) {
        const decision = decideChangeTransition(from, to);
        expect(decision.ok, `${from} -> ${to}`).toBe(validSet.has(`${from}->${to}`));
        if (!decision.ok) {
          expect(decision.code).toBe("INVALID_TRANSITION");
        }
      }
    }
    expect(changeSuccessors("RELEASED")).toEqual([]);
    expect(changeSuccessors("REJECTED")).toEqual([]);
  });
});

describe("pure deployment transitions (exhaustive)", () => {
  const valid: Array<[DeploymentState, DeploymentState]> = [
    ["QUEUED", "DEPLOYING"],
    ["DEPLOYING", "HEALTHY"],
    ["DEPLOYING", "FAILED"],
    ["HEALTHY", "SUPERSEDED"],
    ["HEALTHY", "ROLLING_BACK"],
    ["FAILED", "ROLLING_BACK"],
    ["ROLLING_BACK", "ROLLED_BACK"],
  ];

  it("permits exactly the specified transitions", () => {
    const validSet = new Set(valid.map(([f, t]) => `${f}->${t}`));
    for (const from of DEPLOYMENT_STATES) {
      for (const to of DEPLOYMENT_STATES) {
        expect(decideDeploymentTransition(from, to).ok, `${from} -> ${to}`).toBe(
          validSet.has(`${from}->${to}`),
        );
      }
    }
    expect(deploymentSuccessors("ROLLED_BACK")).toEqual([]);
    expect(deploymentSuccessors("SUPERSEDED")).toEqual([]);
  });
});

describe("workflow state", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "raia-wfs-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("initial state is schema-valid and persists atomically", async () => {
    const state = freshState();
    await saveWorkflowState(dir, state);
    const loaded = await loadWorkflowState(dir);
    expect(loaded).toEqual(state);
  });

  it("applies the full lifecycle chain with candidate-bound evidence", () => {
    let state = freshState();
    const evidence = (id: string, type: "plan" | "validation" | "evaluation") => ({
      id,
      type,
      sha256: state.candidate.manifestSha256,
      candidateSha256: state.candidate.candidateSha256,
      status: "passed" as const,
      createdAt: NOW,
    });
    state = applyTransition(state, "PLANNED", { now: NOW, evidence: [evidence("p1", "plan")] });
    state = applyTransition(state, "VALIDATED", {
      now: NOW,
      evidence: [evidence("v1", "validation")],
    });
    state = applyTransition(state, "EVALUATED", {
      now: NOW,
      evidence: [evidence("e1", "evaluation")],
    });
    state = applyTransition(state, "APPROVED", { now: NOW });
    state = applyTransition(state, "RELEASED", {
      now: NOW,
      remote: { releaseCandidateId: "rc_1" },
    });
    expect(state.stage).toBe("RELEASED");
    expect(state.evidence.map((e) => e.id)).toEqual(["p1", "v1", "e1"]);
    expect(state.history).toHaveLength(6);
    expect(state.remote?.releaseCandidateId).toBe("rc_1");
  });

  it("denies invalid transitions without modifying state", () => {
    const state = freshState();
    expect(() => applyTransition(state, "RELEASED", { now: NOW })).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
    expect(state.stage).toBe("DRAFT");
    expect(state.history).toHaveLength(1);
  });

  it("rejects evidence bound to a different candidate", () => {
    const state = freshState();
    expect(() =>
      applyTransition(state, "PLANNED", {
        now: NOW,
        evidence: [
          {
            id: "p1",
            type: "plan",
            sha256: candidate("b").manifestSha256,
            candidateSha256: candidate("b").candidateSha256,
            status: "passed",
            createdAt: NOW,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "EVIDENCE_MISMATCH" }));
  });

  it("invalidates evidence and returns to DRAFT when the candidate changes", () => {
    let state = freshState();
    state = applyTransition(state, "PLANNED", {
      now: NOW,
      evidence: [
        {
          id: "p1",
          type: "plan",
          sha256: state.candidate.manifestSha256,
          candidateSha256: state.candidate.candidateSha256,
          status: "passed",
          createdAt: NOW,
        },
      ],
    });
    const { state: reconciled, invalidated } = reconcileCandidate(state, candidate("b"), NOW);
    expect(invalidated).toBe(true);
    expect(reconciled.stage).toBe("DRAFT");
    expect(reconciled.evidence).toEqual([]);
    expect(reconciled.candidate.candidateSha256).toBe(candidate("b").candidateSha256);
    expect(reconciled.history.at(-1)).toMatchObject({ from: "PLANNED", to: "DRAFT" });

    const unchanged = reconcileCandidate(reconciled, candidate("b"), NOW);
    expect(unchanged.invalidated).toBe(false);
    expect(unchanged.state).toBe(reconciled);
  });

  it("refuses to save schema-invalid state", async () => {
    const state = freshState() as unknown as Record<string, unknown>;
    state["stage"] = "SHIPPED";
    await expect(saveWorkflowState(dir, state as never)).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });
  });
});
