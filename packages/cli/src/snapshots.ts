/** Shared manifest-snapshot builders for diff/review. */
import type { AgentExport, RaiaAgentManifest, Sha256 } from "@raia/contracts";
import type { LoadedManifest, ManifestSnapshot } from "@raia/core";

export function snapshotFromExport(exported: AgentExport): ManifestSnapshot {
  return {
    manifest: exported.bundle.manifest as RaiaAgentManifest,
    artifactSha256ByPath: new Map(
      exported.bundle.artifacts.map((artifact) => [artifact.path, artifact.sha256 as Sha256]),
    ),
  };
}

export function snapshotFromLocal(loaded: LoadedManifest): ManifestSnapshot {
  return {
    manifest: loaded.manifest,
    artifactSha256ByPath: new Map(
      [...loaded.artifacts.values()].map((artifact) => [artifact.posixRelative, artifact.sha256]),
    ),
  };
}
