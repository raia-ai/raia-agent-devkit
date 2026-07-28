/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */

/**
 * This interface was referenced by `RaiaAgentDevKitWorkflowState`'s JSON-Schema
 * via the `definition` "stage".
 */
export type Stage = ("DRAFT" | "PLANNED" | "VALIDATED" | "EVALUATED" | "APPROVED" | "REJECTED" | "RELEASED")
/**
 * This interface was referenced by `RaiaAgentDevKitWorkflowState`'s JSON-Schema
 * via the `definition` "sha256".
 */
export type Sha256 = string

/**
 * Local resumability record for one exact candidate. This file contains identifiers and hashes, never credentials or agent content.
 */
export interface RaiaAgentDevKitWorkflowState {
stateVersion: 1
agentId: string
workspaceId: string
stage: Stage
candidate: {
baseVersionId: string
expectedEtag: string
manifestSha256: Sha256
lockSha256: Sha256
candidateSha256: Sha256
releasePolicySha256?: Sha256
gitCommit?: string
coreVersion: string
}
remote?: {
planId?: string
draftId?: string
evaluationRunIds?: string[]
releaseCandidateId?: string
deploymentIds?: string[]
}
evidence: Evidence[]
/**
 * @minItems 1
 */
history: [Transition, ...(Transition)[]]
/**
 * Informational only and excluded from deterministic candidate hashing.
 */
updatedAt: string
}
/**
 * This interface was referenced by `RaiaAgentDevKitWorkflowState`'s JSON-Schema
 * via the `definition` "evidence".
 */
export interface Evidence {
id: string
type: ("plan" | "validation" | "evaluation" | "approval" | "release" | "deployment")
sha256: Sha256
candidateSha256: Sha256
status: ("passed" | "failed" | "approved" | "rejected" | "created" | "healthy" | "error")
path?: string
remoteId?: string
createdAt: string
}
/**
 * This interface was referenced by `RaiaAgentDevKitWorkflowState`'s JSON-Schema
 * via the `definition` "transition".
 */
export interface Transition {
from: (Stage | null)
to: Stage
candidateSha256: Sha256
evidenceIds: string[]
occurredAt: string
actor?: string
}
