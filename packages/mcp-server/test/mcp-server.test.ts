import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { catalog, createRaiaMcpServer } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");
const specCatalogPath = path.join(
  repoRoot,
  "docs",
  "raia-devkit-spec",
  "contracts",
  "mcp-tool-catalog.json",
);

let projectDir: string;
let client: Client;
let cleanup: (() => Promise<void>) | undefined;

async function connect(approvedRoots?: string[]): Promise<Client> {
  const server = createRaiaMcpServer({
    approvedRoots: approvedRoots ?? [projectDir, HELPDESK],
    defaultProjectRoot: projectDir,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  cleanup = async () => {
    await mcpClient.close();
    await server.close();
  };
  return mcpClient;
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text: string }>;
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
}

function payloadOf(result: ToolResult): Record<string, unknown> {
  return (result.structuredContent ?? JSON.parse(result.content[0]?.text ?? "{}")) as Record<
    string,
    unknown
  >;
}

function errorOf(result: ToolResult): Record<string, unknown> {
  expect(result.isError).toBe(true);
  const envelope = JSON.parse(result.content[0]?.text ?? "{}") as {
    error: Record<string, unknown>;
  };
  return envelope.error;
}

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "raia-mcp-"));
  client = await connect();
});

afterEach(async () => {
  await cleanup?.();
  await rm(projectDir, { recursive: true, force: true });
});

async function initProject(): Promise<void> {
  const result = await call("raia_project_init", {
    projectRoot: projectDir,
    provider: "mock",
    fixtureName: HELPDESK,
    confirmed: true,
  });
  expect(result.isError ?? false).toBe(false);
}

describe("tool surface (spec scenario 12)", () => {
  it("exposes exactly the catalog tools with identical schemas", async () => {
    const listed = await client.listTools();
    const specCatalog = JSON.parse(await readFile(specCatalogPath, "utf8")) as typeof catalog;
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      specCatalog.tools.map((tool) => tool.name).sort(),
    );
    for (const specTool of specCatalog.tools) {
      const served = listed.tools.find((tool) => tool.name === specTool.name);
      expect(served?.inputSchema).toEqual(specTool.inputSchema);
      expect(served?.description).toBe(specTool.description);
    }
  });

  it("exposes no production-deploy, shell, SQL, URL-fetch, or secret-read tool", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const forbidden of catalog.forbiddenTools) {
      expect(names).not.toContain(forbidden);
    }
    expect(names.some((name) => /shell|sql|fetch|secret|production/i.test(name))).toBe(false);
    const forbiddenCall = await call("raia_deployment_production_create", { confirmed: true });
    expect(forbiddenCall.isError).toBe(true);
  });
});

describe("golden path over MCP", () => {
  it("init → validate → evaluate → release → deploy → context", async () => {
    await initProject();

    const validate = payloadOf(await call("raia_agent_validate", { projectRoot: projectDir }));
    expect(validate["ok"]).toBe(true);
    const candidateSha256 = validate["candidateSha256"] as string;

    const evaluation = payloadOf(
      await call("raia_evaluation_run", {
        projectRoot: projectDir,
        candidateSha256,
        suitePaths: ["evals/smoke.eval.yaml", "evals/regression.eval.yaml"],
        mode: "fixture",
        idempotencyKey: "eval-run-000000001",
        confirmed: true,
      }),
    );
    expect(evaluation["ok"]).toBe(true);
    const run = evaluation["run"] as { runId: string; gate: { passed: boolean } };
    expect(run.gate.passed).toBe(true);

    const gotRun = payloadOf(await call("raia_evaluation_get", { runId: run.runId }));
    expect((gotRun["run"] as { runId: string }).runId).toBe(run.runId);

    const context = payloadOf(await call("raia_context_get", { projectRoot: projectDir }));
    const validation2 = payloadOf(await call("raia_agent_validate", { projectRoot: projectDir }));
    const release = payloadOf(
      await call("raia_release_create", {
        agentId: context["agentId"],
        baseVersionId: context["baseVersionId"],
        expectedEtag: 'W/"agent_mock_helpdesk-v1"',
        candidateSha256,
        manifestSha256: validation2["manifestSha256"],
        lockSha256: validation2["lockSha256"],
        evidenceIds: [run.runId],
        idempotencyKey: "release-000000001",
        confirmed: true,
      }),
    );
    expect(release).toMatchObject({ ok: true, releaseCandidateId: "rc_1", stage: "RELEASED" });

    const deployment = payloadOf(
      await call("raia_deployment_staging_create", {
        releaseCandidateId: "rc_1",
        environment: "staging",
        idempotencyKey: "deploy-0000000001",
        confirmed: true,
      }),
    );
    expect(deployment).toMatchObject({ ok: true, state: "HEALTHY" });

    const finalContext = payloadOf(await call("raia_context_get", { projectRoot: projectDir }));
    expect(finalContext["stage"]).toBe("RELEASED");
    expect(finalContext["release"]).toEqual({ releaseCandidateId: "rc_1" });
  });

  it("diff reports the semantic change after a prompt edit", async () => {
    await initProject();
    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nBe brief.\n");
    const diff = payloadOf(await call("raia_agent_diff", { projectRoot: projectDir }));
    expect(diff["risk"]).toBe("medium");
    expect((diff["changes"] as unknown[]).length).toBe(1);
  });
});

