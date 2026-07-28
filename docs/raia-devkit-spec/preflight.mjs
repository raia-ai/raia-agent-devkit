import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(root, "PACKAGE_MANIFEST.sha256");
const required = [
  "ACCEPTANCE_CHECKLIST.md",
  "AGENT_LIFECYCLE_FRAMEWORK.md",
  "CLAUDE_CODE_START_PROMPT.md",
  "DECISIONS_REQUIRED.md",
  "RAIA_AGENT_DEVKIT_BUILD_SPEC.md",
  "README.md",
  "preflight.mjs",
  "validate_package.py",
  "validation-requirements.txt",
  "contracts/agent-lock.schema.json",
  "contracts/agent-manifest.schema.json",
  "contracts/claude-plugin/.claude-plugin/plugin.json",
  "contracts/claude-plugin/.mcp.json",
  "contracts/claude-plugin/hooks/hooks.json",
  "contracts/eval-suite.schema.json",
  "contracts/mcp-tool-catalog.json",
  "contracts/provider-contract.ts",
  "contracts/raia-management.openapi.yaml",
  "contracts/release-policy.schema.json",
  "contracts/workflow-state.schema.json",
  "contracts/vendor/README.md",
  "contracts/vendor/normalize_vendor_openapi.py",
  "contracts/vendor/raia-external-api.normalization.json",
  "contracts/vendor/raia-external-api.openapi.json",
  "contracts/vendor/raia-external-api.raw.openapi.json",
  "examples/helpdesk-agent/evals/regression.eval.yaml",
  "examples/helpdesk-agent/evals/smoke.eval.yaml",
  "examples/helpdesk-agent/fixtures/fraud-escalation.json",
  "examples/helpdesk-agent/fixtures/malformed-order.json",
  "examples/helpdesk-agent/fixtures/order-shipped.json",
  "examples/helpdesk-agent/fixtures/password-refusal.json",
  "examples/helpdesk-agent/fixtures/shipped-next-step.json",
  "examples/helpdesk-agent/policies/default.release-policy.yaml",
  "examples/helpdesk-agent/prompts/brand-voice.md",
  "examples/helpdesk-agent/prompts/system.md",
  "examples/helpdesk-agent/raia.agent.yaml"
];

function insideRoot(path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

try {
  const manifest = await readFile(manifestPath, "utf8");
  const entries = new Map();

  for (const [index, rawLine] of manifest.split(/\r?\n/u).entries()) {
    if (!rawLine) continue;
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(rawLine);
    if (!match) throw new Error(`Malformed checksum entry at line ${index + 1}`);
    const relative = match[2].replace(/^\.\//u, "");
    const absolute = resolve(root, relative);
    if (!insideRoot(absolute)) throw new Error(`Checksum path escapes package root: ${relative}`);
    entries.set(relative, { absolute, expected: match[1] });
  }

  for (const relative of required) {
    if (!entries.has(relative)) throw new Error(`Required file is absent from checksum manifest: ${relative}`);
  }

  for (const [relative, entry] of entries) {
    const info = await stat(entry.absolute);
    if (!info.isFile()) throw new Error(`Manifest entry is not a file: ${relative}`);
    const actual = await sha256(entry.absolute);
    if (actual !== entry.expected) throw new Error(`Checksum mismatch: ${relative}`);
  }

  if (entries.size !== required.length) {
    throw new Error(`Package manifest contains ${entries.size} files; expected exactly ${required.length}`);
  }
  console.log(`Specification package preflight passed: ${entries.size} files verified.`);
} catch (error) {
  console.error(`SPEC_PACKAGE_INCOMPLETE: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
