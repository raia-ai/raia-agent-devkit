import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findDuplicateNames, loadManifest } from "../src/index.js";
import { createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("loadManifest", () => {
  it("loads the helpdesk example and every referenced file", async () => {
    const loaded = await loadManifest(fixture.root);
    expect(loaded.manifest.metadata.name).toBe("helpdesk-agent");
    expect([...loaded.artifacts.keys()].sort()).toEqual([
      "prompts/brand-voice.md",
      "prompts/system.md",
    ]);
    expect(loaded.manifestSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is deterministic for an unchanged project", async () => {
    const first = await loadManifest(fixture.root);
    const second = await loadManifest(fixture.root);
    expect(first.manifestSha256).toBe(second.manifestSha256);
  });

  it("changes the manifest hash when a referenced prompt changes", async () => {
    const before = await loadManifest(fixture.root);
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nBe extra brief.\n");
    const after = await loadManifest(fixture.root);
    expect(after.manifestSha256).not.toBe(before.manifestSha256);
  });

  it("keeps the manifest hash stable when only YAML key order changes", async () => {
    const before = await loadManifest(fixture.root);
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    // Swap the order of the top-level apiVersion/kind lines.
    const reordered = source.replace(
      "apiVersion: devkit.raia.ai/v1alpha1\nkind: Agent\n",
      "kind: Agent\napiVersion: devkit.raia.ai/v1alpha1\n",
    );
    expect(reordered).not.toBe(source);
    await writeFile(manifestPath, reordered);
    const after = await loadManifest(fixture.root);
    expect(after.manifestSha256).toBe(before.manifestSha256);
  });

  it("rejects a manifest that violates the schema", async () => {
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, source.replace("kind: Agent", "kind: NotAnAgent"));
    await expect(loadManifest(fixture.root)).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("rejects malformed YAML", async () => {
    await writeFile(path.join(fixture.root, "raia.agent.yaml"), "a: [unclosed");
    await expect(loadManifest(fixture.root)).rejects.toMatchObject({ code: "MANIFEST_INVALID" });
  });
});

describe("findDuplicateNames", () => {
  it("returns nothing for the helpdesk example", async () => {
    const loaded = await loadManifest(fixture.root);
    expect(findDuplicateNames(loaded.manifest)).toEqual([]);
  });

  it("detects a duplicate skill name", async () => {
    const loaded = await loadManifest(fixture.root);
    const manifest = structuredClone(loaded.manifest);
    manifest.spec.skills = [...(manifest.spec.skills ?? []), manifest.spec.skills![0]!];
    const duplicates = findDuplicateNames(manifest);
    expect(duplicates).toEqual([{ collection: "skills", name: "answer-faq" }]);
  });
});
