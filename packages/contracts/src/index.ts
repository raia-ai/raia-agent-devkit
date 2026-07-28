// Public API of @raia/contracts. Generated modules share generic helper names
// (Identifier, Sha256, Persona, ...), so exports are selective and renamed to
// stay unambiguous. The provider contract is the normative source for shared
// primitives such as Sha256 and RiskLevel.
export * from "./provider-contract.js";

export type {
  RaiaAgentManifest,
  AgentSpec,
  Metadata as ManifestMetadata,
  Persona as AgentPersona,
  ModelConfig,
  Skill as SkillBinding,
  FunctionDefinition,
  FunctionHandler,
  KnowledgePack,
  Escalation,
  Guardrails,
  Integration,
  EvaluationConfig,
  DeploymentDefaults,
  ArtifactSource,
  ResourceReference,
  SecretReference,
} from "./generated/agent-manifest.js";

export type { RaiaAgentLockFile, ResolvedItem } from "./generated/agent-lock.js";

export type {
  RaiaAgentEvaluationSuite,
  Defaults as EvalDefaults,
  Case as EvalCase,
  Assertion as EvalAssertion,
  Turn as EvalTurn,
  ToolPolicy as EvalToolPolicy,
} from "./generated/eval-suite.js";

export type { RaiaAgentReleasePolicy } from "./generated/release-policy.js";

export type {
  RaiaAgentDevKitWorkflowState,
  Stage as WorkflowStage,
  Evidence as WorkflowEvidence,
  Transition as WorkflowTransition,
} from "./generated/workflow-state.js";

export { schemas, type SchemaName } from "./generated/schema-objects.js";
