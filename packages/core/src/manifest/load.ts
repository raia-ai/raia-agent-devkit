/**
 * Manifest loading, artifact resolution, and manifest hashing
 * (build spec sections 12.1, 13, 15).
 */
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { RaiaAgentManifest, Sha256 } from "@raia/contracts";
import { DevkitError } from "../errors.js";
import type { FileSystem } from "../fs/file-system.js";
import { nodeFileSystem } from "../fs/file-system.js";
import { resolveProjectPath } from "../fs/safe-paths.js";
import { hashCanonical, hashFileContent, normalizeLineEndings } from "../hash/canonical.js";
import { validateAgainstSchema } from "../schema/validators.js";

export const MANIFEST_FILE_NAME = "raia.agent.yaml";

export interface LoadedArtifact {
  posixRelative: string;
  absolutePath: string;
  content: string;
  sha256: Sha256;
}

export interface LoadedManifest {
  projectRoot: string;
  manifest: RaiaAgentManifest;
  /** Raw manifest source text (for secret scanning). */
  source: string;
  /** Every locally referenced artifact, keyed by normalized POSIX relative path. */
  artifacts: Map<string, LoadedArtifact>;
  /** Hash over the normalized manifest with embedded artifact content hashes. */
  manifestSha256: Sha256;
}

interface FileReference {
  pointer: string;
  relativePath: string;
}

/** Collects every `{ file: ... }` artifact source in the manifest. */
export function collectFileReferences(manifest: RaiaAgentManifest): FileReference[] {
  const references: FileReference[] = [];
  const visit = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record["file"] === "string" && !("remoteRef" in record) && !("inline" in record)) {
        references.push({ pointer: `${pointer}/file`, relativePath: record["file"] });
      }
      for (const [key, member] of Object.entries(record)) {
        visit(member, `${pointer}/${key}`);
      }
    }
  };
  visit(manifest, "");
  return references;
}

function embedArtifactHashes(
  manifest: RaiaAgentManifest,
  artifacts: Map<string, LoadedArtifact>,
): unknown {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record["file"] === "string" && !("remoteRef" in record) && !("inline" in record)) {
        const normalized = record["file"].split(path.sep).join("/");
        const artifact = artifacts.get(normalized) ?? artifacts.get(record["file"]);
        return {
          ...record,
          file: artifact?.posixRelative ?? normalized,
          contentSha256: artifact?.sha256,
        };
      }
      const result: Record<string, unknown> = {};
      for (const [key, member] of Object.entries(record)) {
        result[key] = visit(member);
      }
      return result;
    }
    return value;
  };
  return visit(manifest);
}

export async function loadManifest(
  projectRoot: string,
  options?: { fs?: FileSystem; manifestFileName?: string },
): Promise<LoadedManifest> {
  const fs = options?.fs ?? nodeFileSystem;
  const manifestFileName = options?.manifestFileName ?? MANIFEST_FILE_NAME;

  const manifestPath = await resolveProjectPath(projectRoot, manifestFileName, fs);
  let source: string;
  try {
    source = await fs.readFile(manifestPath.absolutePath);
  } catch (error) {
    throw new DevkitError("IO_ERROR", "Unable to read the agent manifest.", {
      path: manifestFileName,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new DevkitError("MANIFEST_INVALID", "The agent manifest is not valid YAML.", {
      path: manifestFileName,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }

  const { valid, issues } = validateAgainstSchema("agent-manifest", parsed);
  if (!valid) {
    throw new DevkitError("SCHEMA_INVALID", "The agent manifest violates its schema.", {
      path: manifestFileName,
      details: { issues },
    });
  }
  const manifest = parsed as RaiaAgentManifest;

  const artifacts = new Map<string, LoadedArtifact>();
  for (const reference of collectFileReferences(manifest)) {
    const resolved = await resolveProjectPath(projectRoot, reference.relativePath, fs);
    if (artifacts.has(resolved.posixRelative)) {
      continue;
    }
    const content = normalizeLineEndings(await fs.readFile(resolved.absolutePath));
    artifacts.set(resolved.posixRelative, {
      posixRelative: resolved.posixRelative,
      absolutePath: resolved.absolutePath,
      content,
      sha256: hashFileContent(content),
    });
  }

  const manifestSha256 = hashCanonical(embedArtifactHashes(manifest, artifacts));
  return { projectRoot: path.resolve(projectRoot), manifest, source, artifacts, manifestSha256 };
}

/** Duplicate-name detection over the manifest's name-keyed collections (build spec section 13). */
export function findDuplicateNames(
  manifest: RaiaAgentManifest,
): Array<{ collection: string; name: string }> {
  const collections: Array<[string, ReadonlyArray<{ name: string }> | undefined]> = [
    ["skills", manifest.spec.skills],
    ["functions", manifest.spec.functions],
    ["knowledge", manifest.spec.knowledge],
    ["integrations", manifest.spec.integrations],
  ];
  const duplicates: Array<{ collection: string; name: string }> = [];
  for (const [collection, items] of collections) {
    if (!items) {
      continue;
    }
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.name)) {
        duplicates.push({ collection, name: item.name });
      }
      seen.add(item.name);
    }
  }
  return duplicates.sort(
    (a, b) => a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name),
  );
}
