/**
 * WP6 CLI wiring: `raia test --mode live` runs real conversations through the
 * pinned external-openapi-v1 runtime (against the loopback contract server),
 * profile gating fails closed, and `raia doctor` reports the runtime profile,
 * contract checksum, server, and auth scheme without credentials.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECTED_CONTRACT_SHA256,
  startMockConversationServer,
  type StartedConversationServer,
} from "@raia/conversation-client";
import { createHttpProvider, run } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HELPDESK = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");
const SECRET = "cli-live-agent-secret-key";

const ENV_KEYS = [
  "RAIA_RUNTIME_PROFILE",
  "RAIA_AGENT_SECRET_KEY",
  "RAIA_CONVERSATION_TEST_BASE_URL",
  "RAIA_CONVERSATION_USER_ID",
] as const;
const savedEnv = new Map<string, string | undefined>();

let projectDir: string;
let server: StartedConversationServer;

interface CliResult {
  code: number;
  stdout: string[];
  stderr: string[];
}

async function cli(args: string[]): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    cwd: projectDir,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout, stderr };
}

function jsonOf(result: CliResult): Record<string, unknown> {
  return JSON.parse(result.stdout.join("\n")) as Record<string, unknown>;
}

beforeAll(async () => {
  server = await startMockConversationServer({
    secretKey: SECRET,
    // Deterministic replies that satisfy the helpdesk fixture assertions are
    // not required: live cases assert on what the runtime actually returns.
    reply: (message) =>
      message.toLowerCase().includes("order")
        ? "Your order ORD-1001 shipped and is on its way."
        : "I cannot help with that, but I will never ask for your password.",
  });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
  projectDir = await mkdtemp(path.join(tmpdir(), "raia-live-"));
  const init = await cli(["init", "--fixture", HELPDESK, "--yes"]);
  expect(init.code).toBe(0);
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(projectDir, { recursive: true, force: true });
});

describe("raia test --mode live", () => {
  it("executes the suites against the conversation runtime and records live mode", async () => {
    process.env["RAIA_AGENT_SECRET_KEY"] = SECRET;
    process.env["RAIA_CONVERSATION_TEST_BASE_URL"] = server.baseUrl;
    process.env["RAIA_CONVERSATION_USER_ID"] = "user_cli_live";

    const result = await cli(["--json", "test", "--mode", "live"]);
    expect(result.stderr.join("\n")).toMatch(/cost/i);
    const parsed = jsonOf(result);
    const runResult = parsed["run"] as {
      mode: string;
      provider: string;
      suites: Array<{ cases: Array<{ caseId: string; status: string }> }>;
    };
    expect(runResult.mode).toBe("live");
    expect(runResult.provider).toBe("external-openapi-v1");
    // The loopback runtime saw real conversations.
    expect(server.requests.some((request) => request.path.endsWith("/messages"))).toBe(true);
    // Live replies differ from the fixtures, so the gate outcome must come
    // from real observations — the JSON report records the live mode too.
    const report = JSON.parse(
      await readFile(path.join(projectDir, "reports", "latest", "evaluation.json"), "utf8"),
    ) as { mode: string; provider: string };
    expect(report.mode).toBe("live");
    expect(report.provider).toBe("external-openapi-v1");
  });

  it("fails closed on the capability-disabled developer-v1 profile", async () => {
    process.env["RAIA_RUNTIME_PROFILE"] = "developer-v1";
    process.env["RAIA_AGENT_SECRET_KEY"] = SECRET;
    const result = await cli(["--json", "test", "--mode", "live"]);
    expect(result.code).toBe(1);
    const error = jsonOf(result)["error"] as Record<string, unknown>;
    expect(error["code"]).toBe("UNAVAILABLE");
    expect(String(error["message"])).toContain("capability-disabled");
  });

  it("refuses a non-loopback conversation base URL override", async () => {
    process.env["RAIA_AGENT_SECRET_KEY"] = SECRET;
    process.env["RAIA_CONVERSATION_TEST_BASE_URL"] = "https://not-raia.example.com";
    const result = await cli(["--json", "test", "--mode", "live"]);
    expect(result.code).toBe(3);
    const error = jsonOf(result)["error"] as Record<string, unknown>;
    expect(error["code"]).toBe("VALIDATION_FAILED");
  });
});

describe("raia doctor runtime report", () => {
  it("reports profile, contract checksum, server, and auth scheme without secrets", async () => {
    process.env["RAIA_AGENT_SECRET_KEY"] = SECRET;
    const result = await cli(["--json", "doctor"]);
    expect(result.code).toBe(0);
    const runtime = jsonOf(result)["runtime"] as Record<string, unknown>;
    expect(runtime).toMatchObject({
      profile: "external-openapi-v1",
      available: true,
      credentialPresent: true,
      contractSha256: PROJECTED_CONTRACT_SHA256,
      server: "https://api.raia2.com",
    });
    expect(String(runtime["authScheme"])).toContain("Agent-Secret-Key");
    expect(result.stdout.join("\n")).not.toContain(SECRET);
  });

  it("flags an unknown runtime profile as a failing check", async () => {
    process.env["RAIA_RUNTIME_PROFILE"] = "guess-something";
    const result = await cli(["--json", "doctor"]);
    expect(result.code).toBe(1);
    const checks = jsonOf(result)["checks"] as Array<{ id: string; ok: boolean }>;
    expect(checks.find((check) => check.id === "conversation-runtime")?.ok).toBe(false);
  });
});

describe("http management provider factory", () => {
  it("requires RAIA_ACCESS_TOKEN and refuses the Agent Secret Key env var", () => {
    expect(() =>
      createHttpProvider({ region: "us", apiBaseUrl: "" }, { RAIA_AGENT_SECRET_KEY: SECRET }),
    ).toThrowError(expect.objectContaining({ code: "AUTHENTICATION_REQUIRED" }));
    expect(
      createHttpProvider({ region: "eu", apiBaseUrl: "" }, { RAIA_ACCESS_TOKEN: "ci-token" }),
    ).toBeDefined();
  });
});
