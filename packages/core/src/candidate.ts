/**
 * Candidate identity (build spec section 13): manifest hash + deterministic
 * lock hash + required evaluation-suite hashes + release-policy hash + core
 * engine version. A change to any referenced prompt, fixture, suite, policy,
 * or lock content changes the candidate hash.
 */
import type { Sha256 } from "@raia/contracts";
import { hashCanonical } from "./hash/canonical.js";

export const CORE_VERSION = "0.1.0";

export interface CandidateInput {
  manifestSha256: Sha256;
  lockSha256: Sha256 | undefined;
  /** Required suite hashes keyed by POSIX-relative suite path. */
  suiteSha256ByPath: Record<string, Sha256>;
  releasePolicySha256: Sha256 | undefined;
  coreVersion?: string;
}

export function computeCandidateSha256(input: CandidateInput): Sha256 {
  return hashCanonical({
    manifestSha256: input.manifestSha256,
    lockSha256: input.lockSha256 ?? null,
    suites: input.suiteSha256ByPath,
    releasePolicySha256: input.releasePolicySha256 ?? null,
    coreVersion: input.coreVersion ?? CORE_VERSION,
  });
}
