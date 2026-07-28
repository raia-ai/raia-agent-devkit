/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */

/**
 * This interface was referenced by `RaiaAgentLockFile`'s JSON-Schema
 * via the `definition` "sha256".
 */
export type Sha256 = string
/**
 * This interface was referenced by `RaiaAgentLockFile`'s JSON-Schema
 * via the `definition` "resolvedItemArray".
 */
export type ResolvedItemArray = ResolvedItem[]

/**
 * Deterministic resolution record for a raia agent manifest.
 */
export interface RaiaAgentLockFile {
lockVersion: 1
manifestApiVersion: "devkit.raia.ai/v1alpha1"
manifestSha256: Sha256
/**
 * Informational only; excluded from deterministic content hashing.
 */
generatedAt?: string
generatedBy: {
cliVersion: string
gitCommit?: string
}
remote?: {
workspaceId: string
agentId: string
baseVersionId: string
etag: string
region?: ("us" | "eu" | "custom")
}
resolved: {
model: ResolvedItem
skills: ResolvedItemArray
functions: ResolvedItemArray
knowledge: ResolvedItemArray
integrations: ResolvedItemArray
policyPacks: ResolvedItemArray
evaluators: ResolvedItemArray
}
}
/**
 * This interface was referenced by `RaiaAgentLockFile`'s JSON-Schema
 * via the `definition` "resolvedItem".
 */
export interface ResolvedItem {
name: string
remoteId?: string
version: string
checksum: Sha256
metadata?: {
[k: string]: (string | number | boolean | null)
}
}
