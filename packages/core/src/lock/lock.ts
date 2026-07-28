/**
 * Lock parsing, deterministic lock hashing, and manifest-drift detection
 * (build spec sections 12.2 and 13). `generatedAt` is informational and is
 * excluded from the deterministic hash.
 */
import type { RaiaAgentLockFile, Sha256 } from "@raia/contracts";
import { DevkitError } from "../errors.js";
import { hashCanonical } from "../hash/canonical.js";
import { validateAgainstSchema } from "../schema/validators.js";

export function parseLock(json: string, location = "raia.lock.json"): RaiaAgentLockFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new DevkitError("LOCK_INVALID", "Lock file is not valid JSON.", {
      path: location,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
  const { valid, issues } = validateAgainstSchema("agent-lock", parsed);
  if (!valid) {
    throw new DevkitError("LOCK_INVALID", "Lock file violates its schema.", {
      path: location,
      details: { issues },
    });
  }
  return parsed as RaiaAgentLockFile;
}

/** Deterministic lock hash: canonical hash with `generatedAt` removed. */
export function lockSha256(lock: RaiaAgentLockFile): Sha256 {
  const { generatedAt: _generatedAt, ...deterministic } = lock;
  return hashCanonical(deterministic);
}

export interface LockDrift {
  expectedManifestSha256: string;
  actualManifestSha256: string;
}

/** Returns drift details when the lock no longer matches the manifest hash. */
export function checkLockDrift(
  lock: RaiaAgentLockFile,
  manifestSha256: Sha256,
): LockDrift | undefined {
  if (lock.manifestSha256 !== manifestSha256) {
    return {
      expectedManifestSha256: lock.manifestSha256,
      actualManifestSha256: manifestSha256,
    };
  }
  return undefined;
}
