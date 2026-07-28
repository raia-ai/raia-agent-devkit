import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const pluginRoot = path.join(repoRoot, "plugins", "claude-code");
const templateRoot = path.join(repoRoot, "docs", "raia-devkit-spec", "contracts", "claude-plugin");

describe("Claude Code plugin structure (build spec section 24)", () => {
  it("keeps mcp config and hooks byte-identical to the contract templates", async () => {
    for (const relative of [".mcp.json", "hooks/hooks.json"]) {
      const template = await readFile(path.join(templateRoot, relative), "utf8");
      const actual = await readFile(path.join(pluginRoot, relative), "utf8");
      expect(actual, relative).toBe(template);
    }
  });

  it("matches the template manifest except the recorded `agents` deviation (ADR 0005)", async () => {
    const template = JSON.parse(
      await readFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    const actual = JSON.parse(
      await readFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    // Recorded conflict: the template's `"agents": "./agents/"` fails
    // `claude plugin validate --strict`, which the build spec also mandates.
    // Resolution: an explicit array of agent files (smallest change that
    // passes); every other field must remain identical to the template.
    expect(template["agents"]).toBe("./agents/");
    expect(actual["agents"]).toEqual([
      "./agents/prompt-reviewer.md",
      "./agents/function-integration-reviewer.md",
      "./agents/knowledge-retrieval-reviewer.md",
      "./agents/evaluation-designer.md",
      "./agents/release-reviewer.md",
    ]);
    const strip = (manifest: Record<string, unknown>): Record<string, unknown> => {
      const { agents: _agents, ...rest } = manifest;
      return rest;
    };
    expect(strip(actual)).toEqual(strip(template));
  });

  it("declares opt-in enablement and bundles the server via CLAUDE_PLUGIN_ROOT", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["name"]).toBe("raia");
    expect(manifest["defaultEnabled"]).toBe(false);
    const mcp = await readFile(path.join(pluginRoot, ".mcp.json"), "utf8");
    expect(mcp).toContain("${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js");
  });

  it("ships all eight skills with frontmatter", async () => {
    const expected = ["init", "pull", "plan", "test", "review", "deploy-staging", "debug", "learn"];
    for (const skill of expected) {
      const content = await readFile(path.join(pluginRoot, "skills", skill, "SKILL.md"), "utf8");
      expect(content.startsWith("---\n"), skill).toBe(true);
      expect(content).toContain(
        `name: raia-${skill === "deploy-staging" ? "deploy-staging" : skill}`,
      );
      expect(content).toContain("description:");
    }
  });

  it("ships the five specialist review agents, all read-only", async () => {
    const agents = (await readdir(path.join(pluginRoot, "agents"))).sort();
    expect(agents).toEqual([
      "evaluation-designer.md",
      "function-integration-reviewer.md",
      "knowledge-retrieval-reviewer.md",
      "prompt-reviewer.md",
      "release-reviewer.md",
    ]);
    for (const agent of agents) {
      const content = await readFile(path.join(pluginRoot, "agents", agent), "utf8");
      expect(content).toContain("tools: Read, Grep, Glob");
      expect(content).not.toMatch(/tools:.*(Bash|Write|Edit)/);
    }
  });

  it("hook scripts exist, are referenced by hooks.json, and parse as valid Node", async () => {
    const hooks = JSON.parse(
      await readFile(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    const referenced = Object.values(hooks.hooks)
      .flat()
      .flatMap((entry) => entry.hooks.map((hook) => hook.command))
      .map((command) => /scripts\/([a-z-]+\.mjs)/.exec(command)?.[1])
      .filter((name): name is string => name !== undefined);
    expect(referenced.sort()).toEqual([
      "deny-production-deploy.mjs",
      "session-start.mjs",
      "validate-changed-file.mjs",
    ]);
    for (const script of referenced) {
      const scriptPath = path.join(pluginRoot, "scripts", script);
      expect(existsSync(scriptPath), script).toBe(true);
      // node --check validates syntax without executing.
      execFileSync(process.execPath, ["--check", scriptPath]);
    }
  });

  it("the production-deny hook blocks production attempts and passes staging", async () => {
    const script = path.join(pluginRoot, "scripts", "deny-production-deploy.mjs");
    const runHook = (payload: object): { status: number; stderr: string } => {
      try {
        execFileSync(process.execPath, [script], {
          input: JSON.stringify(payload),
          encoding: "utf8",
        });
        return { status: 0, stderr: "" };
      } catch (error) {
        const failure = error as { status: number; stderr: string };
        return { status: failure.status, stderr: failure.stderr };
      }
    };

    const blockedBash = runHook({
      tool_name: "Bash",
      tool_input: { command: "raia deploy production --yes" },
    });
    expect(blockedBash.status).toBe(2);
    expect(blockedBash.stderr).toContain("reserved for the raia management UI");

    const blockedTool = runHook({
      tool_name: "mcp__plugin_raia_raia__raia_deployment_production_create",
      tool_input: {},
    });
    expect(blockedTool.status).toBe(2);

    expect(
      runHook({ tool_name: "Bash", tool_input: { command: "raia deploy staging --yes" } }).status,
    ).toBe(0);
    expect(runHook({ tool_name: "Read", tool_input: { file_path: "x" } }).status).toBe(0);
  });

  it("no plugin surface offers production deployment, shell, SQL, or secret-read capability", async () => {
    const surfaces: string[] = [];
    for (const skill of await readdir(path.join(pluginRoot, "skills"))) {
      surfaces.push(await readFile(path.join(pluginRoot, "skills", skill, "SKILL.md"), "utf8"));
    }
    for (const surface of surfaces) {
      // Skills may explain that production is impossible, but must never
      // instruct calling a production deployment capability.
      expect(surface).not.toMatch(/raia_deployment_production_create/);
      expect(surface).not.toMatch(/raia_(shell|sql|fetch_url|secret_get)/);
    }
  });
});
