import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MutationContext, Sha256 } from "@raia/contracts";
import { MockManagementProvider } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");

const ctx = (requestId = "req_test") => ({ requestId });
const mctx = (idempotencyKey: string, extra?: Partial<MutationContext>): MutationContext => ({
  requestId: "req_test",
  idempotencyKey,
  ...extra,
});

const sha = (c: string): Sha256 => `sha256:${c.repeat(64)}` as Sha256;

const RC_INPUT = {
  agentId: "agent_mock_helpdesk",
  candidateSha256: sha("c"),
  manifestSha256: sha("m"),
  lockSha256: sha("d"),
  evidence: [{ type: "validation", id: "val_1", sha256: sha("e") }],
};

let stateDir: string;
let provider: MockManagementProvider;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "raia-mock-mut-"));
  provider = new MockManagementProvider({ stateDir, now: () => "2026-07-28T00:00:00.000Z" });
  await provider.seedFromFixture(HELPDESK);
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

describe("drafts and optimistic concurrency", () => {
  it("creates a version-bound draft", async () => {
    const draft = await provider.createDraft(
      mctx("k1", { baseVersionId: "v1", expectedEtag: 'W/"agent_mock_helpdesk-v1"' }),
      { agentId: "agent_mock_helpdesk", manifestSha256: sha("m"), bundle: {} },
    );
    expect(draft).toMatchObject({ id: "draft_1", baseVersionId: "v1", state: "DRAFT" });
  });

  it("fails with STALE_BASE when the remote advanced past the base version", async () => {
    await provider.advanceVersion("agent_mock_helpdesk");
    await expect(
      provider.createDraft(mctx("k1", { baseVersionId: "v1" }), {
        agentId: "agent_mock_helpdesk",
        manifestSha256: sha("m"),
        bundle: {},
      }),
    ).rejects.toMatchObject({ code: "STALE_BASE", details: { currentVersionId: "v2" } });
  });

  it("fails with STALE_BASE on an ETag mismatch", async () => {
    await expect(
      provider.createDraft(mctx("k1", { baseVersionId: "v1", expectedEtag: 'W/"wrong"' }), {
        agentId: "agent_mock_helpdesk",
        manifestSha256: sha("m"),
        bundle: {},
      }),
    ).rejects.toMatchObject({ code: "STALE_BASE" });
  });
});

describe("release candidates (spec scenarios 7–10)", () => {
  it("creates an immutable RELEASED candidate", async () => {
    const release = await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    expect(release).toMatchObject({ id: "rc_1", state: "RELEASED", candidateSha256: sha("c") });
  });

  it("idempotent replay returns the original candidate id (scenario 8)", async () => {
    const first = await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    const replay = await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    expect(replay).toEqual(first);
  });

  it("reusing the key with altered hashes fails with IDEMPOTENCY_MISMATCH (scenarios 7 and 9)", async () => {
    await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    await expect(
      provider.createReleaseCandidate(mctx("rk1"), {
        ...RC_INPUT,
        candidateSha256: sha("f"),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("fails with STALE_BASE after the remote advances (scenario 10)", async () => {
    await provider.advanceVersion("agent_mock_helpdesk");
    await expect(
      provider.createReleaseCandidate(mctx("rk1", { baseVersionId: "v1" }), RC_INPUT),
    ).rejects.toMatchObject({ code: "STALE_BASE" });
  });

  it("requires evidence references", async () => {
    await expect(
      provider.createReleaseCandidate(mctx("rk1"), { ...RC_INPUT, evidence: [] }),
    ).rejects.toMatchObject({ code: "POLICY_FAILED" });
  });
});

describe("deployments (spec scenario 11)", () => {
  it("follows QUEUED → DEPLOYING → HEALTHY deterministically", async () => {
    await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    const created = await provider.createDeployment(mctx("dk1"), {
      releaseCandidateId: "rc_1",
      environment: "staging",
    });
    expect(created.state).toBe("QUEUED");
    expect(await provider.getDeployment(ctx(), created.id)).toMatchObject({ state: "DEPLOYING" });
    expect(await provider.getDeployment(ctx(), created.id)).toMatchObject({ state: "HEALTHY" });
    // Terminal state is stable on further polls.
    expect(await provider.getDeployment(ctx(), created.id)).toMatchObject({ state: "HEALTHY" });
  });

  it("captures a rollback target and supersedes the prior HEALTHY deployment", async () => {
    await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    const first = await provider.createDeployment(mctx("dk1"), {
      releaseCandidateId: "rc_1",
      environment: "staging",
    });
    await provider.getDeployment(ctx(), first.id);
    await provider.getDeployment(ctx(), first.id);

    await provider.createReleaseCandidate(mctx("rk2"), {
      ...RC_INPUT,
      candidateSha256: sha("9"),
    });
    const second = await provider.createDeployment(mctx("dk2"), {
      releaseCandidateId: "rc_2",
      environment: "staging",
    });
    expect(second.rollbackTargetId).toBe(first.id);
    await provider.getDeployment(ctx(), second.id);
    await provider.getDeployment(ctx(), second.id);
    expect(await provider.getDeployment(ctx(), first.id)).toMatchObject({ state: "SUPERSEDED" });
  });

  it("supports a failing deployment fixture and explicit rollback", async () => {
    const failing = new MockManagementProvider({ stateDir, deploymentOutcome: "failed" });
    await failing.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    const deployment = await failing.createDeployment(mctx("dk1"), {
      releaseCandidateId: "rc_1",
      environment: "staging",
    });
    await failing.getDeployment(ctx(), deployment.id);
    const failed = await failing.getDeployment(ctx(), deployment.id);
    expect(failed.state).toBe("FAILED");

    const rolling = await failing.rollbackDeployment(mctx("rb1"), deployment.id, "deploy failed");
    expect(rolling.state).toBe("ROLLING_BACK");
    expect(await failing.getDeployment(ctx(), deployment.id)).toMatchObject({
      state: "ROLLED_BACK",
    });
  });

  it("rejects production deployments by server policy", async () => {
    await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    await expect(
      provider.createDeployment(mctx("dk1"), {
        releaseCandidateId: "rc_1",
        environment: "production",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("rejects rollback from an invalid state and without a reason", async () => {
    await provider.createReleaseCandidate(mctx("rk1"), RC_INPUT);
    const deployment = await provider.createDeployment(mctx("dk1"), {
      releaseCandidateId: "rc_1",
      environment: "staging",
    });
    await expect(
      provider.rollbackDeployment(mctx("rb1"), deployment.id, "still queued"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(
      provider.rollbackDeployment(mctx("rb2"), deployment.id, "  "),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("permission fixtures (spec scenario 13)", () => {
  it("denies mutations without the required scope", async () => {
    const readOnly = new MockManagementProvider({ stateDir, scopes: ["agent:read"] });
    await expect(
      readOnly.createDraft(mctx("k1"), {
        agentId: "agent_mock_helpdesk",
        manifestSha256: sha("m"),
        bundle: {},
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(readOnly.createReleaseCandidate(mctx("k2"), RC_INPUT)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(
      readOnly.createDeployment(mctx("k3"), { releaseCandidateId: "rc_1", environment: "staging" }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
