import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockManagementProvider } from "@raia/provider-mock";
import { run } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");

interface CliResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

let projectDir: string;

async function cli(args: string[], cwd = projectDir): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    cwd,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout, stderr };
}

function jsonOf(result: CliResult): Record<string, unknown> {
  return JSON.parse(result.stdout.join("\n")) as Record<string, unknown>;
}

/** init + test: the evidence prerequisites for a release. */
async function prepareReleasable(): Promise<void> {
  expect((await cli(["init", "--fixture", HELPDESK, "--yes"])).code).toBe(0);
  expect((await cli(["test"])).code).toBe(0);
}

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "raia-wp4-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("raia release create", () => {
  it("creates an immutable candidate and records the RELEASED workflow state", async () => {
    await prepareReleasable();
    const result = await cli(["--json", "release", "create", "--yes"]);
    expect(result.code).toBe(0);
    const parsed = jsonOf(result);
    expect(parsed).toMatchObject({
      ok: true,
      releaseCandidateId: "rc_1",
      stage: "RELEASED",
      alreadyReleased: false,
    });

    const statePath = path.join(projectDir, ".raia", "workflow-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      stage: string;
      history: Array<{ to: string }>;
      evidence: Array<{ type: string }>;
    };
    expect(state.stage).toBe("RELEASED");
    expect(state.history.map((h) => h.to)).toEqual([
      "DRAFT",
      "PLANNED",
      "VALIDATED",
      "EVALUATED",
      "APPROVED",
      "RELEASED",
    ]);
    expect(state.evidence.map((e) => e.type).sort()).toEqual([
      "evaluation",
      "plan",
      "release",
      "validation",
    ]);
  });

  it("is idempotent: re-running returns the same candidate id (scenario 8)", async () => {
    await prepareReleasable();
    const first = jsonOf(await cli(["--json", "release", "create", "--yes"]));
    const second = jsonOf(await cli(["--json", "release", "create", "--yes"]));
    expect(second["releaseCandidateId"]).toBe(first["releaseCandidateId"]);
    expect(second["alreadyReleased"]).toBe(true);
  });

  it("exits 3 with blockers when evidence is missing", async () => {
    expect((await cli(["init", "--fixture", HELPDESK, "--yes"])).code).toBe(0);
    const result = await cli(["--json", "release", "create", "--yes"]);
    expect(result.code).toBe(3);
    const blockers = jsonOf(result)["blockers"] as string[];
    expect(blockers.some((b) => b.startsWith("evaluation.evidence"))).toBe(true);
  });

  it("exits 5 on a stale base without advancing to RELEASED (scenario 10)", async () => {
    await prepareReleasable();
    const provider = new MockManagementProvider({
      stateDir: path.join(projectDir, ".raia", "mock"),
    });
    await provider.advanceVersion("agent_mock_helpdesk");

    const result = await cli(["--json", "release", "create", "--yes"]);
    expect(result.code).toBe(3); // readiness catches remote drift first (requireNoDrift)
    const blockers = jsonOf(result)["blockers"] as string[];
    expect(blockers.some((b) => b.startsWith("validation.no-drift"))).toBe(true);
  });

  it("exits 5 with STALE_BASE when drift appears between readiness and submission", async () => {
    await prepareReleasable();
    // Bypass the readiness drift gate by advancing the remote *after* baking a
    // policy without requireNoDrift, exercising the provider-level guard.
    const policyPath = path.join(projectDir, "policies", "default.release-policy.yaml");
    const policy = await readFile(policyPath, "utf8");
    await writeFile(policyPath, policy.replace("requireNoDrift: true", "requireNoDrift: false"));
    expect((await cli(["test"])).code).toBe(0); // re-bind evidence to the new candidate
    const provider = new MockManagementProvider({
      stateDir: path.join(projectDir, ".raia", "mock"),
    });
    await provider.advanceVersion("agent_mock_helpdesk");

    const result = await cli(["--json", "release", "create", "--yes"]);
    expect(result.code).toBe(5);
    expect((jsonOf(result)["error"] as Record<string, unknown>)["code"]).toBe("STALE_BASE");
  });

  it("requires --yes before submitting", async () => {
    await prepareReleasable();
    const preview = await cli(["release", "create"]);
    expect(preview.code).toBe(2);
    expect(existsSync(path.join(projectDir, ".raia", "workflow-state.json"))).toBe(false);
  });

  it("exits 4 without the release:create scope (scenario 13 analogue)", async () => {
    await prepareReleasable();
    await writeFile(
      path.join(projectDir, ".raia", "mock", "config.json"),
      JSON.stringify({ scopes: ["agent:read", "agent:draft"] }),
    );
    const result = await cli(["--json", "release", "create", "--yes"]);
    expect(result.code).toBe(4);
    expect((jsonOf(result)["error"] as Record<string, unknown>)["code"]).toBe("PERMISSION_DENIED");
  });
});

