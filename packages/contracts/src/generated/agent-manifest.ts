/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */

/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "identifier".
 */
export type Identifier = string
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "artifactSource".
 */
export type ArtifactSource = ({
inline?: string
file?: string
remoteRef?: string
} & ArtifactSource1)
export type ArtifactSource1 = {
[k: string]: unknown
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "functionHandler".
 */
export type FunctionHandler = ({
[k: string]: unknown
} & {
type: ("integration" | "webhook" | "mcp" | "raia-skill")
integrationRef?: string
endpoint?: string
mcpServerRef?: string
mcpTool?: string
skillRef?: string
credential?: SecretReference
})

/**
 * Canonical developer-facing definition of a versioned raia agent.
 */
export interface RaiaAgentManifest {
apiVersion: "devkit.raia.ai/v1alpha1"
kind: "Agent"
metadata: Metadata
spec: AgentSpec
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "metadata".
 */
export interface Metadata {
name: Identifier
description?: string
workspaceId?: string
agentId?: string
labels?: StringMap
annotations?: StringMap
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "stringMap".
 */
export interface StringMap {
[k: string]: string
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "agentSpec".
 */
export interface AgentSpec {
persona?: Persona
instructions: ArtifactSource
model: ModelConfig
skills?: Skill[]
functions?: FunctionDefinition[]
knowledge?: KnowledgePack[]
escalation?: Escalation
guardrails?: Guardrails
integrations?: Integration[]
evaluations?: EvaluationConfig
deployment?: DeploymentDefaults
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "persona".
 */
export interface Persona {
displayName?: string
role?: string
/**
 * @maxItems 12
 */
tone?: []|[string]|[string, string]|[string, string, string]|[string, string, string, string]|[string, string, string, string, string]|[string, string, string, string, string, string]|[string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string]|[string, string, string, string, string, string, string, string, string, string, string, string]
brandVoice?: ArtifactSource
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "modelConfig".
 */
export interface ModelConfig {
modelId: string
temperature?: number
maxOutputTokens?: number
reasoning?: ("disabled" | "low" | "medium" | "high")
responseFormat?: ("text" | "json")
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "skill".
 */
export interface Skill {
name: Identifier
source: ResourceReference
enabled?: boolean
configuration?: {
[k: string]: unknown
}
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "resourceReference".
 */
export interface ResourceReference {
remoteRef: string
version?: string
checksum?: string
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "functionDefinition".
 */
export interface FunctionDefinition {
name: Identifier
description: string
/**
 * JSON Schema for function input.
 */
inputSchema: {

}
/**
 * Optional JSON Schema for function output.
 */
outputSchema?: {

}
handler: FunctionHandler
riskLevel?: ("low" | "medium" | "high" | "critical")
requiresConfirmation?: boolean
timeoutMs?: number
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "secretReference".
 */
export interface SecretReference {
secretRef: string
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "knowledgePack".
 */
export interface KnowledgePack {
name: Identifier
source: ResourceReference
retrieval?: {
topK?: number
minimumScore?: number
queryRewrite?: boolean
}
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "escalation".
 */
export interface Escalation {
enabled: boolean
/**
 * @maxItems 50
 */
conditions?: string[]
destinations?: string[]
handoffMessage?: ArtifactSource
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "guardrails".
 */
export interface Guardrails {
policyPacks?: ResourceReference[]
blockedTopics?: string[]
piiHandling?: ("deny" | "redact" | "allow-by-policy")
promptInjectionDefense?: ("standard" | "strict")
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "integration".
 */
export interface Integration {
name: Identifier
source: ResourceReference
credential?: SecretReference
configuration?: {
[k: string]: unknown
}
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "evaluationConfig".
 */
export interface EvaluationConfig {
/**
 * @minItems 1
 */
suites: [string, ...(string)[]]
requiredTags?: string[]
}
/**
 * This interface was referenced by `RaiaAgentManifest`'s JSON-Schema
 * via the `definition` "deploymentDefaults".
 */
export interface DeploymentDefaults {
defaultEnvironment?: ("development" | "staging")
releasePolicy?: string
}
