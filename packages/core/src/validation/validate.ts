/**
 * Project validation engine (build spec section 15): schema, duplicate-name,
 * reference, file-boundary, secret, suite/policy, and lock checks. Findings are
 * deterministic, ordered, and redacted; a blocking failure means `ok: false`.
 */
import path from "node:path";
import type { RaiaAgentLockFile, Sha256 } from "@raia/contracts";
import { DevkitError, type DevkitErrorCode } from "../errors.js";
import type { FileSystem } from "../fs/file-system.js";
import { nodeFileSystem } from "../fs/file-system.js";
import { hashCanonical } from "../hash/canonical.js";
import { computeCandidateSha256 } from "../candidate.js";
import {
  findDuplicateNames,
  loadManifest,
  MANIFEST_FILE_NAME,
  type LoadedManifest,
} from "../manifest/load.js";
import {
  loadEvaluationSuite,
  loadReleasePolicy,
  type LoadedReleasePolicy,
  type LoadedSuite,
} from "../evals/resources.js";
import { checkLockDrift, lockSha256, parseLock } from "../lock/lock.js";
import { scanForSecrets } from "../redaction/redact.js";

export const VALIDATION_RULE_SET_VERSION = "1";

export type FindingSeverity = "error" | "warning";

export interface ValidationFinding {
  code: DevkitErrorCode | "LOCK_MISSING";
  severity: FindingSeverity;
  message: string;
  path: string | undefined;
}

export interface ValidationResult {
  ok: boolean;
  ruleSetVersion: string;
  findings: ValidationFinding[];
  /** Present when the project loaded far enough to compute identity. */
  manifestSha256?: Sha256;
  lockSha256?: Sha256;
  suiteSha256ByPath?: Record<string, Sha256>;
  releasePolicySha256?: Sha256;
  candidateSha256?: Sha256;
  /** Hash of the deterministic result payload (evidence identity). */
  evidenceSha256?: Sha256;
}

export const LOCK_FILE_NAME = "raia.lock.json";

export async function validateProject(
  projectRoot: string,
  options?: { fs?: FileSystem },
): Promise<ValidationResult> {
  const fs = options?.fs ?? nodeFileSystem;
  const findings: ValidationFinding[] = [];

  const record = (
    code: ValidationFinding["code"],
    severity: FindingSeverity,
    message: string,
    path?: string,
  ): void => {
    findings.push({ code, severity, message, path });
  };

  let loaded: LoadedManifest | undefined;
  try {
    loaded = await loadManifest(projectRoot, { fs });
  } catch (error) {
    if (error instanceof DevkitError) {
      record(error.code, "error", error.message, error.path);
    } else {
      record("IO_ERROR", "error", "Unable to load the agent manifest.", MANIFEST_FILE_NAME);
    }
  }

  const suites = new Map<string, LoadedSuite>();
  let releasePolicy: LoadedReleasePolicy | undefined;
  let lock: RaiaAgentLockFile | undefined;

  if (loaded) {
    for (const duplicate of findDuplicateNames(loaded.manifest)) {
      record(
        "DUPLICATE_NAME",
        "error",
        `Duplicate ${duplicate.collection} name "${duplicate.name}".`,
        `spec.${duplicate.collection}`,
      );
    }

    // Secret scan across manifest source and every referenced artifact.
    for (const [location, text] of [
      [MANIFEST_FILE_NAME, loaded.source] as const,
      ...[...loaded.artifacts.values()].map(
        (artifact) => [artifact.posixRelative, artifact.content] as const,
      ),
    ]) {
      for (const finding of scanForSecrets(text, location)) {
        record(
          "SECRET_DETECTED",
          "error",
          `Secret-like content (rule ${finding.ruleId}, rule set v${finding.ruleSetVersion}) at ${finding.location}:${finding.line}.`,
          finding.location,
        );
      }
    }

    // Evaluation suites (schema + fixtures + secret scan).
    for (const suitePath of loaded.manifest.spec.evaluations?.suites ?? []) {
      try {
        const suite = await loadEvaluationSuite(projectRoot, suitePath, { fs });
        suites.set(suite.posixRelative, suite);
        for (const [fixturePath, fixture] of suite.fixtures) {
          for (const finding of scanForSecrets(fixture.content, fixturePath)) {
            record(
              "SECRET_DETECTED",
              "error",
              `Secret-like content (rule ${finding.ruleId}) at ${finding.location}:${finding.line}.`,
              fixturePath,
            );
          }
        }
      } catch (error) {
        if (error instanceof DevkitError) {
          record(error.code, "error", error.message, error.path ?? suitePath);
        } else {
          record("IO_ERROR", "error", "Unable to load evaluation suite.", suitePath);
        }
      }
    }

    // Release policy.
    const policyPath = loaded.manifest.spec.deployment?.releasePolicy;
    if (policyPath !== undefined) {
      try {
        releasePolicy = await loadReleasePolicy(projectRoot, policyPath, { fs });
      } catch (error) {
        if (error instanceof DevkitError) {
          record(error.code, "error", error.message, error.path ?? policyPath);
        } else {
          record("IO_ERROR", "error", "Unable to load release policy.", policyPath);
        }
      }
    }

    // Lock checks.
    try {
      const lockPath = path.join(path.resolve(projectRoot), LOCK_FILE_NAME);
      if (await fs.exists(lockPath)) {
        lock = parseLock(await fs.readFile(lockPath), LOCK_FILE_NAME);
        const drift = checkLockDrift(lock, loaded.manifestSha256);
        if (drift) {
          record(
            "LOCK_DRIFT",
            "error",
            "The lock file was generated from a different manifest; run pull/lock regeneration.",
            LOCK_FILE_NAME,
          );
        }
      } else {
        record(
          "LOCK_MISSING",
          "warning",
          "No lock file found; remote drift protection is unavailable until one is generated.",
          LOCK_FILE_NAME,
        );
      }
    } catch (error) {
      if (error instanceof DevkitError) {
        record(error.code, "error", error.message, error.path);
      } else {
        record("IO_ERROR", "error", "Unable to read the lock file.", LOCK_FILE_NAME);
      }
    }
  }

  findings.sort(
    (a, b) =>
      (a.path ?? "").localeCompare(b.path ?? "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );

  const ok = findings.every((finding) => finding.severity !== "error");
  const result: ValidationResult = {
    ok,
    ruleSetVersion: VALIDATION_RULE_SET_VERSION,
    findings,
  };

  if (loaded) {
    const suiteSha256ByPath: Record<string, Sha256> = {};
    for (const [suitePath, suite] of [...suites.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      suiteSha256ByPath[suitePath] = suite.sha256;
    }
    result.manifestSha256 = loaded.manifestSha256;
    result.suiteSha256ByPath = suiteSha256ByPath;
    if (lock) {
      result.lockSha256 = lockSha256(lock);
    }
    if (releasePolicy) {
      result.releasePolicySha256 = releasePolicy.sha256;
    }
    result.candidateSha256 = computeCandidateSha256({
      manifestSha256: loaded.manifestSha256,
      lockSha256: result.lockSha256,
      suiteSha256ByPath,
      releasePolicySha256: result.releasePolicySha256,
    });
    result.evidenceSha256 = hashCanonical({
      ruleSetVersion: result.ruleSetVersion,
      ok: result.ok,
      findings: result.findings,
      candidateSha256: result.candidateSha256,
    });
  }
  return result;
}