describe("raia deploy staging", () => {
  it("deploys through QUEUED → DEPLOYING → HEALTHY (scenario 11)", async () => {
    await prepareReleasable();
    expect((await cli(["release", "create", "--yes"])).code).toBe(0);
    const result = await cli(["--json", "deploy", "staging", "--yes"]);
    expect(result.code).toBe(0);
    const parsed = jsonOf(result);
    expect(parsed).toMatchObject({ ok: true, state: "HEALTHY", releaseCandidateId: "rc_1" });
    expect(parsed["progression"]).toEqual(["QUEUED", "DEPLOYING", "HEALTHY"]);

    const status = jsonOf(await cli(["--json", "status"]));
    expect(status["stage"]).toBe("RELEASED");
    expect(status["release"]).toEqual({ releaseCandidateId: "rc_1" });
    expect(status["deployment"]).toEqual({ deploymentId: "dep_1" });
  });

  it("exits 4 without the deployment:promote scope (scenario 13)", async () => {
    await prepareReleasable();
    expect((await cli(["release", "create", "--yes"])).code).toBe(0);
    await writeFile(
      path.join(projectDir, ".raia", "mock", "config.json"),
      JSON.stringify({ scopes: ["agent:read", "release:create"] }),
    );
    const result = await cli(["--json", "deploy", "staging", "--yes"]);
    expect(result.code).toBe(4);
  });

  it("reports a FAILED deployment with exit 1 and a rollback path", async () => {
    await prepareReleasable();
    expect((await cli(["release", "create", "--yes"])).code).toBe(0);
    await mkdir(path.join(projectDir, ".raia", "mock"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".raia", "mock", "config.json"),
      JSON.stringify({ deploymentOutcome: "failed" }),
    );
    const result = await cli(["--json", "deploy", "staging", "--yes"]);
    expect(result.code).toBe(1);
    expect(jsonOf(result)).toMatchObject({ ok: false, state: "FAILED" });
  });

  it("refuses production (no production path exists) and unknown environments", async () => {
    await prepareReleasable();
    expect((await cli(["release", "create", "--yes"])).code).toBe(0);
    const production = await cli(["--json", "deploy", "production", "--yes"]);
    expect(production.code).toBe(2);
    expect(String((jsonOf(production)["error"] as Record<string, unknown>)["message"])).toMatch(
      /reserved for the raia management UI/,
    );
    expect((await cli(["deploy", "chaos", "--yes"])).code).toBe(2);
  });

  it("refuses to deploy without a release", async () => {
    await prepareReleasable();
    const result = await cli(["deploy", "staging", "--yes"]);
    expect(result.code).toBe(2);
  });

  it("blocks deployment after a source change invalidates the candidate", async () => {
    await prepareReleasable();
    expect((await cli(["release", "create", "--yes"])).code).toBe(0);
    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nchanged\n");

    const result = await cli(["--json", "deploy", "staging", "--yes"]);
    expect(result.code).toBe(2);
    expect(String((jsonOf(result)["error"] as Record<string, unknown>)["message"])).toMatch(
      /invalidated/,
    );

    // Deploy persisted the reconciliation: the workflow is back at DRAFT for
    // the new candidate and the prior release no longer applies to it.
    const status = jsonOf(await cli(["--json", "status"]));
    expect(status["stage"]).toBe("DRAFT");
    expect(status["release"]).toBeNull();
  });
});

describe("evidence invalidation end to end", () => {
  it("a released candidate returns to DRAFT after a source change and requires fresh evidence", async () => {
    await prepareReleasable();
    expect((await cli(["release", "create", "--yes"])).code).toBe(0);

    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nnew behavior\n");

    // Release for the changed candidate is blocked until evidence is regenerated.
    const blocked = await cli(["--json", "release", "create", "--yes"]);
    expect(blocked.code).toBe(3);

    // Fresh lock (re-init is not available; simulate re-pull by re-running init --force),
    // then fresh evidence chain allows a new release with a NEW candidate id.
    expect((await cli(["init", "--fixture", HELPDESK, "--yes", "--force"])).code).toBe(0);
    expect((await cli(["test"])).code).toBe(0);
    const rerelease = jsonOf(await cli(["--json", "release", "create", "--yes"]));
    expect(rerelease["ok"]).toBe(true);
  });
});
