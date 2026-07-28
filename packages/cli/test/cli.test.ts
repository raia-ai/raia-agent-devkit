import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function initProject(): Promise<void> {
  const result = await cli(["init", "--fixture", HELPDESK, "--yes"]);
  expect(result.code).toBe(0);
}

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "raia-cli-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("golden path (no network, no credentials)", () => {
  it("init → validate → diff → status", async () => {
    await initProject();
    expect(existsSync(path.join(projectDir, "raia.agent.yaml"))).toBe(true);
    expect(existsSync(path.join(projectDir, "raia.lock.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, ".raia", "project.json"))).toBe(true);

    const validate = await cli(["--json", "validate"]);
    expect(validate.code).toBe(0);
    const validation = jsonOf(validate);
    expect(validation["ok"]).toBe(true);
    expect(validation["findings"]).toEqual([]);

    const diff = await cli(["--json", "diff"]);
    expect(diff.code).toBe(0);
    expect(jsonOf(diff)["changes"]).toEqual([]);

    const status = await cli(["--json", "status"]);
    expect(status.code).toBe(0);
    const statusJson = jsonOf(status);
    expect(statusJson).toMatchObject({
      ok: true,
      agentId: "agent_mock_helpdesk",
      localDrift: false,
      remoteDrift: false,
      validationOk: true,
    });
  });

  it("shows a semantic diff and drift after a prompt edit", async () => {
    await initProject();
    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nBe brief.\n");

    const diff = await cli(["--json", "diff"]);
    expect(diff.code).toBe(0);
    const parsed = jsonOf(diff);
    expect(parsed["risk"]).toBe("medium");
    expect((parsed["changes"] as unknown[]).length).toBe(1);

    const status = await cli(["--json", "status"]);
    expect(jsonOf(status)).toMatchObject({ localDrift: true, remoteDrift: false });
    // Local edit invalidates the lock → validate now fails (exit 3, LOCK_DRIFT).
    const validate = await cli(["--json", "validate"]);
    expect(validate.code).toBe(3);
  });

  it("detects remote drift after the mock remote advances", async () => {
    await initProject();
    const provider = new MockManagementProvider({
      stateDir: path.join(projectDir, ".raia", "mock"),
    });
    await provider.advanceVersion("agent_mock_helpdesk");

    const status = await cli(["--json", "status"]);
    expect(jsonOf(status)).toMatchObject({
      localDrift: false,
      remoteDrift: true,
      baseVersionId: "v1",
      remoteCurrentVersionId: "v2",
    });

    const diff = await cli(["--json", "diff", "--against", "remote"]);
    expect(diff.code).toBe(0);
  });

  it("doctor passes on a healthy project and fails outside one", async () => {
    await initProject();
    const healthy = await cli(["--json", "doctor"]);
    expect(healthy.code).toBe(0);
    expect(jsonOf(healthy)["ok"]).toBe(true);

    const empty = await mkdtemp(path.join(tmpdir(), "raia-empty-"));
    try {
      const sick = await cli(["--json", "doctor"], empty);
      expect(sick.code).toBe(1);
      expect(jsonOf(sick)["ok"]).toBe(false);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("exit-code contract (build spec section 20.1)", () => {
  it("exit 2: unknown provider, missing fixture, unknown --against, not a project", async () => {
    expect((await cli(["init", "--provider", "cloud", "--yes"])).code).toBe(2);
    expect((await cli(["init", "--fixture", "does-not-exist", "--yes"])).code).toBe(2);
    await initProject();
    expect((await cli(["diff", "--against", "nonsense"])).code).toBe(2);
    const empty = await mkdtemp(path.join(tmpdir(), "raia-empty-"));
    try {
      expect((await cli(["status"], empty)).code).toBe(2);
      expect((await cli(["diff"], empty)).code).toBe(2);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("exit 2: unknown command or flag", async () => {
    expect((await cli(["frobnicate"])).code).toBe(2);
    expect((await cli(["doctor", "--bogus"])).code).toBe(2);
  });

  it("exit 3: validation failure with the JSON error/finding output", async () => {
    await initProject();
    const token = ["ghp_", "Abcdefghijklmnopqrstuvwxyz012345"].join("");
    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, `token = ${token}\n`);
    const validate = await cli(["--json", "validate"]);
    expect(validate.code).toBe(3);
    const parsed = jsonOf(validate);
    expect(parsed["ok"]).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain(token);
  });

  it("exit 1: provider object missing (operational)", async () => {
    await initProject();
    await rm(path.join(projectDir, ".raia", "mock"), { recursive: true, force: true });
    const diff = await cli(["--json", "diff"]);
    expect(diff.code).toBe(1);
    const parsed = jsonOf(diff);
    expect(parsed["ok"]).toBe(false);
    expect((parsed["error"] as Record<string, unknown>)["code"]).toBe("NOT_FOUND");
  });

  it("exit 0: --version and help", async () => {
    expect((await cli(["--version"])).code).toBe(0);
    expect((await cli(["--help"])).code).toBe(0);
  });
});

describe("write safety (build spec section 20)", () => {
  it("requires --yes (or interactivity) before writing", async () => {
    const preview = await cli(["init", "--fixture", HELPDESK]);
    expect(preview.code).toBe(2);
    expect(existsSync(path.join(projectDir, "raia.agent.yaml"))).toBe(false);
  });

  it("refuses to overwrite modified files without --force", async () => {
    await initProject();
    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, "locally modified\n");

    const again = await cli(["--json", "init", "--fixture", HELPDESK, "--yes"]);
    expect(again.code).toBe(2);
    expect(await readFile(promptPath, "utf8")).toBe("locally modified\n");

    const forced = await cli(["--json", "init", "--fixture", HELPDESK, "--yes", "--force"]);
    expect(forced.code).toBe(0);
    expect(await readFile(promptPath, "utf8")).not.toBe("locally modified\n");
  });

  it("re-running init over an unchanged project is a no-op", async () => {
    await initProject();
    const rerun = await cli(["--json", "init", "--fixture", HELPDESK, "--yes"]);
    expect(rerun.code).toBe(0);
    const parsed = jsonOf(rerun);
    expect(parsed["written"]).toEqual([]);
  });
});

describe("JSON mode stability", () => {
  it("emits exactly one parseable JSON object per command", async () => {
    await initProject();
    for (const args of [
      ["--json", "doctor"],
      ["--json", "validate"],
      ["--json", "diff"],
      ["--json", "status"],
    ]) {
      const result = await cli(args);
      expect(() => jsonOf(result)).not.toThrow();
    }
  });

  it("status JSON is deterministic for an unchanged project", async () => {
    await initProject();
    const first = jsonOf(await cli(["--json", "status"]));
    const second = jsonOf(await cli(["--json", "status"]));
    expect(second).toEqual(first);
  });
});
