/**
 * Seeds mock provider state from a developer project fixture directory
 * (for example docs/raia-devkit-spec/examples/helpdesk-agent). The seed builds
 * a complete export bundle: manifest, provider-resolved lock, and every locally
 * referenced artifact.
 */
import type {
  AgentArtifact,
  AgentBundle,
  RaiaAgentLockFile,
  RaiaAgentManifest,
  ResolvedItem,
  Sha256,
} from "@raia/contracts";
import { hashCanonical, loadEvaluationSuite, loadManifest, loadReleasePolicy } from "@raia/core";

export interface SeedResult {
  workspaceId: string;
  agentId: string;
  manifest: RaiaAgentManifest;
  bundle: AgentBundle;
  manifestSha256: Sha256;
}

function resolvedItem(name: string, remoteRef: string, version: string): ResolvedItem {
  return {
    name,
    remoteId: remoteRef,
    version,
    checksum: hashCanonical({ remoteRef, version }),
  };
}

/** Builds the provider-side lock for a manifest (mock resolution is derived and deterministic). */
export function buildProviderLock(
  manifest: RaiaAgentManifest,
  manifestSha256: Sha256,
): RaiaAgentLockFile {
  const spec = manifest.spec;
  return {
    lockVersion: 1,
    manifestApiVersion: "devkit.raia.ai/v1alpha1",
    manifestSha256,
    generatedBy: { cliVersion: "mock-provider@0.1.0" },
    resolved: {
      model: resolvedItem(spec.model.modelId, `raia-model://${spec.model.modelId}`, "1"),
      skills: (spec.skills ?? []).map((skill) =>
        resolvedItem(skill.name, skill.source.remoteRef, skill.source.version ?? "1"),
      ),
      functions: (spec.functions ?? []).map((fn) =>
        resolvedItem(fn.name, `raia-function://${fn.name}`, "1"),
      ),
      knowledge: (spec.knowledge ?? []).map((pack) =>
        resolvedItem(pack.name, pack.source.remoteRef, pack.source.version ?? "1"),
      ),
      integrations: (spec.integrations ?? []).map((integration) =>
        resolvedItem(
          integration.name,
          integration.source.remoteRef,
          integration.source.version ?? "1",
        ),
      ),
      policyPacks: (spec.guardrails?.policyPacks ?? []).map((pack, index) =>
        resolvedItem(`policy-pack-${index + 1}`, pack.remoteRef, pack.version ?? "1"),
      ),
      evaluators: [],
    },
  };
}

/** Loads a fixture project and produces the agent bundle the mock will serve. */
export async function buildBundleFromFixture(fixtureDir: string): Promise<SeedResult> {
  const loaded = await loadManifest(fixtureDir);
  const artifacts = new Map<string, AgentArtifact>();

  const addArtifact = (path: string, content: string, sha256: Sha256): void => {
    if (!artifacts.has(path)) {
      artifacts.set(path, { path, sha256, encoding: "utf8", content });
    }
  };

  for (const artifact of loaded.artifacts.values()) {
    addArtifact(artifact.posixRelative, artifact.content, artifact.sha256);
  }
  for (const suitePath of loaded.manifest.spec.evaluations?.suites ?? []) {
    const suite = await loadEvaluationSuite(fixtureDir, suitePath);
    addArtifact(suite.posixRelative, suite.source, hashCanonical({ source: suite.source }));
    for (const [fixturePath, fixture] of suite.fixtures) {
      addArtifact(fixturePath, fixture.content, fixture.sha256);
    }
  }
  const policyPath = loaded.manifest.spec.deployment?.releasePolicy;
  if (policyPath !== undefined) {
    const policy = await loadReleasePolicy(fixtureDir, policyPath);
    addArtifact(policy.posixRelative, policy.source, hashCanonical({ source: policy.source }));
  }

  const lock = buildProviderLock(loaded.manifest, loaded.manifestSha256);
  const bundle: AgentBundle = {
    manifest: loaded.manifest,
    lock,
    artifacts: [...artifacts.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };

  return {
    workspaceId: loaded.manifest.metadata.workspaceId ?? "ws_mock_default",
    agentId: loaded.manifest.metadata.agentId ?? `agent_mock_${loaded.manifest.metadata.name}`,
    manifest: loaded.manifest,
    bundle,
    manifestSha256: loaded.manifestSha256,
  };
}
