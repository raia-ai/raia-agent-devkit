/**
 * Contract tests (WP6 gate): the HTTP client and the conforming local server
 * round-trip every ManagementProvider operation over the wire defined by
 * contracts/raia-management.openapi.yaml — success shapes, typed failures,
 * idempotency, optimistic concurrency, and auth.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MutationContext, Sha256 } from "@raia/contracts";
import { MockManagementProvider } from "@raia/provider-mock";
import { createMockManagementServer, startMockManagementServer } from "@raia/mock-management-api";
import { HttpManagementProvider } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");
const AGENT = "agent_mock_helpdesk";

const ctx = (requestId = "req_client_test") => ({ requestId });
const mctx = (idempotencyKey: string, extra?: Partial<MutationContext>): MutationContext => ({
  requestId: "req_client_test",
  idempotencyKey,
  ...extra,
});
const sha = (c: string): Sha256 => `sha256:${c.repeat(64)}` as Sha256;

let stateDir: string;
let close: () => Promise<void>;
let client: HttpManagementProvider;
let seededEtag: string;
let baseUrl: string;

beforeAll(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "raia-http-contract-"));
  const mock = new MockManagementProvider({ stateDir, now: () => "2026-07-28T00:00:00.000Z" });
  const seeded = await mock.seedFromFixture(HELPDESK);
  seededEtag = seeded.etag;
  const started = await startMockManagementServer(
    createMockManagementServer({ provider: mock, acceptedTokens: ["test-service-token"] }),
  );
  close = started.close;
  baseUrl = started.baseUrl;
  client = new HttpManagementProvider({
    credential: { kind: "service-token", bearerToken: "test-service-token" },
    baseUrl: started.baseUrl,
    // Retries still happen (the UNAVAILABLE test exercises them); only the
    // waits are collapsed so the suite stays fast.
    retry: { sleep: () => Promise.resolve() },
  });
});

afterAll(async () => {
  await close();
  await rm(stateDir, { recursive: true, force: true });
});

describe("read operations over the wire", () => {
  it("returns the identity with scopes", async () => {
    const identity = await client.getIdentity(ctx());
    expect(identity.principalId).toBe("mock-user");
    expect(identity.scopes).toContain("release:create");
    expect(identity.workspaceIds.length).toBeGreaterThan(0);
  });

  it("paginates workspaces and agents (nulls become absence)", async () => {
    const workspaces = await client.listWorkspaces(ctx(), { limit: 1 });
    expect(workspaces.items).toHaveLength(1);
    expect(workspaces.nextCursor).toBeUndefined();
    const agents = await client.listAgents(ctx(), workspaces.items[0]!.id);
    expect(agents.items.map((agent) => agent.id)).toContain(AGENT);
    expect(Object.values(agents.items[0]!)).not.toContain(null);
  });

  it("rejects an out-of-contract limit with a typed validation error", async () => {
    await expect(client.listWorkspaces(ctx(), { limit: 500 })).rejects.toMatchObject({
      name: "ProviderError",
      code: "VALIDATION_FAILED",
    });
  });

  it("exports the agent bundle with its ETag", async () => {
    const exported = await client.exportAgent(ctx(), AGENT);
    expect(exported.etag).toBe(seededEtag);
    expect(exported.versionId).toBe("v1");
    expect(exported.bundle.artifacts.length).toBeGreaterThan(0);
  });

  it("maps 404 problems to NOT_FOUND with the server request id", async () => {
    const error = await client.exportAgent(ctx(), "agent_missing").catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ProviderError", code: "NOT_FOUND" });
    expect((error as { requestId?: string }).requestId).toMatch(/^req_srv_/);
  });
});

describe("mutations over the wire", () => {
  it("creates a draft with Idempotency-Key + If-Match and replays identically", async () => {
    const input = {
      agentId: AGENT,
      manifestSha256: sha("a"),
      bundle: { manifest: {}, lock: {}, artifacts: [] },
    };
    const context = mctx("draft-key-0000000001", { baseVersionId: "v1", expectedEtag: seededEtag });
    const draft = await client.createDraft(context, input);
    expect(draft).toMatchObject({ agentId: AGENT, baseVersionId: "v1", state: "DRAFT" });
    const replay = await client.createDraft(context, input);
    expect(replay).toEqual(draft);
  });

  it("fails IDEMPOTENCY_MISMATCH when the same key carries a different request", async () => {
    await expect(
      client.createDraft(
        mctx("draft-key-0000000001", { baseVersionId: "v1", expectedEtag: seededEtag }),
        {
          agentId: AGENT,
          manifestSha256: sha("b"),
          bundle: { manifest: {}, lock: {}, artifacts: [] },
        },
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("fails STALE_BASE when the If-Match ETag is stale", async () => {
    await expect(
      client.createDraft(
        mctx("draft-key-0000000002", { baseVersionId: "v1", expectedEtag: 'W/"stale"' }),
        {
          agentId: AGENT,
          manifestSha256: sha("a"),
          bundle: { manifest: {}, lock: {}, artifacts: [] },
        },
      ),
    ).rejects.toMatchObject({ code: "STALE_BASE" });
  });

  it("refuses to send a draft without an explicit base version and ETag", async () => {
    await expect(
      client.createDraft(mctx("draft-key-0000000003"), {
        agentId: AGENT,
        manifestSha256: sha("a"),
        bundle: { manifest: {}, lock: {}, artifacts: [] },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("refuses idempotency keys outside the 16-200 char contract before sending", async () => {
    await expect(
      client.createDeployment(mctx("short"), {
        releaseCandidateId: "rc_x",
        environment: "staging",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("drives release candidate → staging deployment → HEALTHY → rollback over HTTP", async () => {
    const candidate = await client.createReleaseCandidate(
      mctx("release-key-000000001", { baseVersionId: "v1" }),
      {
        agentId: AGENT,
        candidateSha256: sha("c"),
        manifestSha256: sha("m"),
        lockSha256: sha("d"),
        evidence: [{ type: "validation", id: "val_1", sha256: sha("e") }],
      },
    );
    expect(candidate.state).toBe("RELEASED");

    const deployment = await client.createDeployment(mctx("deploy-key-0000000001"), {
      releaseCandidateId: candidate.id,
      environment: "staging",
    });
    expect(deployment.state).toBe("QUEUED");

    let current = deployment;
    for (let poll = 0; poll < 5 && current.state !== "HEALTHY"; poll += 1) {
      current = await client.getDeployment(ctx(), deployment.id);
    }
    expect(current.state).toBe("HEALTHY");

    const rollback = await client.rollbackDeployment(
      mctx("rollback-key-00000001"),
      deployment.id,
      "contract test rollback",
    );
    expect(rollback.state).toBe("ROLLING_BACK");
  });

  it("surfaces the typed UNAVAILABLE failure for remote change plans", async () => {
    await expect(
      client.createChangePlan(ctx(), {
        agentId: AGENT,
        baseVersionId: "v1",
        manifestSha256: sha("a"),
        bundle: { manifest: {}, lock: {}, artifacts: [] },
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("traces over the wire", () => {
  it("lists trace summaries and fetches a redacted trace", async () => {
    const page = await client.listTraces(ctx(), { agentId: AGENT });
    expect(page.items.length).toBeGreaterThan(0);
    const trace = await client.getTrace(ctx(), page.items[0]!.id, 262144);
    expect(trace.agentId).toBe(AGENT);
    expect(JSON.stringify(trace)).not.toContain("MockTraceTokenAbcdefghijklmnop123456");
  });
});

describe("authentication", () => {
  it("maps a rejected bearer token to AUTHENTICATION_REQUIRED and never retries it", async () => {
    const attempts: number[] = [];
    const bad = new HttpManagementProvider({
      credential: { kind: "service-token", bearerToken: "wrong-token" },
      baseUrl,
      retry: { sleep: () => Promise.resolve() },
      logger: (entry) => attempts.push(entry.attempt),
    });
    await expect(bad.getIdentity(ctx())).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(attempts).toEqual([1]);
  });
});
