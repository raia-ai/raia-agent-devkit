/**
 * Semantic-diff branch coverage: the medium/info/low classification paths the
 * high-risk tests in diff.test.ts do not reach — metadata fields, persona,
 * model parameters, skills, function medium changes and adds, knowledge
 * retrieval tuning, integrations config, escalation additions, guardrail
 * strengthening, evaluations, and deployment environment changes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffManifests, loadManifest, type ManifestSnapshot } from "../src/index.js";
import type { RaiaAgentManifest, SemanticChange } from "@raia/contracts";
import { createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;
let base: ManifestSnapshot;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
  const loaded = await loadManifest(fixture.root);
  base = {
    manifest: loaded.manifest,
    artifactSha256ByPath: new Map(
      [...loaded.artifacts.values()].map((artifact) => [artifact.posixRelative, artifact.sha256]),
    ),
  };
});

afterEach(async () => {
  await fixture.cleanup();
});

function withManifest(mutate: (manifest: RaiaAgentManifest) => void): ManifestSnapshot {
  const manifest = structuredClone(base.manifest);
  mutate(manifest);
  return { ...base, manifest };
}

function diffTo(mutate: (manifest: RaiaAgentManifest) => void): SemanticChange[] {
  return diffManifests(base, withManifest(mutate)).changes;
}

function only(changes: SemanticChange[], path: string): SemanticChange {
  const match = changes.filter((change) => change.path === path);
  expect(match, path).toHaveLength(1);
  return match[0]!;
}

describe("metadata, persona, and model parameters", () => {
  it("classifies metadata field add/replace/remove as info", () => {
    const replaced = diffTo((m) => {
      m.metadata.description = "new description";
    });
    expect(only(replaced, "metadata.description")).toMatchObject({
      category: "metadata",
      operation: "replace",
      severity: "info",
    });
    const removed = diffTo((m) => {
      delete m.metadata.description;
    });
    expect(only(removed, "metadata.description").operation).toBe("remove");
    const added = diffTo((m) => {
      m.metadata.annotations = { audited: "yes" };
    });
    expect(only(added, "metadata.annotations").operation).toBe("add");
  });

  it("classifies persona structure and brand-voice content changes as low", () => {
    const structural = diffTo((m) => {
      m.spec.persona!.displayName = "Acme Concierge";
    });
    expect(only(structural, "spec.persona")).toMatchObject({
      category: "metadata",
      severity: "low",
      operation: "replace",
    });
    const removed = diffTo((m) => {
      delete m.spec.persona;
    });
    expect(only(removed, "spec.persona").operation).toBe("remove");
  });

  it("classifies non-identity model parameter changes below the identity rule", () => {
    const changes = diffTo((m) => {
      m.spec.model.temperature = 0.7;
      m.spec.model.maxOutputTokens = 800;
    });
    for (const change of changes) {
      expect(change.category).toBe("model");
      expect(change.severity).not.toBe("high");
    }
  });
});

describe("skills, functions, knowledge, integrations", () => {
  it("labels skill add, remove, and version replace", () => {
    const added = diffTo((m) => {
      m.spec.skills!.push({
        name: "summarize-ticket",
        source: { remoteRef: "raia-skill://summarize-ticket", version: "1" },
        enabled: true,
      });
    });
    expect(only(added, "spec.skills[summarize-ticket]").operation).toBe("add");

    const removed = diffTo((m) => {
      m.spec.skills = m.spec.skills!.filter((skill) => skill.name !== "answer-faq");
    });
    expect(only(removed, "spec.skills[answer-faq]").operation).toBe("remove");

    const replaced = diffTo((m) => {
      m.spec.skills!.find((skill) => skill.name === "answer-faq")!.source.version = "4";
    });
    expect(only(replaced, "spec.skills[answer-faq]").operation).toBe("replace");
  });

  it("classifies a compatible medium function schema change (not broadened/incompatible)", () => {
    const changes = diffTo((m) => {
      const fn = m.spec.functions!.find((f) => f.name === "lookup-order")!;
      (fn.inputSchema as { properties: Record<string, unknown> }).properties["orderId"] = {
        type: "string",
        pattern: "^ORD-[0-9]{6,8}$",
      };
    });
    expect(only(changes, "spec.functions[lookup-order].inputSchema")).toMatchObject({
      severity: "medium",
      breaking: false,
    });
  });

  it("flags handler changes high and residual definition changes medium", () => {
    const handler = diffTo((m) => {
      const fn = m.spec.functions!.find((f) => f.name === "lookup-order")!;
      (fn.handler as { integrationRef: string }).integrationRef = "order-service-v2";
    });
    expect(only(handler, "spec.functions[lookup-order].handler").severity).toBe("high");

    const residual = diffTo((m) => {
      m.spec.functions!.find((f) => f.name === "lookup-order")!.timeoutMs = 9000;
    });
    expect(only(residual, "spec.functions[lookup-order]").severity).toBe("medium");
  });

  it("labels function removal breaking-medium and addition high", () => {
    const removed = diffTo((m) => {
      m.spec.functions = [];
    });
    expect(only(removed, "spec.functions[lookup-order]")).toMatchObject({
      operation: "remove",
      breaking: true,
    });
    const added = diffTo((m) => {
      m.spec.functions!.push({
        name: "issue-refund",
        description: "Issues a refund",
        inputSchema: { type: "object" },
        handler: { type: "integration", integrationRef: "order-service" },
      } as never);
    });
    expect(only(added, "spec.functions[issue-refund]")).toMatchObject({
      operation: "add",
      severity: "high",
    });
  });

  it("labels knowledge retrieval tuning and addition below the removal rule", () => {
    const tuned = diffTo((m) => {
      m.spec.knowledge!.find((k) => k.name === "help-center")!.retrieval!.topK = 12;
    });
    const tunedChange = only(tuned, "spec.knowledge[help-center]");
    expect(tunedChange.category).toBe("knowledge");
    expect(tunedChange.operation).toBe("replace");

    const added = diffTo((m) => {
      m.spec.knowledge!.push({
        name: "returns-policy",
        source: { remoteRef: "raia-knowledge://returns-policy", version: "1" },
      });
    });
    expect(only(added, "spec.knowledge[returns-policy]").operation).toBe("add");
  });

  it("labels integration configuration change without a new-integration high", () => {
    const changes = diffTo((m) => {
      m.spec.integrations!.find((i) => i.name === "order-service")!.configuration = {
        region: "eu",
      };
    });
    const change = only(changes, "spec.integrations[order-service]");
    expect(change.category).toBe("integration");
    expect(change.operation).toBe("replace");
  });
});

describe("minimal ↔ full manifests exercise every add/remove default arm", () => {
  const minimal = (): ManifestSnapshot => ({
    manifest: {
      apiVersion: "devkit.raia.ai/v1alpha1",
      kind: "Agent",
      metadata: { name: "helpdesk-agent" },
      spec: {
        instructions: { inline: "Help customers." },
        model: { modelId: "provider/model-current" },
      },
    } as RaiaAgentManifest,
    artifactSha256ByPath: new Map(),
  });

  it("diffing full → minimal removes every optional section", () => {
    const result = diffManifests(base, minimal());
    const byPath = new Map(result.changes.map((change) => [change.path, change]));
    expect(byPath.get("spec.persona")?.operation).toBe("remove");
    expect(byPath.get("spec.escalation")?.operation).toBe("remove");
    expect(byPath.get("spec.guardrails")?.operation).toBe("remove");
    expect(byPath.get("spec.evaluations")?.operation).toBe("remove");
    expect(byPath.get("spec.skills[answer-faq]")?.operation).toBe("remove");
    expect(byPath.get("spec.functions[lookup-order]")?.operation).toBe("remove");
    expect(byPath.get("spec.knowledge[help-center]")?.operation).toBe("remove");
    expect(byPath.get("spec.integrations[order-service]")?.operation).toBe("remove");
    expect(result.risk).toBe("high");
  });

  it("diffing minimal → full adds sections, with escalation/guardrail adds below high", () => {
    const result = diffManifests(minimal(), base);
    const byPath = new Map(result.changes.map((change) => [change.path, change]));
    expect(byPath.get("spec.persona")?.operation).toBe("add");
    expect(byPath.get("spec.escalation")).toMatchObject({ operation: "add", severity: "medium" });
    expect(byPath.get("spec.guardrails")).toMatchObject({ operation: "add", severity: "medium" });
    expect(byPath.get("spec.evaluations")?.operation).toBe("add");
    expect(byPath.get("spec.deployment.defaultEnvironment")?.operation).toBe("replace");
    expect(byPath.get("spec.integrations[order-service]")?.severity).toBe("high");
  });

  it("hashes inline, remote, and missing-file artifact sources distinctly", () => {
    const withInline = withManifest((m) => {
      m.spec.instructions = { inline: "Inline instructions." };
    });
    expect(diffManifests(base, withInline).changes[0]?.category).toBe("instructions");

    const withRemote = withManifest((m) => {
      m.spec.instructions = { remoteRef: "raia-prompt://helpdesk" } as never;
    });
    expect(diffManifests(base, withRemote).changes[0]?.category).toBe("instructions");

    const missingHash: ManifestSnapshot = {
      manifest: structuredClone(base.manifest),
      artifactSha256ByPath: new Map(),
    };
    // Same file path but no recorded hash → "missing" marker → content change.
    expect(diffManifests(base, missingHash).changes.length).toBeGreaterThan(0);
  });

  it("detects enum removal as broadened and property removal as incompatible", () => {
    const enumRemoved = diffTo((m) => {
      const schema = m.spec.functions![0]!.inputSchema as {
        properties: Record<string, Record<string, unknown>>;
      };
      schema.properties["orderId"] = { type: "string" };
    });
    expect(only(enumRemoved, "spec.functions[lookup-order].inputSchema").severity).toBe("high");

    const propertyDropped = diffTo((m) => {
      const schema = m.spec.functions![0]!.inputSchema as {
        required?: string[];
        properties: Record<string, unknown>;
      };
      delete schema.properties["orderId"];
      schema.required = [];
    });
    const change = only(propertyDropped, "spec.functions[lookup-order].inputSchema");
    expect(change.severity).toBe("high");
  });

  it("tolerates malformed schema shapes (null properties, non-array required)", () => {
    const changes = diffTo((m) => {
      m.spec.functions![0]!.inputSchema = { required: "orderId", properties: null } as never;
    });
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe("escalation, guardrails, evaluations, deployment", () => {
  it("treats added escalation conditions as a non-high escalation change", () => {
    const changes = diffTo((m) => {
      m.spec.escalation!.conditions = [
        ...m.spec.escalation!.conditions!,
        "The user requests a data export.",
      ];
    });
    const change = changes.find((c) => c.category === "escalation")!;
    expect(change).toBeDefined();
    expect(change.severity).not.toBe("high");
  });

  it("treats strengthened guardrails as a non-high guardrail change", () => {
    const changes = diffTo((m) => {
      m.spec.guardrails!.piiHandling = "deny";
      m.spec.guardrails!.blockedTopics = [
        ...(m.spec.guardrails!.blockedTopics ?? []),
        "medical-records",
      ];
    });
    for (const change of changes) {
      expect(change.category).toBe("guardrail");
      expect(change.severity).not.toBe("high");
    }
  });

  it("flags narrowed escalation destinations and weakened injection defense as high", () => {
    const destinations = diffTo((m) => {
      m.spec.escalation!.destinations = [];
    });
    expect(destinations.find((c) => c.category === "escalation")).toMatchObject({
      severity: "high",
      breaking: true,
    });

    const injection = diffTo((m) => {
      m.spec.guardrails!.promptInjectionDefense = "basic" as never;
    });
    expect(injection.find((c) => c.category === "guardrail")).toMatchObject({
      severity: "high",
      breaking: true,
    });

    const packs = diffTo((m) => {
      m.spec.guardrails!.policyPacks = [];
    });
    expect(packs.find((c) => c.category === "guardrail")?.severity).toBe("high");
  });

  it("labels evaluations replace/remove and deployment environment change", () => {
    const evaluations = diffTo((m) => {
      m.spec.evaluations!.requiredTags = ["release-gate", "smoke"];
    });
    expect(only(evaluations, "spec.evaluations")).toMatchObject({
      category: "evaluation",
      severity: "medium",
      operation: "replace",
    });
    const removed = diffTo((m) => {
      delete m.spec.evaluations;
    });
    expect(only(removed, "spec.evaluations").operation).toBe("remove");

    const environment = diffTo((m) => {
      m.spec.deployment!.defaultEnvironment = "development";
    });
    expect(only(environment, "spec.deployment.defaultEnvironment")).toMatchObject({
      category: "deployment",
      severity: "medium",
    });
  });
});
