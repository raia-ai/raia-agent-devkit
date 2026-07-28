#!/usr/bin/env node
// PostToolUse hook after Write|Edit (build spec section 24.3): when a
// lifecycle-relevant file changed, run targeted local validation through the
// bundled deterministic CLI. Exit 2 surfaces actionable findings to Claude;
// nothing here mutates state or calls the network.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const RELEVANT =
  /(^|[\\/])(raia\.agent\.yaml|raia\.lock\.json|prompts[\\/]|evals[\\/]|fixtures[\\/]|policies[\\/])/;

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const filePath = payload?.tool_input?.file_path ?? payload?.tool_input?.path ?? "";
if (typeof filePath !== "string" || !RELEVANT.test(filePath)) {
  process.exit(0);
}
const projectRoot = payload?.cwd ?? process.cwd();
if (!existsSync(path.join(projectRoot, "raia.agent.yaml"))) {
  process.exit(0);
}

const pluginRoot = process.env.RAIA_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT ?? "";
const cli = path.join(pluginRoot, "dist", "cli.js");
if (!existsSync(cli)) {
  process.exit(0);
}
const result = spawnSync(process.execPath, [cli, "--json", "validate"], {
  cwd: projectRoot,
  encoding: "utf8",
  timeout: 15000,
});
if (result.status === 0) {
  process.exit(0);
}
try {
  const report = JSON.parse(result.stdout ?? "{}");
  const findings = (report.findings ?? [])
    .filter((finding) => finding.severity === "error")
    .map((finding) => `${finding.code} ${finding.path ?? ""}: ${finding.message}`)
    .slice(0, 10);
  console.error(
    `raia validation failed after editing ${filePath}:\n` +
      findings.join("\n") +
      "\nFix the findings (or revert the edit); do not weaken guardrails or policies to pass.",
  );
} catch {
  console.error(`raia validation failed after editing ${filePath} (exit ${result.status}).`);
}
process.exit(2);
