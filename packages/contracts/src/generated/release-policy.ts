/* Generated from the normative JSON Schemas by scripts/generate-types.mjs. DO NOT EDIT. */

export interface RaiaAgentReleasePolicy {
apiVersion: "devkit.raia.ai/v1alpha1"
kind: "ReleasePolicy"
metadata: {
name: string
description?: string
}
spec: {
validation: {
requireSchema: boolean
requireSecretScan: boolean
requireNoDrift: boolean
maximumRisk?: ("low" | "medium" | "high" | "critical")
}
evaluation: {
requiredSuites: string[]
requiredTags?: string[]
minimumPassRate?: number
blockOnCriticalFailure: boolean
maximumRegressionCount?: number
}
approval: {
stagingApprovals: number
productionApprovals?: number
requiredRoles?: string[]
}
environments: {
claudeCodeAllowed: ("development" | "staging")[]
requireImmutableRelease?: boolean
}
}
}