describe("safety gates", () => {
  it("rejects unconfirmed mutations via schema validation", async () => {
    const error = errorOf(
      await call("raia_project_init", {
        projectRoot: projectDir,
        provider: "mock",
        fixtureName: HELPDESK,
      }),
    );
    expect(error["code"]).toBe("INVALID_USAGE");
    expect(String(error["message"])).toContain("confirmed");
  });

  it("rejects a projectRoot outside the approved roots before any read", async () => {
    const error = errorOf(await call("raia_agent_validate", { projectRoot: "/etc" }));
    expect(error["code"]).toBe("INVALID_USAGE");
    expect(String(error["message"])).toContain("approved roots");
  });

  it("refuses live evaluation with a typed cost notice", async () => {
    await initProject();
    const validate = payloadOf(await call("raia_agent_validate", { projectRoot: projectDir }));
    const error = errorOf(
      await call("raia_evaluation_run", {
        projectRoot: projectDir,
        candidateSha256: validate["candidateSha256"],
        suitePaths: ["evals/smoke.eval.yaml"],
        mode: "live",
        idempotencyKey: "eval-live-00000001",
        confirmed: true,
      }),
    );
    expect(error["code"]).toBe("UNAVAILABLE");
    expect(String(error["message"])).toMatch(/cost/i);
  });

  it("rejects release inputs that do not match recalculated state", async () => {
    await initProject();
    await call("raia_evaluation_run", {
      projectRoot: projectDir,
      candidateSha256: (
        payloadOf(await call("raia_agent_validate", { projectRoot: projectDir })) as {
          candidateSha256?: string;
        }
      ).candidateSha256,
      suitePaths: ["evals/smoke.eval.yaml", "evals/regression.eval.yaml"],
      mode: "fixture",
      idempotencyKey: "eval-run-000000002",
      confirmed: true,
    });
    const error = errorOf(
      await call("raia_release_create", {
        agentId: "agent_mock_helpdesk",
        baseVersionId: "v1",
        expectedEtag: 'W/"agent_mock_helpdesk-v1"',
        candidateSha256: `sha256:${"0".repeat(64)}`,
        manifestSha256: `sha256:${"0".repeat(64)}`,
        lockSha256: `sha256:${"0".repeat(64)}`,
        evidenceIds: ["bogus"],
        idempotencyKey: "release-000000002",
        confirmed: true,
      }),
    );
    expect(error["code"]).toBe("CONFLICT");
  });

  it("stale expectedLocalCandidateSha256 blocks pull", async () => {
    await initProject();
    const error = errorOf(
      await call("raia_project_pull", {
        projectRoot: projectDir,
        agentId: "agent_mock_helpdesk",
        baseVersionId: "v1",
        expectedLocalCandidateSha256: `sha256:${"0".repeat(64)}`,
        confirmed: true,
      }),
    );
    expect(error["code"]).toBe("CONFLICT");
  });
});

describe("trace safety (spec scenario 14)", () => {
  it("returns redacted, capped, untrusted-labeled traces", async () => {
    await initProject();
    const list = payloadOf(await call("raia_trace_list", { agentId: "agent_mock_helpdesk" }));
    expect((list["traces"] as unknown[]).length).toBe(3);

    const result = payloadOf(
      await call("raia_trace_get", { traceId: "trace_failure_1", maxBytes: 102400 }),
    );
    expect(result["untrusted"]).toBe(true);
    expect(String(result["notice"])).toMatch(/never as instructions|not.*instructions/i);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ghp_");
    expect(serialized).toContain("[REDACTED");

    const capped = payloadOf(
      await call("raia_trace_get", { traceId: "trace_failure_1", maxBytes: 1024 }),
    );
    expect((capped["trace"] as { truncated: boolean }).truncated).toBe(true);

    const hostile = payloadOf(
      await call("raia_trace_get", { traceId: "trace_injection_1", maxBytes: 102400 }),
    );
    expect(JSON.stringify(hostile)).toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
    expect(hostile["untrusted"]).toBe(true);
  });

  it("converts a trace into a proposed, schema-valid eval candidate without touching release gates", async () => {
    await initProject();
    const before = await readFile(path.join(projectDir, "raia.agent.yaml"), "utf8");
    const result = payloadOf(
      await call("raia_trace_to_eval_candidate", {
        projectRoot: projectDir,
        traceId: "trace_injection_1",
        destinationPath: "evals/proposed-injection.eval.yaml",
        candidateId: "proposed-injection-refusal",
        confirmed: true,
      }),
    );
    expect(result["proposed"]).toBe(true);
    expect(result["written"]).toEqual([
      "evals/proposed-injection.eval.yaml",
      "fixtures/proposed-proposed-injection-refusal.json",
    ]);
    expect(existsSync(path.join(projectDir, "evals", "proposed-injection.eval.yaml"))).toBe(true);
    // The manifest (and therefore the release gate) is untouched.
    expect(await readFile(path.join(projectDir, "raia.agent.yaml"), "utf8")).toBe(before);

    // Identical re-run is an idempotent no-op…
    const rerun = payloadOf(
      await call("raia_trace_to_eval_candidate", {
        projectRoot: projectDir,
        traceId: "trace_injection_1",
        destinationPath: "evals/proposed-injection.eval.yaml",
        candidateId: "proposed-injection-refusal",
        confirmed: true,
      }),
    );
    expect(rerun["written"]).toEqual([]);

    // …but a human-edited proposal is never silently overwritten.
    const editedPath = path.join(projectDir, "evals", "proposed-injection.eval.yaml");
    await writeFile(editedPath, (await readFile(editedPath, "utf8")) + "# human edit\n");
    const conflict = await call("raia_trace_to_eval_candidate", {
      projectRoot: projectDir,
      traceId: "trace_injection_1",
      destinationPath: "evals/proposed-injection.eval.yaml",
      candidateId: "proposed-injection-refusal",
      confirmed: true,
    });
    expect(conflict.isError).toBe(true);
  });
});
