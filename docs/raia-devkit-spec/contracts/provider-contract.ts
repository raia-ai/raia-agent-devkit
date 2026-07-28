/*
 * Normative interface contract for the raia Agent DevKit.
 * Implementations: filesystem-backed mock provider and HTTPS management provider.
 */

export type Sha256 = `sha256:${string}`;
export type Region = "us" | "eu" | "custom";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ChangeState =
  | "DRAFT"
  | "PLANNED"
  | "VALIDATED"
  | "EVALUATED"
  | "APPROVED"
  | "REJECTED"
  | "RELEASED";
export type DeploymentState =
  | "QUEUED"
  | "DEPLOYING"
  | "HEALTHY"
  | "FAILED"
  | "ROLLING_BACK"
  | "ROLLED_BACK"
  | "SUPERSEDED";

export interface OperationContext {
  requestId: string;
  signal?: AbortSignal;
}

export interface MutationContext extends OperationContext {
  idempotencyKey: string;
  baseVersionId?: string;
  expectedEtag?: string;
}

export interface PageRequest {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface Identity {
  principalId: string;
  principalType: "user" | "service";
  email?: string;
  scopes: string[];
  workspaceIds: string[];
}

export interface Workspace {
  id: string;
  name: string;
  region: "us" | "eu";
}

export interface AgentSummary {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  currentVersionId: string;
  etag: string;
  updatedAt: string;
}

export interface AgentArtifact {
  path: string;
  sha256: Sha256;
  encoding: "utf8" | "base64";
  mediaType?: string;
  content: string;
}

export interface AgentBundle {
  manifest: unknown;
  lock: unknown;
  artifacts: AgentArtifact[];
}

export interface AgentExport {
  workspaceId: string;
  agentId: string;
  versionId: string;
  etag: string;
  bundle: AgentBundle;
}

export interface SemanticChange {
  path: string;
  category:
    | "metadata"
    | "instructions"
    | "model"
    | "skill"
    | "function"
    | "knowledge"
    | "escalation"
    | "guardrail"
    | "integration"
    | "evaluation"
    | "deployment";
  operation: "add" | "remove" | "replace";
  before?: unknown;
  after?: unknown;
  severity: "info" | RiskLevel;
  breaking: boolean;
  reason: string;
  affectedCapabilities?: string[];
}

export interface ChangePlan {
  planId: string;
  baseVersionId: string;
  manifestSha256: Sha256;
  risk: RiskLevel;
  changes: SemanticChange[];
  warnings: string[];
  createdAt: string;
}

export interface Draft {
  id: string;
  agentId: string;
  baseVersionId: string;
  manifestSha256: Sha256;
  state: Exclude<ChangeState, "RELEASED">;
  createdAt: string;
  etag: string;
}

export interface EvaluationRun {
  id: string;
  agentId: string;
  candidateSha256: Sha256;
  suiteSha256: Sha256;
  state: "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "CANCELLED";
  summary?: Record<string, unknown>;
  results?: Array<Record<string, unknown>>;
  createdAt: string;
  completedAt?: string;
}

export interface EvidenceReference {
  type: "validation" | "evaluation" | "approval";
  id: string;
  sha256: Sha256;
}

export interface ReleaseCandidate {
  id: string;
  agentId: string;
  baseVersionId: string;
  candidateSha256: Sha256;
  manifestSha256: Sha256;
  state: "RELEASED" | "REVOKED";
  createdAt: string;
}

export interface Deployment {
  id: string;
  releaseCandidateId: string;
  environment: "development" | "staging" | "production";
  state: DeploymentState;
  rollbackTargetId?: string;
  health?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TraceSummary {
  id: string;
  agentId: string;
  versionId: string;
  startedAt: string;
  outcome: "success" | "failure" | "escalated" | "unknown";
  tags: string[];
}

export interface Trace extends TraceSummary {
  events: Array<Record<string, unknown>>;
  redactions: string[];
  truncated: boolean;
}

export interface ManagementProvider {
  getIdentity(context: OperationContext): Promise<Identity>;
  listWorkspaces(context: OperationContext, page?: PageRequest): Promise<Page<Workspace>>;
  listAgents(
    context: OperationContext,
    workspaceId: string,
    page?: PageRequest,
  ): Promise<Page<AgentSummary>>;
  exportAgent(
    context: OperationContext,
    agentId: string,
    versionId?: string,
  ): Promise<AgentExport>;
  createChangePlan(
    context: OperationContext,
    input: {
      agentId: string;
      baseVersionId: string;
      manifestSha256: Sha256;
      bundle: AgentBundle;
    },
  ): Promise<ChangePlan>;
  createDraft(
    context: MutationContext,
    input: {
      agentId: string;
      manifestSha256: Sha256;
      bundle: AgentBundle;
      clientMetadata?: Record<string, unknown>;
    },
  ): Promise<Draft>;
  createEvaluationRun(
    context: MutationContext,
    input: {
      agentId: string;
      draftId?: string;
      candidateSha256: Sha256;
      suiteSha256: Sha256;
      suitePaths: string[];
      mode: "fixture" | "live";
      repetitions: number;
      seed?: number;
    },
  ): Promise<EvaluationRun>;
  getEvaluationRun(context: OperationContext, runId: string): Promise<EvaluationRun>;
  createReleaseCandidate(
    context: MutationContext,
    input: {
      agentId: string;
      draftId?: string;
      candidateSha256: Sha256;
      manifestSha256: Sha256;
      lockSha256: Sha256;
      gitCommit?: string;
      evidence: EvidenceReference[];
    },
  ): Promise<ReleaseCandidate>;
  createDeployment(
    context: MutationContext,
    input: {
      releaseCandidateId: string;
      environment: "development" | "staging" | "production";
      reason?: string;
    },
  ): Promise<Deployment>;
  getDeployment(context: OperationContext, deploymentId: string): Promise<Deployment>;
  rollbackDeployment(
    context: MutationContext,
    deploymentId: string,
    reason: string,
  ): Promise<Deployment>;
  listTraces(
    context: OperationContext,
    input: {
      agentId: string;
      versionId?: string;
      outcome?: TraceSummary["outcome"];
      page?: PageRequest;
    },
  ): Promise<Page<TraceSummary>>;
  getTrace(context: OperationContext, traceId: string, maxBytes: number): Promise<Trace>;
}

export interface ConversationProvider {
  createConversation(input?: {
    channel?: string;
    context?: string;
    user?: Record<string, unknown>;
  }): Promise<{ id: string }>;
  deleteConversation(conversationId: string): Promise<void>;
  sendMessage(input: {
    message: string;
    conversationId?: string;
    channel?: string;
    context?: string;
    user?: Record<string, unknown>;
  }): Promise<{
    id: string;
    conversationId: string;
    role: "assistant";
    content: string;
    createdAt: string;
  }>;
  getMessages(conversationId: string): Promise<Array<Record<string, unknown>>>;
}

export type ProviderErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "STALE_BASE"
  | "IDEMPOTENCY_MISMATCH"
  | "INVALID_TRANSITION"
  | "VALIDATION_FAILED"
  | "POLICY_FAILED"
  | "EVALUATION_GATE_FAILED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "INTERNAL";

export class ProviderError extends Error {
  readonly name = "ProviderError";

  constructor(
    message: string,
    readonly code: ProviderErrorCode,
    readonly requestId?: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
