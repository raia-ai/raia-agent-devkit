import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  diffManifests,
  isInputSchemaBroadened,
  loadManifest,
  type ManifestSnapshot,
} from "../src/index.js";
import type { RaiaAgentManifest } from "@raia/contracts";
import { createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

async function snapshot(): Promise<ManifestSnapshot> {
  const loaded = await loadManifest(fixture.root);
  const artifactSha256ByPath = new Map(
    [...loaded.artifacts.values()].map((artifact) => [artifact.posixRelative, artifact.sha256]),
  );
  return { manifest: loaded.manifest, artifactSha256ByPath };
}

function cloneManifest(base: ManifestSnapshot): RaiaAgentManifest {
  return structuredClone(base.manifest);
}

describe("semantic diff", () => {
  it("returns no changes for an identical snapshot", async () => {
    const base = await snapshot();
    const result = diffManifests(base, base);
    expect(result.changes).toEqual([]);
    expect(result.risk).toBe("low");
  });

  it("classifies a prompt content change as an instructions change", async () => {
    const before = await snapshot();
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nAlways be concise.\n");
    const after = await snapshot();
    const result = diffManifests(before, after);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      category: "instructions",
      path: "spec.instructions",
      operation: "replace",
      severity: "medium",
    });
    expect(result.risk).toBe("medium");
  });

  it("produces deterministic ordering across repeated runs", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.metadata.description = "changed";
    manifest.spec.model.temperature = 0.5;
    manifest.spec.skills = manifest.spec.skills!.slice(0, 1);
    const after = { ...before, manifest };
    const first = diffManifests(before, after);
    const second = diffManifests(before, after);
    expect(first).toEqual(second);
    const keys = first.changes.map((c) => `${c.category}|${c.path}|${c.operation}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("matches named resources by name, not position", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.skills = [...manifest.spec.skills!].reverse();
    const result = diffManifests(before, { ...before, manifest });
    expect(result.changes).toEqual([]);
  });

  it("flags model identity change as high and breaking", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.model.modelId = "provider/model-next";
    const result = diffManifests(before, { ...before, manifest });
    expect(result.changes[0]).toMatchObject({
      category: "model",
      severity: "high",
      breaking: true,
    });
    expect(result.risk).toBe("high");
  });

  it("flags removed escalation as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.escalation = { enabled: false };
    const result = diffManifests(before, { ...before, manifest });
    const escalation = result.changes.find((c) => c.category === "escalation");
    expect(escalation).toMatchObject({ severity: "high", breaking: true });
    expect(result.risk).toBe("high");
  });

  it("flags removed guardrails as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    delete manifest.spec.guardrails;
    const result = diffManifests(before, { ...before, manifest });
    const guardrail = result.changes.find((c) => c.category === "guardrail");
    expect(guardrail).toMatchObject({ operation: "remove", severity: "high", breaking: true });
  });

  it("flags weakened guardrails (strict → standard) as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.guardrails = { ...manifest.spec.guardrails, promptInjectionDefense: "standard" };
    const result = diffManifests(before, { ...before, manifest });
    expect(result.changes.find((c) => c.category === "guardrail")).toMatchObject({
      severity: "high",
    });
  });

  it("flags removed knowledge as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.knowledge = [];
    const result = diffManifests(before, { ...before, manifest });
    expect(result.changes.find((c) => c.category === "knowledge")).toMatchObject({
      operation: "remove",
      severity: "high",
      breaking: true,
    });
  });

  it("flags a broadened function input schema as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    const fn = manifest.spec.functions![0]!;
    fn.inputSchema = {
      type: "object",
      additionalProperties: true,
      properties: { orderId: { type: "string" } },
    };
    const result = diffManifests(before, { ...before, manifest });
    const schemaChange = result.changes.find((c) => c.path.endsWith("inputSchema"));
    expect(schemaChange).toMatchObject({ severity: "high", breaking: true });
    expect(result.risk).toBe("high");
  });

  it("flags a weakened confirmation requirement as high risk", async () => {
    const before = await snapshot();
    const beforeManifest = cloneManifest(before);
    beforeManifest.spec.functions![0]!.requiresConfirmation = true;
    const withConfirmation: ManifestSnapshot = { ...before, manifest: beforeManifest };
    const manifest = structuredClone(beforeManifest);
    manifest.spec.functions![0]!.requiresConfirmation = false;
    const result = diffManifests(withConfirmation, { ...before, manifest });
    expect(result.changes.find((c) => c.path.endsWith("requiresConfirmation"))).toMatchObject({
      severity: "high",
      breaking: true,
    });
  });

  it("flags a new integration as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.integrations = [
      ...manifest.spec.integrations!,
      { name: "crm", source: { remoteRef: "raia-integration://crm" } },
    ];
    const result = diffManifests(before, { ...before, manifest });
    expect(
      result.changes.find((c) => c.operation === "add" && c.category === "integration"),
    ).toMatchObject({ severity: "high" });
  });

  it("flags a release-policy reference change as high risk", async () => {
    const before = await snapshot();
    const manifest = cloneManifest(before);
    manifest.spec.deployment = {
      ...manifest.spec.deployment,
      releasePolicy: "policies/other.yaml",
    };
    const result = diffManifests(before, { ...before, manifest });
    expect(result.changes.find((c) => c.category === "deployment")).toMatchObject({
      severity: "high",
    });
  });
});

describe("isInputSchemaBroadened", () => {
  const strict = {
    type: "object",
    additionalProperties: false,
    required: ["orderId"],
    properties: { orderId: { type: "string", pattern: "^ORD-[0-9]{6}$" } },
  };

  it("detects dropped required fields", () => {
    expect(isInputSchemaBroadened(strict, { ...strict, required: [] })).toBe(true);
  });

  it("detects opened additionalProperties", () => {
    expect(isInputSchemaBroadened(strict, { ...strict, additionalProperties: true })).toBe(true);
  });

  it("detects removed pattern constraints", () => {
    expect(
      isInputSchemaBroadened(strict, {
        ...strict,
        properties: { orderId: { type: "string" } },
      }),
    ).toBe(true);
  });

  it("accepts an unchanged schema", () => {
    expect(isInputSchemaBroadened(strict, structuredClone(strict))).toBe(false);
  });
});
