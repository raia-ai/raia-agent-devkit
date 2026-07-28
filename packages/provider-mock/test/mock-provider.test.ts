import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockManagementProvider } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");

const ctx = (requestId = "req_test") => ({ requestId });

let stateDir: string;
let provider: MockManagementProvider;

beforeEach(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "raia-mock-"));
  provider = new MockManagementProvider({ stateDir, now: () => "2026-07-28T00:00:00.000Z" });
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

describe("MockManagementProvider", () => {
  it("seeds from the helpdesk fixture and lists workspaces and agents", async () => {
    const seeded = await provider.seedFromFixture(HELPDESK);
    expect(seeded).toMatchObject({
      workspaceId: "ws_mock_acme",
      agentId: "agent_mock_helpdesk",
      versionId: "v1",
    });

    const workspaces = await provider.listWorkspaces(ctx());
    expect(workspaces.items.map((w) => w.id)).toEqual(["ws_mock_acme"]);

    const agents = await provider.listAgents(ctx(), "ws_mock_acme");
    expect(agents.items).toHaveLength(1);
    expect(agents.items[0]).toMatchObject({
      id: "agent_mock_helpdesk",
      name: "helpdesk-agent",
      currentVersionId: "v1",
    });
  });

  it("exports a complete bundle: manifest, lock, and all artifacts", async () => {
    await provider.seedFromFixture(HELPDESK);
    const exported = await provider.exportAgent(ctx(), "agent_mock_helpdesk");
    expect(exported.versionId).toBe("v1");
    expect(exported.etag).toBe('W/"agent_mock_helpdesk-v1"');
    const paths = exported.bundle.artifacts.map((a) => a.path);
    expect(paths).toEqual([
      "evals/regression.eval.yaml",
      "evals/smoke.eval.yaml",
      "fixtures/fraud-escalation.json",
      "fixtures/malformed-order.json",
      "fixtures/order-shipped.json",
      "fixtures/password-refusal.json",
      "fixtures/shipped-next-step.json",
      "policies/default.release-policy.yaml",
      "prompts/brand-voice.md",
      "prompts/system.md",
    ]);
    const lock = exported.bundle.lock as { manifestSha256: string };
    expect(lock.manifestSha256).toMatch(/^sha256:/);
  });

  it("export is deterministic for the same version", async () => {
    await provider.seedFromFixture(HELPDESK);
    const first = await provider.exportAgent(ctx(), "agent_mock_helpdesk");
    const second = await provider.exportAgent(ctx(), "agent_mock_helpdesk");
    expect(second).toEqual(first);
  });

  it("returns typed NOT_FOUND errors", async () => {
    await provider.seedFromFixture(HELPDESK);
    await expect(provider.exportAgent(ctx(), "missing")).rejects.toMatchObject({
      name: "ProviderError",
      code: "NOT_FOUND",
    });
    await expect(provider.listAgents(ctx(), "missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(provider.exportAgent(ctx(), "agent_mock_helpdesk", "v99")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("advances versions with a new ETag and keeps prior versions exportable", async () => {
    await provider.seedFromFixture(HELPDESK);
    const versionId = await provider.advanceVersion("agent_mock_helpdesk");
    expect(versionId).toBe("v2");
    const current = await provider.exportAgent(ctx(), "agent_mock_helpdesk");
    expect(current.versionId).toBe("v2");
    expect(current.etag).toBe('W/"agent_mock_helpdesk-v2"');
    const previous = await provider.exportAgent(ctx(), "agent_mock_helpdesk", "v1");
    expect(previous.versionId).toBe("v1");
  });

  it("paginates deterministically with opaque cursors", async () => {
    await provider.seedFromFixture(HELPDESK);
    const pageOne = await provider.listWorkspaces(ctx(), { limit: 1 });
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.nextCursor).toBeUndefined();

    const agentsPage = await provider.listAgents(ctx(), "ws_mock_acme", { limit: 1 });
    expect(agentsPage.items).toHaveLength(1);
    expect(agentsPage.nextCursor).toBeUndefined();

    await expect(provider.listWorkspaces(ctx(), { cursor: "not-a-cursor" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("reports identity with configured scopes", async () => {
    await provider.seedFromFixture(HELPDESK);
    const limited = new MockManagementProvider({ stateDir, scopes: ["agent:read"] });
    const identity = await limited.getIdentity(ctx());
    expect(identity.scopes).toEqual(["agent:read"]);
    expect(identity.workspaceIds).toEqual(["ws_mock_acme"]);
  });

  it("simulates outages with a retryable typed error", async () => {
    const down = new MockManagementProvider({ stateDir, unavailable: true });
    await expect(down.listWorkspaces(ctx())).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("fails closed with typed UNAVAILABLE for operations of later work packages", async () => {
    await provider.seedFromFixture(HELPDESK);
    await expect(
      provider.createEvaluationRun(
        { requestId: "r", idempotencyKey: "k" },
        {
          agentId: "agent_mock_helpdesk",
          candidateSha256: `sha256:${"a".repeat(64)}`,
          suiteSha256: `sha256:${"b".repeat(64)}`,
          suitePaths: [],
          mode: "fixture",
          repetitions: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("serves redacted, size-capped, version-bound traces (spec scenario 14, server side)", async () => {
    await provider.seedFromFixture(HELPDESK);

    const list = await provider.listTraces(ctx(), { agentId: "agent_mock_helpdesk" });
    expect(list.items.map((t) => t.id)).toEqual([
      "trace_failure_1",
      "trace_injection_1",
      "trace_success_1",
    ]);
    const failures = await provider.listTraces(ctx(), {
      agentId: "agent_mock_helpdesk",
      outcome: "failure",
    });
    expect(failures.items.map((t) => t.id)).toEqual(["trace_failure_1"]);

    const trace = await provider.getTrace(ctx(), "trace_failure_1", 102400);
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("ghp_");
    expect(serialized).toContain("[REDACTED");
    expect(trace.redactions.length).toBeGreaterThan(0);
    expect(trace.truncated).toBe(false);

    const capped = await provider.getTrace(ctx(), "trace_failure_1", 1024);
    expect(capped.truncated).toBe(true);
    expect(capped.events.length).toBeLessThan(trace.events.length);
  });
});
