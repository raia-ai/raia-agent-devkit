/**
 * `raia init` (build spec section 20): create a project or bind to an agent.
 * With the mock provider and a fixture, seeds local provider state, exports the
 * exact current version, and writes manifest, artifacts, lock, and binding.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { stringify as stringifyYaml } from "yaml";
import type { RaiaAgentLockFile, RaiaAgentManifest } from "@raia/contracts";
import { loadManifest, lockSha256, MANIFEST_FILE_NAME, parseLock } from "@raia/core";
import { UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import {
  applyWrites,
  PROJECT_BINDING_PATH,
  readTextIfExists,
  type PlannedWrite,
  type ProjectBinding,
} from "../project-files.js";
import { createProvider, operationContext } from "../provider.js";

export interface InitOptions {
  provider: string;
  fixture: string | undefined;
  agent: string | undefined;
  dir: string | undefined;
  force: boolean;
  yes: boolean;
}

const CLI_VERSION = "0.1.0";

const DEFAULT_GITIGNORE = [
  "# raia Agent DevKit",
  ".raia/mock/",
  ".raia/cache/",
  ".raia/workflow-state.json",
  "reports/",
  "",
].join("\n");

function resolveFixtureDir(cwd: string, fixture: string): string {
  const candidates = [
    fixture,
    path.join("examples", fixture),
    path.join("docs", "raia-devkit-spec", "examples", fixture),
  ].map((candidate) => path.resolve(cwd, candidate));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, MANIFEST_FILE_NAME))) {
      return candidate;
    }
  }
  throw new UsageError(
    `Fixture "${fixture}" not found. Pass a path to a project directory containing ${MANIFEST_FILE_NAME}.`,
  );
}

export async function runInit(
  io: CliIO,
  flags: GlobalFlags,
  options: InitOptions,
): Promise<number> {
  const projectRoot = path.resolve(io.cwd, options.dir ?? ".");
  const provider = createProvider(projectRoot, options.provider);

  let agentId = options.agent;
  if (options.fixture !== undefined) {
    const fixtureDir = resolveFixtureDir(io.cwd, options.fixture);
    if (path.resolve(fixtureDir) === projectRoot) {
      throw new UsageError("The target directory and the fixture directory must differ.");
    }
    const seeded = await provider.seedFromFixture(fixtureDir);
    agentId = agentId ?? seeded.agentId;
  }
  if (agentId === undefined) {
    throw new UsageError(
      "Select an agent: pass --fixture <dir> to seed the mock, or --agent <id>.",
    );
  }

  const exported = await provider.exportAgent(operationContext(), agentId);
  const manifest = exported.bundle.manifest as RaiaAgentManifest;
  const lock = exported.bundle.lock as RaiaAgentLockFile;

  const binding: ProjectBinding = {
    schemaVersion: 1,
    provider: "mock",
    region: flags.region,
    apiBaseUrl: flags.apiBaseUrl ?? "mock:.raia/mock",
    workspaceId: exported.workspaceId,
    agentId: exported.agentId,
    defaultProfile: flags.profile,
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
      region: flags.region === "eu" ? "eu" : flags.region === "us" ? "us" : "custom",
    },
  };

  // `generatedAt` is informational and excluded from deterministic lock hashing
  // (build spec section 12.2): keep the existing lock file when only that
  // timestamp would change, so re-running init stays a no-op.
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

  if (!options.yes && !flags.nonInteractive) {
    const preview = writes.map((write) => `  ${write.relativePath}`).join("\n");
    throw new UsageError(
      `init would write ${writes.length} files into ${projectRoot}:\n${preview}\nRe-run with --yes to apply.`,
    );
  }

  const { written, skipped } = await applyWrites(projectRoot, writes, { force: options.force });

  // Round-trip integrity: the written project must reproduce the exported manifest hash.
  const reloaded = await loadManifest(projectRoot);
  if (reloaded.manifestSha256 !== lock.manifestSha256) {
    throw new Error(
      "Internal error: written project does not reproduce the exported manifest hash.",
    );
  }

  emitResult(
    io,
    flags,
    {
      ok: true,
      agentId: exported.agentId,
      workspaceId: exported.workspaceId,
      versionId: exported.versionId,
      etag: exported.etag,
      manifestSha256: reloaded.manifestSha256,
      written,
      skipped,
    },
    [
      `Initialized raia project in ${projectRoot}`,
      `  agent:     ${exported.agentId} (workspace ${exported.workspaceId})`,
      `  version:   ${exported.versionId}  etag ${exported.etag}`,
      `  manifest:  ${reloaded.manifestSha256}`,
      `  files:     ${written.length} written, ${skipped.length} unchanged`,
      `Next: raia validate`,
    ],
  );
  return 0;
}
