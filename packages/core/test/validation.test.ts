import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest, lockSha256, validateProject } from "../src/index.js";
import { buildLockFixture, createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

// Assembled at runtime so this test file never contains a token-shaped literal.
const FAKE_TOKEN = ["ghp_", "Abcdefghijklmnopqrstuvwxyz012345"].join("");

describe("validateProject", () => {
  it("passes the unmodified helpdesk example (lock missing is a warning)", async () => {
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ code: "LOCK_MISSING", severity: "warning" });
    expect(result.manifestSha256).toMatch(/^sha256:/);
    expect(result.candidateSha256).toMatch(/^sha256:/);
    expect(Object.keys(result.suiteSha256ByPath ?? {})).toEqual([
      "evals/regression.eval.yaml",
      "evals/smoke.eval.yaml",
    ]);
    expect(result.releasePolicySha256).toMatch(/^sha256:/);
  });

  it("is deterministic (identical result payload including evidence hash)", async () => {
    const first = await validateProject(fixture.root);
    const second = await validateProject(fixture.root);
    expect(first).toEqual(second);
    expect(first.evidenceSha256).toBe(second.evidenceSha256);
  });

  it("accepts a matching lock and reports its hash", async () => {
    const loaded = await loadManifest(fixture.root);
    const lock = buildLockFixture(loaded.manifestSha256);
    await writeFile(path.join(fixture.root, "raia.lock.json"), JSON.stringify(lock, null, 2));
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.lockSha256).toBe(lockSha256(lock));
  });

  it("fails on lock drift after a manifest-affecting change", async () => {
    const loaded = await loadManifest(fixture.root);
    const lock = buildLockFixture(loaded.manifestSha256);
    await writeFile(path.join(fixture.root, "raia.lock.json"), JSON.stringify(lock, null, 2));
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nchanged\n");
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("LOCK_DRIFT");
  });

  it("fails with SECRET_DETECTED when a raw token lands in the manifest, and redacts it", async () => {
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      source.replace("region: us", `region: us\n        apiToken: ${FAKE_TOKEN}`),
    );
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    const secretFindings = result.findings.filter((f) => f.code === "SECRET_DETECTED");
    expect(secretFindings.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it("fails with SECRET_DETECTED for a token in a referenced prompt file", async () => {
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(promptPath, `token = ${FAKE_TOKEN}\n`);
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "SECRET_DETECTED")).toBe(true);
  });

  it("fails with duplicate names", async () => {
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    // Rename the second skill to collide with the first.
    const duplicated = source.replace("- name: handoff-to-human", "- name: answer-faq");
    expect(duplicated).not.toBe(source);
    await writeFile(manifestPath, duplicated);
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "DUPLICATE_NAME")).toBe(true);
  });

  it("fails before reading a ../ traversal reference", async () => {
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      source.replace("file: prompts/system.md", "file: ../../etc/hostname"),
    );
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "PATH_ESCAPE")).toBe(true);
  });

  it("fails on a symlink escape from inside the project", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "raia-outside-"));
    await writeFile(path.join(outside, "external.md"), "outside content");
    await mkdir(path.join(fixture.root, "linked"), { recursive: true });
    await symlink(
      path.join(outside, "external.md"),
      path.join(fixture.root, "linked", "external.md"),
    );
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      source.replace("file: prompts/brand-voice.md", "file: linked/external.md"),
    );
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "PATH_ESCAPE")).toBe(true);
  });

  it("fails when a referenced evaluation suite is missing", async () => {
    const manifestPath = path.join(fixture.root, "raia.agent.yaml");
    const source = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      source.replace("evals/smoke.eval.yaml", "evals/missing.eval.yaml"),
    );
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "REFERENCE_INVALID")).toBe(true);
  });

  it("fails when a fixture referenced by a suite is malformed JSON", async () => {
    await writeFile(path.join(fixture.root, "fixtures", "order-shipped.json"), "{not json");
    const result = await validateProject(fixture.root);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "SCHEMA_INVALID")).toBe(true);
  });

  it("changes candidate identity between two differing projects", async () => {
    const before = await validateProject(fixture.root);
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nmore\n");
    const after = await validateProject(fixture.root);
    expect(after.candidateSha256).not.toBe(before.candidateSha256);
  });
});
