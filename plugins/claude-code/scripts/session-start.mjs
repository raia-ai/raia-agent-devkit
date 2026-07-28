#!/usr/bin/env node
// SessionStart hook (build spec section 24.3): fast, non-blocking summary of
// the raia project state. No remote writes, no mutation, always exits 0.
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function readJson(relative) {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), relative), "utf8"));
  } catch {
    return undefined;
  }
}

const binding = readJson(".raia/project.json");
if (binding === undefined) {
  console.log("raia: no project binding in this directory (run /raia:init to set one up).");
  process.exit(0);
}
const workflow = readJson(".raia/workflow-state.json");
const stage = workflow?.stage ?? "DRAFT";
const release = workflow?.remote?.releaseCandidateId;
console.log(
  `raia: agent ${binding.agentId} (workspace ${binding.workspaceId}, provider ${binding.provider}) — ` +
    `stage ${stage}${release !== undefined ? `, release ${release}` : ""}. ` +
    "Use raia_context_get for exact drift and evidence state before proposing changes.",
);
process.exit(0);
