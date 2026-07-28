import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

beforeEach(async () => {
  projectDir = await mkdtemp(path.join(tmpdir(), "raia-wp3-"));
  const init = await cli(["init", "--fixture", HELPDESK, "--yes"]);
  expect(init.code).toBe(0);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("raia test (fixture mode)", () => {
  it("passes on the pristine project and writes all three reports (spec scenario 5)", async () => {
    const result = await cli(["--json", "test"]);
    expect(result.code).toBe(0);
    const parsed = jsonOf(result);
    expect(parsed["ok"]).toBe(true);
    for (const report of ["evaluation.json", "evaluation.junit.xml", "evaluation.md"]) {
      expect(existsSync(path.join(projectDir, "reports", "latest", report))).toBe(true);
    }
    const junit = await readFile(
      path.join(projectDir, "reports", "latest", "evaluation.junit.xml"),
      "utf8",
    );
    expect(junit).toContain('failures="0"');
  });

  it("exits 6 when a blocking fixture regresses (spec scenario 6)", async () => {
    const fixturePath = path.join(projectDir, "fixtures", "password-refusal.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    fixture["assistantMessage"] = "Sure, share your password.";
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));

    const result = await cli(["--json", "test"]);
    expect(result.code).toBe(6);
    const parsed = jsonOf(result);
    expect(parsed["ok"]).toBe(false);
    const runResult = parsed["run"] as { gate: { passed: boolean } };
    expect(runResult.gate.passed).toBe(false);
  });

  it("defaults to fixture mode; unconfigured live mode fails closed with a cost notice", async () => {
    const fixtureRun = await cli(["--json", "test"]);
    expect((jsonOf(fixtureRun)["run"] as { mode: string }).mode).toBe("fixture");

    const saved = process.env["RAIA_AGENT_SECRET_KEY"];
    delete process.env["RAIA_AGENT_SECRET_KEY"];
    try {
      const live = await cli(["--json", "test", "--mode", "live"]);
      // No Agent Secret Key configured → typed auth failure (exit 4), and the
      // explicit cost/network notice still reaches stderr first.
      expect(live.code).toBe(4);
      const error = jsonOf(live)["error"] as Record<string, unknown>;
      expect(error["code"]).toBe("AUTHENTICATION_REQUIRED");
      expect(live.stderr.join("\n")).toMatch(/cost/i);
    } finally {
      if (saved !== undefined) {
        process.env["RAIA_AGENT_SECRET_KEY"] = saved;
      }
    }
  });

  it("reports are byte-stable across runs apart from timestamps", async () => {
    await cli(["test"]);
    const first = JSON.parse(
      await readFile(path.join(projectDir, "reports", "latest", "evaluation.json"), "utf8"),
    ) as Record<string, unknown>;
    await cli(["test"]);
    const second = JSON.parse(
      await readFile(path.join(projectDir, "reports", "latest", "evaluation.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const excluded of ["startedAt", "completedAt"]) {
      delete first[excluded];
      delete second[excluded];
    }
    expect(second).toEqual(first);
  });

  it("compares against a baseline and labels regressions", async () => {
    await cli(["test"]);
    const baselinePath = path.join("reports", "baseline.json");
    await writeFile(
      path.join(projectDir, baselinePath),
      await readFile(path.join(projectDir, "reports", "latest", "evaluation.json"), "utf8"),
    );

    const fixturePath = path.join(projectDir, "fixtures", "order-shipped.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    fixture["assistantMessage"] = "Cannot help.";
    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));

    const result = await cli(["--json", "test", "--baseline", baselinePath]);
    expect(result.code).toBe(6);
    const comparison = jsonOf(result)["comparison"] as {
      regressions: Array<{ caseId: string }>;
    };
    expect(comparison.regressions.map((r) => r.caseId)).toContain("order-lookup");
  });

  it("runs an explicitly selected subset of suites", async () => {
    const result = await cli(["--json", "test", "--suite", "evals/smoke.eval.yaml"]);
    expect(result.code).toBe(0);
    const runResult = jsonOf(result)["run"] as { suites: Array<{ suitePath: string }> };
    expect(runResult.suites.map((s) => s.suitePath)).toEqual(["evals/smoke.eval.yaml"]);
  });
});

describe("raia review", () => {
  it("is ready on a clean project with current evaluation evidence", async () => {
    await cli(["test"]);
    const result = await cli(["--json", "review"]);
    expect(result.code).toBe(0);
    const parsed = jsonOf(result);
    expect(parsed["ready"]).toBe(true);
    expect(parsed["risk"]).toBe("low");
    expect(existsSync(path.join(projectDir, "reports", "latest", "review.json"))).toBe(true);
    expect(existsSync(path.join(projectDir, "reports", "latest", "review.md"))).toBe(true);
  });

  it("blocks without evaluation evidence", async () => {
    const result = await cli(["--json", "review"]);
    expect(result.code).toBe(3);
    const blockers = jsonOf(result)["blockers"] as string[];
    expect(blockers.some((b) => b.startsWith("evaluation.evidence"))).toBe(true);
  });

  it("blocks when evidence is stale for the current candidate and on drift", async () => {
    await cli(["test"]);
    const promptPath = path.join(projectDir, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nBe brief.\n");

    const result = await cli(["--json", "review"]);
    expect(result.code).toBe(3);
    const parsed = jsonOf(result);
    expect(parsed["ready"]).toBe(false);
    const blockers = parsed["blockers"] as string[];
    expect(blockers.some((b) => b.includes("different candidate"))).toBe(true);
    expect(blockers.some((b) => b.startsWith("validation.no-drift"))).toBe(true);
  });

  it("review evidence hash is stable for identical state", async () => {
    await cli(["test"]);
    const first = jsonOf(await cli(["--json", "review"]));
    const second = jsonOf(await cli(["--json", "review"]));
    expect(second["evidenceSha256"]).toBe(first["evidenceSha256"]);
  });
});
