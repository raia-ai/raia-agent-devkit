import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkLockDrift,
  computeCandidateSha256,
  loadEvaluationSuite,
  loadManifest,
  loadReleasePolicy,
  lockSha256,
  parseLock,
} from "../src/index.js";
import type { Sha256 } from "@raia/contracts";
import { buildLockFixture, createHelpdeskFixture, type ProjectFixture } from "./helpers.js";

let fixture: ProjectFixture;

beforeEach(async () => {
  fixture = await createHelpdeskFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("lock", () => {
  it("parses a schema-valid lock and hashes deterministically", async () => {
    const loaded = await loadManifest(fixture.root);
    const lock = buildLockFixture(loaded.manifestSha256);
    const parsed = parseLock(JSON.stringify(lock));
    expect(lockSha256(parsed)).toBe(lockSha256(lock));
  });

  it("excludes generatedAt from the deterministic hash", async () => {
    const loaded = await loadManifest(fixture.root);
    const lock = buildLockFixture(loaded.manifestSha256);
    const later = { ...lock, generatedAt: "2027-01-01T12:34:56Z" };
    expect(lockSha256(later)).toBe(lockSha256(lock));
  });

  it("rejects a lock that violates its schema", () => {
    expect(() => parseLock(JSON.stringify({ lockVersion: 2 }))).toThrowError(
      expect.objectContaining({ code: "LOCK_INVALID" }),
    );
  });

  it("detects manifest drift", async () => {
    const loaded = await loadManifest(fixture.root);
    const lock = buildLockFixture(loaded.manifestSha256);
    expect(checkLockDrift(lock, loaded.manifestSha256)).toBeUndefined();
    const otherHash = ("sha256:" + "b".repeat(64)) as Sha256;
    expect(checkLockDrift(lock, otherHash)).toBeDefined();
  });
});

describe("candidate identity (build spec section 13)", () => {
  async function candidateForCurrentProject(): Promise<Sha256> {
    const loaded = await loadManifest(fixture.root);
    const suites: Record<string, Sha256> = {};
    for (const suitePath of loaded.manifest.spec.evaluations?.suites ?? []) {
      const suite = await loadEvaluationSuite(fixture.root, suitePath);
      suites[suite.posixRelative] = suite.sha256;
    }
    const policy = await loadReleasePolicy(
      fixture.root,
      loaded.manifest.spec.deployment!.releasePolicy!,
    );
    const lock = buildLockFixture(loaded.manifestSha256);
    return computeCandidateSha256({
      manifestSha256: loaded.manifestSha256,
      lockSha256: lockSha256(lock),
      suiteSha256ByPath: suites,
      releasePolicySha256: policy.sha256,
    });
  }

  it("is stable for an unchanged project", async () => {
    expect(await candidateForCurrentProject()).toBe(await candidateForCurrentProject());
  });

  it("changes when a prompt changes", async () => {
    const before = await candidateForCurrentProject();
    const promptPath = path.join(fixture.root, "prompts", "system.md");
    await writeFile(promptPath, (await readFile(promptPath, "utf8")) + "\nextra\n");
    expect(await candidateForCurrentProject()).not.toBe(before);
  });

  it("changes when an evaluation suite changes", async () => {
    const before = await candidateForCurrentProject();
    const suitePath = path.join(fixture.root, "evals", "smoke.eval.yaml");
    const source = await readFile(suitePath, "utf8");
    await writeFile(suitePath, source.replace("expected: shipped", "expected: delivered"));
    expect(await candidateForCurrentProject()).not.toBe(before);
  });

  it("changes when a fixture changes", async () => {
    const before = await candidateForCurrentProject();
    const fixturePath = path.join(fixture.root, "fixtures", "order-shipped.json");
    const content = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    content["latencyMs"] = 999;
    await writeFile(fixturePath, JSON.stringify(content, null, 2));
    expect(await candidateForCurrentProject()).not.toBe(before);
  });

  it("changes when the release policy changes", async () => {
    const before = await candidateForCurrentProject();
    const policyPath = path.join(fixture.root, "policies", "default.release-policy.yaml");
    const source = await readFile(policyPath, "utf8");
    await writeFile(policyPath, source.replace("minimumPassRate: 0.95", "minimumPassRate: 0.9"));
    expect(await candidateForCurrentProject()).not.toBe(before);
  });

  it("changes when the lock changes", async () => {
    const loaded = await loadManifest(fixture.root);
    const base = {
      manifestSha256: loaded.manifestSha256,
      suiteSha256ByPath: {},
      releasePolicySha256: undefined,
    };
    const lockA = buildLockFixture(loaded.manifestSha256);
    const lockB = buildLockFixture(loaded.manifestSha256);
    lockB.resolved.model.version = "2";
    expect(computeCandidateSha256({ ...base, lockSha256: lockSha256(lockA) })).not.toBe(
      computeCandidateSha256({ ...base, lockSha256: lockSha256(lockB) }),
    );
  });

  it("changes when the core version changes", async () => {
    const loaded = await loadManifest(fixture.root);
    const base = {
      manifestSha256: loaded.manifestSha256,
      lockSha256: undefined,
      suiteSha256ByPath: {},
      releasePolicySha256: undefined,
    };
    expect(computeCandidateSha256(base)).not.toBe(
      computeCandidateSha256({ ...base, coreVersion: "9.9.9" }),
    );
  });
});
