/**
 * WP1 golden path (build spec section 29, scenarios 1 and 2, local-core scope):
 * validate the pristine helpdesk example, edit prompts/system.md, and observe a
 * changed manifest/candidate hash plus a stable typed `instructions` diff.
 * Prints the machine evidence so the run doubles as the demonstrable output.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  diffManifests,
  loadManifest,
  validateProject,
  type LoadedManifest,
  type ManifestSnapshot,
} from "../src/index.js";
import { createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

function snapshot(loaded: LoadedManifest): ManifestSnapshot {
  return {
    manifest: loaded.manifest,
    artifactSha256ByPath: new Map(
      [...loaded.artifacts.values()].map((artifact) => [artifact.posixRelative, artifact.sha256]),
    ),
  };
}

describe("WP1 golden path", () => {
  it("validates, edits the system prompt, and yields a stable instructions diff", async () => {
    const initial = await validateProject(fixture.root);
    expect(initial.ok).toBe(true);
    expect(initial.findings.map((f) => f.code)).toEqual(["LOCK_MISSING"]);

    const before = await loadManifest(fixture.root);
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(
      promptPath,
      (await readFile(promptPath, "utf8")) +
        "\nAlways confirm the order number back to the user.\n",
    );
    const after = await loadManifest(fixture.root);

    expect(after.manifestSha256).not.toBe(before.manifestSha256);
    const diff = diffManifests(snapshot(before), snapshot(after));
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      category: "instructions",
      path: "spec.instructions",
      operation: "replace",
      severity: "medium",
      breaking: false,
    });
    expect(diff.risk).toBe("medium");

    const changed = await validateProject(fixture.root);
    expect(changed.ok).toBe(true);
    expect(changed.candidateSha256).not.toBe(initial.candidateSha256);

    console.log(
      "GOLDEN PATH EVIDENCE " +
        JSON.stringify(
          {
            initialValidation: {
              ok: initial.ok,
              findings: initial.findings,
              manifestSha256: initial.manifestSha256,
              candidateSha256: initial.candidateSha256,
            },
            afterPromptEdit: {
              manifestSha256: after.manifestSha256,
              candidateSha256: changed.candidateSha256,
              diff,
            },
          },
          null,
          1,
        ),
    );
  });
});
