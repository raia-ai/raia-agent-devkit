#!/usr/bin/env node
// PreToolUse hook (build spec sections 22-24): defense-in-depth denial of any
// attempt at raia production deployment. The MCP catalog and the mock's server
// policy already forbid it; this hook blocks Bash and tool-name variants too.
import { readFileSync } from "node:fs";
import process from "node:process";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const toolName = String(payload?.tool_name ?? "");
const input = payload?.tool_input ?? {};
const command = String(input.command ?? "");

const PRODUCTION_TOOL = /raia.*deployment.*production|deployment_production/i;
const PRODUCTION_COMMAND = /\braia\b[^\n;&|]*\bdeploy\b[^\n;&|]*\bproduction\b/i;

if (PRODUCTION_TOOL.test(toolName) || (toolName === "Bash" && PRODUCTION_COMMAND.test(command))) {
  console.error(
    "Blocked: production deployment of raia agents is not available from Claude Code. " +
      "Production promotion is reserved for the raia management UI (build spec section 22). " +
      "Deploy to staging instead.",
  );
  process.exit(2);
}
process.exit(0);
