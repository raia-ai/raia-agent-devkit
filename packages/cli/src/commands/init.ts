/**
 * `raia init` (build spec section 20): create a project or bind to an agent.
 * With the mock provider and a fixture, seeds local provider state, exports the
 * exact current version, and writes manifest, artifacts, lock, and binding.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { MANIFEST_FILE_NAME } from "@raia/core";
import { UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { createProvider, operationContext } from "../provider.js";
import { plannedWriteCount, writeProjectFromExport } from "../project-writer.js";

export interface InitOptions {
  provider: string;
  fixture: string | undefined;
  agent: string | undefined;
  dir: string | undefined;
  force: boolean;
  yes: boolean;
}

export function resolveFixtureDir(cwd: string, fixture: string): string {
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

  if (!options.yes && !flags.nonInteractive) {
    throw new UsageError(
      `init would write ${plannedWriteCount(exported)}+ files into ${projectRoot} for agent ${exported.agentId}.\n` +
        `Re-run with --yes to apply.`,
    );
  }

  const { written, skipped, manifestSha256 } = await writeProjectFromExport(projectRoot, exported, {
    force: options.force,
    region: flags.region,
    profile: flags.profile,
    apiBaseUrl: flags.apiBaseUrl,
  });

  emitResult(
    io,
    flags,
    {
      ok: true,
      agentId: exported.agentId,
      workspaceId: exported.workspaceId,
      versionId: exported.versionId,
      etag: exported.etag,
      manifestSha256,
      written,
      skipped,
    },
    [
      `Initialized raia project in ${projectRoot}`,
      `  agent:     ${exported.agentId} (workspace ${exported.workspaceId})`,
      `  version:   ${exported.versionId}  etag ${exported.etag}`,
      `  manifest:  ${manifestSha256}`,
      `  files:     ${written.length} written, ${skipped.length} unchanged`,
      `Next: raia validate`,
    ],
  );
  return 0;
}
