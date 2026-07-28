/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */

/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "identifier".
 */
export type Identifier = string
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "stringArray".
 */
export type StringArray = string[]
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "assertion".
 */
export type Assertion = ({
[k: string]: unknown
} & {
id: Identifier
type: ("exact" | "contains" | "regex" | "json-schema" | "tool-call" | "tool-not-called" | "latency" | "cost" | "conversation-state" | "rubric")
target?: ("last-assistant-message" | "conversation" | "tool-trajectory" | "final-state" | "run")
expected?: unknown
schema?: {

}
toolName?: string
maximum?: number
rubric?: string
minimumScore?: number
critical?: boolean
})

export interface RaiaAgentEvaluationSuite {
apiVersion: "devkit.raia.ai/v1alpha1"
kind: "EvaluationSuite"
metadata: {
name: Identifier
description?: string
tags?: StringArray
}
spec: {
defaults?: Defaults
/**
 * @minItems 1
 */
cases: [Case, ...(Case)[]]
}
}
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "defaults".
 */
export interface Defaults {
mode?: ("fixture" | "live")
repetitions?: number
timeoutMs?: number
concurrency?: number
seed?: number
}
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "case".
 */
export interface Case {
id: Identifier
description: string
criticality: ("informational" | "standard" | "high" | "blocking")
tags?: StringArray
persona?: Persona
initialContext?: {
[k: string]: unknown
}
conversation: ({
/**
 * @minItems 1
 */
turns: [Turn, ...(Turn)[]]
} | {
simulator: Simulator
})
toolPolicy?: ToolPolicy
expectedStates?: string[]
/**
 * @minItems 1
 */
assertions: [Assertion, ...(Assertion)[]]
businessMetrics?: {
[k: string]: (string | number | boolean | null)
}
}
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "persona".
 */
export interface Persona {
description?: string
goal?: string
/**
 * @maxItems 30
 */
behavior?: string[]
}
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "turn".
 */
export interface Turn {
role: ("user" | "assistant" | "tool")
content: string
toolName?: string
fixtureRef?: string
}
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "simulator".
 */
export interface Simulator {
goal: string
maxTurns: number
modelRef?: string
}
/**
 * This interface was referenced by `RaiaAgentEvaluationSuite`'s JSON-Schema
 * via the `definition` "toolPolicy".
 */
export interface ToolPolicy {
allowed?: StringArray
forbidden?: StringArray
}
