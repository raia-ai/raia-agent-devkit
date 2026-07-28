/**
 * Remaining policy/workflow-state branch coverage: defaulted policy fields,
 * approval requirements above zero, missing required tags, corrupt state
 * files, and actor attribution in the audit history.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RaiaAgentReleasePolicy } from "@raia/contracts";
import {
  applyTransition,
  evaluateReleasePolicy,
  initialWorkflowState,
  loadWorkflowState,
  WORKFLOW_STATE_PATH,
  type PolicyEvaluationInput,
} from "../src/index.js";

const SHA = `sha256:${"a".repeat(64)}` as const;

function minimalPolicy(overrides?: Record<string, unknown>): RaiaAgentReleasePolicy {
  return {
    apiVersion: "devkit.raia.ai/v1alpha1",
    kind: "ReleasePolicy",
    metadata: { name: "minimal" },
    spec: {
      // maximumRisk deliberately omitted: exercises the "critical" default.
      validation: { requireSchema: true, requireSecretScan: false },
      evaluation: { requiredSuites: [], requiredTags: [] },
      approval: { stagingApprovals: 0, productionApprovals: 2 },
      environments: { claudeCodeAllowed: ["staging"], requireImmutableRelease: true },
      ...overrides,
    },
  } as unknown as RaiaAgentReleasePolicy;
}

const input = (over?: Partial<PolicyEvaluationInput>): PolicyEvaluationInput =>
  ({
    validation: { ok: true, findingCodes: [] },
    drift: { local: false, remote: false },
    risk: "critical",
    ...over,
  }) as PolicyEvaluationInput;

describe("policy defaults and failure arms", () => {
  it("defaults maximumRisk to critical and reports schema failures", () => {
    const clean = evaluateReleasePolicy(minimalPolicy(), input());
    expect(clean.requirements.find((r) => r.id === "validation.maximum-risk")?.satisfied).toBe(
      true,
    );

    const broken = evaluateReleasePolicy(
      minimalPolicy(),
      input({ validation: { ok: false, findingCodes: ["SCHEMA_INVALID"] } }),
    );
    expect(broken.satisfied).toBe(false);
    expect(broken.requirements.find((r) => r.id === "validation.schema")?.satisfied).toBe(false);
    expect(broken.requirements.find((r) => r.id === "validation.overall")?.satisfied).toBe(false);
  });

  it("reports missing required tags by name", () => {
    const policy = minimalPolicy({
      evaluation: { requiredSuites: [], requiredTags: ["release-gate", "safety"] },
    });
    const result = evaluateReleasePolicy(
      policy,
      input({
        evaluation: {
          suitesRun: [],
          executedTags: ["release-gate"],
          passRate: 1,
          gatePassed: true,
          regressionCount: 0,
        },
      }),
    );
    const requirement = result.requirements.find((r) => r.id === "evaluation.required-tags");
    expect(requirement?.satisfied).toBe(false);
    expect(requirement?.message).toContain("safety");
  });

  it("fails closed while staging approvals above zero are unsupported", () => {
    const policy = minimalPolicy({
      approval: { stagingApprovals: 1, productionApprovals: 2 },
    });
    const result = evaluateReleasePolicy(policy, input());
    expect(result.satisfied).toBe(false);
    expect(result.requirements.find((r) => r.id === "approval.staging")?.satisfied).toBe(false);
  });
});

describe("workflow-state edges", () => {
  it("records the acting principal in history when supplied", () => {
    const state = initialWorkflowState({
      agentId: "agent_1",
      workspaceId: "ws_1",
      candidate: {
        baseVersionId: "v1",
        expectedEtag: 'W/"agent_1-v1"',
        manifestSha256: SHA,
        lockSha256: SHA,
        candidateSha256: SHA,
        coreVersion: "0.1.0",
      },
      now: "2026-07-28T00:00:00.000Z",
      actor: "user:reviewer",
    });
    expect(state.history[0]?.actor).toBe("user:reviewer");
    const planned = applyTransition(state, "PLANNED", {
      now: "2026-07-28T00:01:00.000Z",
      actor: "user:reviewer",
    });
    expect(planned.history.at(-1)?.actor).toBe("user:reviewer");
  });

  it("rejects corrupt workflow-state JSON with SCHEMA_INVALID", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "raia-state-"));
    try {
      const statePath = path.join(dir, WORKFLOW_STATE_PATH);
      await import("node:fs/promises").then((fs) =>
        fs.mkdir(path.dirname(statePath), { recursive: true }),
      );
      await writeFile(statePath, "{corrupt");
      await expect(loadWorkflowState(dir)).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
