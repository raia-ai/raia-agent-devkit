/**
 * Writes a project from an exported agent bundle (shared by `raia init` and
 * the MCP pull surface). Atomic writes, no silent overwrites, and the lock's
 * informational `generatedAt` never causes a rewrite by itself.
 */
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { AgentExport, RaiaAgentLockFile, RaiaAgentManifest } from "@raia/contracts";
import { loadManifest, lockSha256, MANIFEST_FILE_NAME, parseLock } from "@raia/core";
import {
  applyWrites,
  PROJECT_BINDING_PATH,
  readTextIfExists,
  type PlannedWrite,
  type ProjectBinding,
} from "./project-files.js";

export const CLI_VERSION = "0.1.0";

const DEFAULT_GITIGNORE = [
  "# raia Agent DevKit",
  ".raia/mock/",
  ".raia/cache/",
  ".raia/workflow-state.json",
  "reports/",
  "",
].join("\n");

export interface WriteProjectOptions {
  force: boolean;
  region: string;
  profile: string;
  apiBaseUrl: string | undefined;
}

export interface WriteProjectResult {
  written: string[];
  skipped: string[];
  manifestSha256: string;
  binding: ProjectBinding;
}

export async function writeProjectFromExport(
  projectRoot: string,
  exported: AgentExport,
  options: WriteProjectOptions,
): Promise<WriteProjectResult> {
  const manifest = exported.bundle.manifest as RaiaAgentManifest;
  const lock = exported.bundle.lock as RaiaAgentLockFile;

  const binding: ProjectBinding = {
    schemaVersion: 1,
    provider: "mock",
    region: options.region,
    apiBaseUrl: options.apiBaseUrl ?? "mock:.raia/mock",
    workspaceId: exported.workspaceId,
    agentId: exported.agentId,
    defaultProfile: options.profile,
  };

  const stampedLock: RaiaAgentLockFile = {
    ...lock,
    generatedAt: new Date().toISOString(),
    generatedBy: { cliVersion: CLI_VERSION },
    remote: {
      workspaceId: exported.workspaceId,
      agentId: exported.agentId,
      baseVersionId: exported.versionId,
      etag: exported.etag,
      region: options.region === "eu" ? "eu" : options.region === "us" ? "us" : "custom",
    },
  };

  // `generatedAt` is informational and excluded from deterministic lock hashing
  // (build spec section 12.2): keep the existing lock file when only that
  // timestamp would change, so re-running stays a no-op.
  let lockContent = JSON.stringify(stampedLock, null, 2) + "\n";
  const existingLockRaw = await readTextIfExists(path.join(projectRoot, "raia.lock.json"));
  if (existingLockRaw !== undefined) {
    try {
      if (lockSha256(parseLock(existingLockRaw)) === lockSha256(stampedLock)) {
        lockContent = existingLockRaw;
      }
    } catch {
      // Existing lock is invalid; the overwrite check below handles it.
    }
  }

  const writes: PlannedWrite[] = [
    { relativePath: MANIFEST_FILE_NAME, content: stringifyYaml(manifest) },
    ...exported.bundle.artifacts.map((artifact) => ({
      relativePath: artifact.path,
      content: artifact.content,
    })),
    { relativePath: "raia.lock.json", content: lockContent },
    { relativePath: PROJECT_BINDING_PATH, content: JSON.stringify(binding, null, 2) + "\n" },
  ];
  if ((await readTextIfExists(path.join(projectRoot, ".gitignore"))) === undefined) {
    writes.push({ relativePath: ".gitignore", content: DEFAULT_GITIGNORE });
  }

  const { written, skipped } = await applyWrites(projectRoot, writes, { force: options.force });

  // Round-trip integrity: the written project must reproduce the exported manifest hash.
  const reloaded = await loadManifest(projectRoot);
  if (reloaded.manifestSha256 !== lock.manifestSha256) {
    throw new Error(
      "Internal error: written project does not reproduce the exported manifest hash.",
    );
  }

  return { written, skipped, manifestSha256: reloaded.manifestSha256, binding };
}

export function plannedWriteCount(exported: AgentExport): number {
  return exported.bundle.artifacts.length + 3;
}
