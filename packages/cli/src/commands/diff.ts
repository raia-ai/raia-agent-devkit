/**
 * `raia diff` (build spec section 20): compare the working tree against the
 * lock's base version (default), the remote current version, or an explicit
 * version. Read-only.
 */
import path from "node:path";
import type { RaiaAgentManifest, Sha256 } from "@raia/contracts";
import { diffManifests, loadManifest, parseLock, type ManifestSnapshot } from "@raia/core";
import { UsageError } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { readBinding, readTextIfExists } from "../project-files.js";
import { operationContext, providerForBinding } from "../provider.js";

export interface DiffOptions {
  against: string;
}

export async function runDiff(
  io: CliIO,
  flags: GlobalFlags,
  options: DiffOptions,
): Promise<number> {
  const projectRoot = io.cwd;
  const binding = await readBinding(projectRoot);
  if (binding === undefined) {
    throw new UsageError("Not a raia project (missing .raia/project.json). Run `raia init` first.");
  }
  const lockRaw = await readTextIfExists(path.join(projectRoot, "raia.lock.json"));
  if (lockRaw === undefined) {
    throw new UsageError("Missing raia.lock.json; run `raia init` (or, later, `raia pull`).");
  }
  const lock = parseLock(lockRaw);
  const baseVersionId = lock.remote?.baseVersionId;
  if (baseVersionId === undefined) {
    throw new UsageError("The lock has no remote binding; cannot resolve a base version.");
  }

  let targetVersionId: string;
  if (options.against === "lock") {
    targetVersionId = baseVersionId;
  } else if (options.against === "remote") {
    targetVersionId = "";
  } else if (options.against.startsWith("version:")) {
    targetVersionId = options.against.slice("version:".length);
    if (targetVersionId.length === 0) {
      throw new UsageError("Empty version in --against version:<id>.");
    }
  } else {
    throw new UsageError(
      `Unknown --against value "${options.against}" (lock | remote | version:<id>).`,
    );
  }

  const provider = providerForBinding(projectRoot, binding);
  const exported = await provider.exportAgent(
    operationContext(),
    binding.agentId,
    targetVersionId === "" ? undefined : targetVersionId,
  );

  const beforeSnapshot: ManifestSnapshot = {
    manifest: exported.bundle.manifest as RaiaAgentManifest,
    artifactSha256ByPath: new Map(
      exported.bundle.artifacts.map((artifact) => [artifact.path, artifact.sha256 as Sha256]),
    ),
  };
  const local = await loadManifest(projectRoot);
  const afterSnapshot: ManifestSnapshot = {
    manifest: local.manifest,
    artifactSha256ByPath: new Map(
      [...local.artifacts.values()].map((artifact) => [artifact.posixRelative, artifact.sha256]),
    ),
  };

  const { changes, risk } = diffManifests(beforeSnapshot, afterSnapshot);

  const human: string[] = [
    `diff against ${options.against} (version ${exported.versionId}): ` +
      (changes.length === 0 ? "no semantic changes" : `${changes.length} change(s), risk ${risk}`),
  ];
  for (const change of changes) {
    human.push(
      `  [${change.severity}${change.breaking ? ", breaking" : ""}] ${change.operation} ${change.path} — ${change.reason}`,
    );
  }

  emitResult(
    io,
    flags,
    {
      ok: true,
      against: options.against,
      baseVersionId: exported.versionId,
      localManifestSha256: local.manifestSha256,
      risk,
      changes,
    },
    human,
  );
  return 0;
}
