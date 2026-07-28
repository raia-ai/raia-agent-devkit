/**
 * Evaluation-suite and release-policy loading with candidate-relevant hashing
 * (build spec section 13, ADR 0001 section 5): a suite hash covers the suite
 * document plus the content of every fixture it references.
 */
import type { RaiaAgentEvaluationSuite, RaiaAgentReleasePolicy, Sha256 } from "@raia/contracts";
import { parse as parseYaml } from "yaml";
import { DevkitError } from "../errors.js";
import type { FileSystem } from "../fs/file-system.js";
import { nodeFileSystem } from "../fs/file-system.js";
import { resolveProjectPath } from "../fs/safe-paths.js";
import { hashCanonical, hashFileContent, normalizeLineEndings } from "../hash/canonical.js";
import { validateAgainstSchema } from "../schema/validators.js";

export interface LoadedSuite {
  posixRelative: string;
  suite: RaiaAgentEvaluationSuite;
  source: string;
  fixtures: Map<string, { content: string; sha256: Sha256 }>;
  /** Canonical hash of the suite document plus fixture content hashes. */
  sha256: Sha256;
}

export interface LoadedReleasePolicy {
  posixRelative: string;
  policy: RaiaAgentReleasePolicy;
  source: string;
  sha256: Sha256;
}

export function collectFixtureRefs(suite: RaiaAgentEvaluationSuite): string[] {
  const refs = new Set<string>();
  for (const evalCase of suite.spec.cases) {
    const conversation = evalCase.conversation as Record<string, unknown>;
    const turns = conversation["turns"];
    if (Array.isArray(turns)) {
      for (const turn of turns) {
        const fixtureRef = (turn as Record<string, unknown>)["fixtureRef"];
        if (typeof fixtureRef === "string") {
          refs.add(fixtureRef);
        }
      }
    }
  }
  return [...refs].sort();
}

export async function loadEvaluationSuite(
  projectRoot: string,
  suitePath: string,
  options?: { fs?: FileSystem },
): Promise<LoadedSuite> {
  const fs = options?.fs ?? nodeFileSystem;
  const resolved = await resolveProjectPath(projectRoot, suitePath, fs);
  const source = await fs.readFile(resolved.absolutePath);

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new DevkitError("SCHEMA_INVALID", "Evaluation suite is not valid YAML.", {
      path: resolved.posixRelative,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
  const { valid, issues } = validateAgainstSchema("eval-suite", parsed);
  if (!valid) {
    throw new DevkitError("SCHEMA_INVALID", "Evaluation suite violates its schema.", {
      path: resolved.posixRelative,
      details: { issues },
    });
  }
  const suite = parsed as RaiaAgentEvaluationSuite;

  const fixtures = new Map<string, { content: string; sha256: Sha256 }>();
  for (const fixtureRef of collectFixtureRefs(suite)) {
    const fixture = await resolveProjectPath(projectRoot, fixtureRef, fs);
    const content = normalizeLineEndings(await fs.readFile(fixture.absolutePath));
    try {
      JSON.parse(content);
    } catch {
      throw new DevkitError("SCHEMA_INVALID", "Fixture is not valid JSON.", {
        path: fixture.posixRelative,
      });
    }
    fixtures.set(fixture.posixRelative, { content, sha256: hashFileContent(content) });
  }

  const fixtureHashes: Record<string, Sha256> = {};
  for (const [fixturePath, fixture] of [...fixtures.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    fixtureHashes[fixturePath] = fixture.sha256;
  }
  const sha256 = hashCanonical({ suite, fixtures: fixtureHashes });
  return { posixRelative: resolved.posixRelative, suite, source, fixtures, sha256 };
}

export async function loadReleasePolicy(
  projectRoot: string,
  policyPath: string,
  options?: { fs?: FileSystem },
): Promise<LoadedReleasePolicy> {
  const fs = options?.fs ?? nodeFileSystem;
  const resolved = await resolveProjectPath(projectRoot, policyPath, fs);
  const source = await fs.readFile(resolved.absolutePath);

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    throw new DevkitError("SCHEMA_INVALID", "Release policy is not valid YAML.", {
      path: resolved.posixRelative,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
  const { valid, issues } = validateAgainstSchema("release-policy", parsed);
  if (!valid) {
    throw new DevkitError("SCHEMA_INVALID", "Release policy violates its schema.", {
      path: resolved.posixRelative,
      details: { issues },
    });
  }
  const policy = parsed as RaiaAgentReleasePolicy;
  return { posixRelative: resolved.posixRelative, policy, source, sha256: hashCanonical(policy) };
}
