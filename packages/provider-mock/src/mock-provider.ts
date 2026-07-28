/**
 * Filesystem-backed mock ManagementProvider (build spec section 17):
 * identity, discovery, export, versioning, ETags, pagination, typed errors,
 * and the lifecycle mutation plane — drafts, immutable release candidates,
 * deployments with deterministic asynchronous completion, rollbacks,
 * optimistic concurrency (STALE_BASE), and idempotency replay/mismatch.
 * Remote evaluation runs and traces arrive with WP5/WP6 and fail closed with
 * typed UNAVAILABLE errors rather than pretending to succeed.
 */
import { ProviderError } from "@raia/contracts";
import type {
  AgentExport,
  AgentSummary,
  ChangePlan,
  Deployment,
  Draft,
  EvaluationRun,
  Identity,
  ManagementProvider,
  MutationContext,
  OperationContext,
  Page,
  PageRequest,
  ReleaseCandidate,
  Sha256,
  Trace,
  TraceSummary,
  Workspace,
} from "@raia/contracts";
import { decideDeploymentTransition, hashCanonical, redactValue, scanForSecrets } from "@raia/core";
import { StateStore, type MockState } from "./state.js";
import { buildBundleFromFixture } from "./seed.js";
import { defaultTraceFixtures } from "./traces.js";

export interface MockProviderOptions {
  /** Directory that holds the mock's atomic JSON state. */
  stateDir: string;
  /** Injectable clock (ISO timestamp factory). */
  now?: () => string;
  /** Scopes granted to the mock identity (permission fixtures). */
  scopes?: string[];
  /** Marks the provider as unreachable to simulate outages. */
  unavailable?: boolean;
  /** Deployment fixture: whether staging deployments converge HEALTHY or FAILED. */
  deploymentOutcome?: "healthy" | "failed";
}

const DEFAULT_SCOPES = [
  "agent:read",
  "agent:draft",
  "eval:read",
  "eval:run",
  "release:create",
  "deployment:read",
  "deployment:promote",
  "deployment:rollback",
  "trace:read",
];

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const offset = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ProviderError("Invalid pagination cursor.", "VALIDATION_FAILED");
  }
  return offset;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function paginate<T>(items: readonly T[], page: PageRequest | undefined): Page<T> {
  const offset = decodeCursor(page?.cursor);
  const limit = Math.min(Math.max(page?.limit ?? 20, 1), 100);
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit;
  const result: Page<T> = { items: [...slice] };
  if (next < items.length) {
    result.nextCursor = encodeCursor(next);
  }
  return result;
}

export class MockManagementProvider implements ManagementProvider {
  readonly #store: StateStore;
  readonly #now: () => string;
  readonly #scopes: string[];
  readonly #unavailable: boolean;
  readonly #deploymentOutcome: "healthy" | "failed";

  constructor(options: MockProviderOptions) {
    this.#store = new StateStore(options.stateDir);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#scopes = options.scopes ?? DEFAULT_SCOPES;
    this.#unavailable = options.unavailable ?? false;
    this.#deploymentOutcome = options.deploymentOutcome ?? "healthy";
  }

  #checkAvailable(context: OperationContext): void {
    if (this.#unavailable) {
      throw new ProviderError("Mock provider unavailable.", "UNAVAILABLE", context.requestId, true);
    }
  }

  /** Seeds (or reseeds) a workspace + agent from a fixture project directory. */
  async seedFromFixture(
    fixtureDir: string,
    options?: { workspaceName?: string; region?: "us" | "eu" },
  ): Promise<{ workspaceId: string; agentId: string; versionId: string; etag: string }> {
    const seed = await buildBundleFromFixture(fixtureDir);
    const now = this.#now();
    return this.#store.update((state) => {
      if (!state.workspaces.some((workspace) => workspace.id === seed.workspaceId)) {
        state.workspaces.push({
          id: seed.workspaceId,
          name: options?.workspaceName ?? seed.workspaceId,
          region: options?.region ?? "us",
        });
        state.workspaces.sort((a, b) => a.id.localeCompare(b.id));
      }
      const versionId = "v1";
      const etag = `W/"${seed.agentId}-${versionId}"`;
      const summary: AgentSummary = {
        id: seed.agentId,
        workspaceId: seed.workspaceId,
        name: seed.manifest.metadata.name,
        currentVersionId: versionId,
        etag,
        updatedAt: now,
        ...(seed.manifest.metadata.description !== undefined
          ? { description: seed.manifest.metadata.description }
          : {}),
      };
      state.agents[seed.agentId] = {
        summary,
        versions: { [versionId]: seed.bundle },
      };
      for (const trace of defaultTraceFixtures(seed.agentId, versionId)) {
        state.traces[trace.id] = trace;
      }
      return { workspaceId: seed.workspaceId, agentId: seed.agentId, versionId, etag };
    });
  }

  /** Test/simulation helper: advances the remote version to create drift. */
  async advanceVersion(agentId: string, mutate?: (bundle: unknown) => unknown): Promise<string> {
    const now = this.#now();
    return this.#store.update((state) => {
      const agent = state.agents[agentId];
      if (agent === undefined) {
        throw new ProviderError(`Unknown agent "${agentId}".`, "NOT_FOUND");
      }
      const current = agent.versions[agent.summary.currentVersionId];
      const nextNumber = Object.keys(agent.versions).length + 1;
      const versionId = `v${nextNumber}`;
      const nextBundle = mutate
        ? (mutate(structuredClone(current)) as (typeof agent.versions)[string])
        : structuredClone(current)!;
      agent.versions[versionId] = nextBundle;
      agent.summary.currentVersionId = versionId;
      agent.summary.etag = `W/"${agentId}-${versionId}"`;
      agent.summary.updatedAt = now;
      return versionId;
    });
  }

  async getIdentity(context: OperationContext): Promise<Identity> {
    this.#checkAvailable(context);
    const state = await this.#store.read();
    return {
      principalId: "mock-user",
      principalType: "user",
      scopes: [...this.#scopes],
      workspaceIds: state.workspaces.map((workspace) => workspace.id),
    };
  }

  async listWorkspaces(context: OperationContext, page?: PageRequest): Promise<Page<Workspace>> {
    this.#checkAvailable(context);
    const state = await this.#store.read();
    return paginate(state.workspaces, page);
  }

  async listAgents(
    context: OperationContext,
    workspaceId: string,
    page?: PageRequest,
  ): Promise<Page<AgentSummary>> {
    this.#checkAvailable(context);
    const state = await this.#store.read();
    if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
      throw new ProviderError(
        `Unknown workspace "${workspaceId}".`,
        "NOT_FOUND",
        context.requestId,
      );
    }
    const agents = Object.values(state.agents)
      .map((agent) => agent.summary)
      .filter((summary) => summary.workspaceId === workspaceId)
      .sort((a, b) => a.id.localeCompare(b.id));
    return paginate(agents, page);
  }

  async exportAgent(
    context: OperationContext,
    agentId: string,
    versionId?: string,
  ): Promise<AgentExport> {
    this.#checkAvailable(context);
    const state = await this.#store.read();
    const agent = state.agents[agentId];
    if (agent === undefined) {
      throw new ProviderError(`Unknown agent "${agentId}".`, "NOT_FOUND", context.requestId);
    }
    const resolvedVersionId = versionId ?? agent.summary.currentVersionId;
    const bundle = agent.versions[resolvedVersionId];
    if (bundle === undefined) {
      throw new ProviderError(
        `Unknown version "${resolvedVersionId}" for agent "${agentId}".`,
        "NOT_FOUND",
        context.requestId,
      );
    }
    const etag =
      resolvedVersionId === agent.summary.currentVersionId
        ? agent.summary.etag
        : `W/"${agentId}-${resolvedVersionId}"`;
    return {
      workspaceId: agent.summary.workspaceId,
      agentId,
      versionId: resolvedVersionId,
      etag,
      bundle: structuredClone(bundle),
    };
  }

  #requireScope(context: OperationContext, scope: string): void {
    if (!this.#scopes.includes(scope)) {
      throw new ProviderError(
        `The credential lacks the "${scope}" scope required for this operation.`,
        "PERMISSION_DENIED",
        context.requestId,
      );
    }
  }

  #checkStaleBase(context: MutationContext, summary: AgentSummary): void {
    if (context.baseVersionId !== undefined && context.baseVersionId !== summary.currentVersionId) {
      throw new ProviderError(
        `Stale base version: expected "${context.baseVersionId}" but the remote is at "${summary.currentVersionId}".`,
        "STALE_BASE",
        context.requestId,
        false,
        {
          expectedVersionId: context.baseVersionId,
          currentVersionId: summary.currentVersionId,
        },
      );
    }
    if (context.expectedEtag !== undefined && context.expectedEtag !== summary.etag) {
      throw new ProviderError(
        "ETag precondition failed: the remote agent changed.",
        "STALE_BASE",
        context.requestId,
      );
    }
  }

  /**
   * Idempotency envelope (build spec section 17): replaying a key with an
   * identical canonical request returns the original response; a different
   * request with the same key fails with IDEMPOTENCY_MISMATCH.
   */
  async #idempotent<T>(
    context: MutationContext,
    operation: string,
    request: unknown,
    execute: (state: MockState) => T,
  ): Promise<T> {
    const requestSha256 = hashCanonical({ operation, request });
    return this.#store.update((state) => {
      const existing = state.idempotency[context.idempotencyKey];
      if (existing !== undefined) {
        if (existing.requestSha256 === requestSha256 && existing.operation === operation) {
          return structuredClone(existing.response) as T;
        }
        throw new ProviderError(
          "Idempotency key was already used with a different request.",
          "IDEMPOTENCY_MISMATCH",
          context.requestId,
        );
      }
      const response = execute(state);
      state.idempotency[context.idempotencyKey] = {
        operation,
        requestSha256,
        response: structuredClone(response),
      };
      return response;
    });
  }

  #nextId(state: MockState, prefix: string): string {
    const next = (state.counters[prefix] ?? 0) + 1;
    state.counters[prefix] = next;
    return `${prefix}_${next}`;
  }

  async createChangePlan(
    context: OperationContext,
    _input: {
      agentId: string;
      baseVersionId: string;
      manifestSha256: Sha256;
      bundle: unknown;
    },
  ): Promise<ChangePlan> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "createChangePlan is not part of the local-first MVP surface; the semantic plan is computed by the deterministic core.",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async createDraft(
    context: MutationContext,
    input: {
      agentId: string;
      manifestSha256: Sha256;
      bundle: unknown;
      clientMetadata?: Record<string, unknown>;
    },
  ): Promise<Draft> {
    this.#checkAvailable(context);
    this.#requireScope(context, "agent:draft");
    const now = this.#now();
    return this.#idempotent(
      context,
      "createDraft",
      { agentId: input.agentId, manifestSha256: input.manifestSha256 },
      (state) => {
        const agent = state.agents[input.agentId];
        if (agent === undefined) {
          throw new ProviderError(
            `Unknown agent "${input.agentId}".`,
            "NOT_FOUND",
            context.requestId,
          );
        }
        this.#checkStaleBase(context, agent.summary);
        const id = this.#nextId(state, "draft");
        const draft: Draft = {
          id,
          agentId: input.agentId,
          baseVersionId: context.baseVersionId ?? agent.summary.currentVersionId,
          manifestSha256: input.manifestSha256,
          state: "DRAFT",
          createdAt: now,
          etag: `W/"${id}"`,
        };
        state.drafts[id] = draft;
        return structuredClone(draft);
      },
    );
  }

  async createEvaluationRun(
    context: MutationContext,
    _input: unknown & object,
  ): Promise<EvaluationRun> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "Remote evaluation runs are not part of the local-first MVP surface: evaluations execute " +
        "in the local eval-engine (fixture mode, or live mode via the pinned conversation runtime).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async getEvaluationRun(context: OperationContext, _runId: string): Promise<EvaluationRun> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "Remote evaluation runs are not part of the local-first MVP surface; evaluation evidence " +
        "lives in the local reports written by `raia test`.",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async createReleaseCandidate(
    context: MutationContext,
    input: {
      agentId: string;
      draftId?: string;
      candidateSha256: Sha256;
      manifestSha256: Sha256;
      lockSha256: Sha256;
      gitCommit?: string;
      evidence: Array<{ type: string; id: string; sha256: Sha256 }>;
    },
  ): Promise<ReleaseCandidate> {
    this.#checkAvailable(context);
    this.#requireScope(context, "release:create");
    if (input.evidence.length === 0) {
      throw new ProviderError(
        "A release candidate requires at least one evidence reference.",
        "POLICY_FAILED",
        context.requestId,
      );
    }
    const now = this.#now();
    return this.#idempotent(
      context,
      "createReleaseCandidate",
      {
        agentId: input.agentId,
        candidateSha256: input.candidateSha256,
        manifestSha256: input.manifestSha256,
        lockSha256: input.lockSha256,
        evidence: input.evidence,
      },
      (state) => {
        const agent = state.agents[input.agentId];
        if (agent === undefined) {
          throw new ProviderError(
            `Unknown agent "${input.agentId}".`,
            "NOT_FOUND",
            context.requestId,
          );
        }
        this.#checkStaleBase(context, agent.summary);
        const id = this.#nextId(state, "rc");
        const release: ReleaseCandidate = {
          id,
          agentId: input.agentId,
          baseVersionId: context.baseVersionId ?? agent.summary.currentVersionId,
          candidateSha256: input.candidateSha256,
          manifestSha256: input.manifestSha256,
          state: "RELEASED",
          createdAt: now,
        };
        // Release candidates are immutable: stored once, never updated. No
        // mutation API exists; a reused idempotency key with altered hashes
        // fails above with IDEMPOTENCY_MISMATCH.
        state.releases[id] = release;
        return structuredClone(release);
      },
    );
  }

  async createDeployment(
    context: MutationContext,
    input: {
      releaseCandidateId: string;
      environment: "development" | "staging" | "production";
      reason?: string;
    },
  ): Promise<Deployment> {
    this.#checkAvailable(context);
    this.#requireScope(context, "deployment:promote");
    if (input.environment === "production") {
      throw new ProviderError(
        "Production promotion is reserved for the raia management UI; server policy allows development and staging only.",
        "PERMISSION_DENIED",
        context.requestId,
      );
    }
    const now = this.#now();
    return this.#idempotent(
      context,
      "createDeployment",
      { releaseCandidateId: input.releaseCandidateId, environment: input.environment },
      (state) => {
        const release = state.releases[input.releaseCandidateId];
        if (release === undefined) {
          throw new ProviderError(
            `Unknown release candidate "${input.releaseCandidateId}".`,
            "NOT_FOUND",
            context.requestId,
          );
        }
        if (release.state !== "RELEASED") {
          throw new ProviderError(
            "Only an immutable RELEASED candidate can be deployed.",
            "INVALID_TRANSITION",
            context.requestId,
          );
        }
        const rollbackTarget = Object.values(state.deployments)
          .map((stored) => stored.deployment)
          .filter((d) => d.environment === input.environment && d.state === "HEALTHY")
          .sort((a, b) => a.id.localeCompare(b.id))
          .at(-1);
        const id = this.#nextId(state, "dep");
        const deployment: Deployment = {
          id,
          releaseCandidateId: input.releaseCandidateId,
          environment: input.environment,
          state: "QUEUED",
          ...(rollbackTarget !== undefined ? { rollbackTargetId: rollbackTarget.id } : {}),
          createdAt: now,
          updatedAt: now,
        };
        state.deployments[id] = {
          deployment,
          plan:
            this.#deploymentOutcome === "failed"
              ? ["DEPLOYING", "FAILED"]
              : ["DEPLOYING", "HEALTHY"],
          planIndex: 0,
        };
        return structuredClone(deployment);
      },
    );
  }

  async getDeployment(context: OperationContext, deploymentId: string): Promise<Deployment> {
    this.#checkAvailable(context);
    this.#requireScope(context, "deployment:read");
    const now = this.#now();
    return this.#store.update((state) => {
      const stored = state.deployments[deploymentId];
      if (stored === undefined) {
        throw new ProviderError(
          `Unknown deployment "${deploymentId}".`,
          "NOT_FOUND",
          context.requestId,
        );
      }
      // Deterministic asynchronous completion: each poll advances one step.
      if (stored.planIndex < stored.plan.length) {
        const next = stored.plan[stored.planIndex]!;
        const decision = decideDeploymentTransition(stored.deployment.state, next);
        if (decision.ok) {
          stored.deployment.state = next;
          stored.deployment.updatedAt = now;
          stored.planIndex += 1;
          if (next === "HEALTHY") {
            for (const other of Object.values(state.deployments)) {
              if (
                other.deployment.id !== deploymentId &&
                other.deployment.environment === stored.deployment.environment &&
                other.deployment.state === "HEALTHY"
              ) {
                other.deployment.state = "SUPERSEDED";
                other.deployment.updatedAt = now;
              }
            }
          }
        }
      }
      return structuredClone(stored.deployment);
    });
  }

  async rollbackDeployment(
    context: MutationContext,
    deploymentId: string,
    reason: string,
  ): Promise<Deployment> {
    this.#checkAvailable(context);
    this.#requireScope(context, "deployment:rollback");
    if (reason.trim().length === 0) {
      throw new ProviderError(
        "A rollback requires an explicit reason.",
        "VALIDATION_FAILED",
        context.requestId,
      );
    }
    const now = this.#now();
    return this.#idempotent(context, "rollbackDeployment", { deploymentId, reason }, (state) => {
      const stored = state.deployments[deploymentId];
      if (stored === undefined) {
        throw new ProviderError(
          `Unknown deployment "${deploymentId}".`,
          "NOT_FOUND",
          context.requestId,
        );
      }
      const decision = decideDeploymentTransition(stored.deployment.state, "ROLLING_BACK");
      if (!decision.ok) {
        throw new ProviderError(decision.message, "INVALID_TRANSITION", context.requestId);
      }
      stored.deployment.state = "ROLLING_BACK";
      stored.deployment.updatedAt = now;
      stored.plan = ["ROLLED_BACK"];
      stored.planIndex = 0;
      return structuredClone(stored.deployment);
    });
  }

  async listTraces(
    context: OperationContext,
    input: {
      agentId: string;
      versionId?: string;
      outcome?: TraceSummary["outcome"];
      page?: PageRequest;
    },
  ): Promise<Page<TraceSummary>> {
    this.#checkAvailable(context);
    this.#requireScope(context, "trace:read");
    const state = await this.#store.read();
    if (state.agents[input.agentId] === undefined) {
      throw new ProviderError(`Unknown agent "${input.agentId}".`, "NOT_FOUND", context.requestId);
    }
    const summaries = Object.values(state.traces)
      .filter(
        (trace) =>
          trace.agentId === input.agentId &&
          (input.versionId === undefined || trace.versionId === input.versionId) &&
          (input.outcome === undefined || trace.outcome === input.outcome),
      )
      .map(({ id, agentId, versionId, startedAt, outcome, tags }) => ({
        id,
        agentId,
        versionId,
        startedAt,
        outcome,
        tags: [...tags],
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return paginate(summaries, input.page);
  }

  /**
   * Server-side trace redaction and size capping (build spec section 17):
   * secret-like content is redacted before return, events are truncated to the
   * byte budget, and applied redaction rules are recorded.
   */
  async getTrace(context: OperationContext, traceId: string, maxBytes: number): Promise<Trace> {
    this.#checkAvailable(context);
    this.#requireScope(context, "trace:read");
    const state = await this.#store.read();
    const stored = state.traces[traceId];
    if (stored === undefined) {
      throw new ProviderError(`Unknown trace "${traceId}".`, "NOT_FOUND", context.requestId);
    }
    const budget = Math.min(Math.max(maxBytes, 1024), 1024 * 1024);

    const rawSerialized = JSON.stringify(stored.events);
    const redactionRules = [
      ...new Set(scanForSecrets(rawSerialized, traceId).map((finding) => finding.ruleId)),
    ].sort();

    const redactedEvents = stored.events.map(
      (event) => redactValue(event) as Record<string, unknown>,
    );
    const events: Array<Record<string, unknown>> = [];
    let used = 2; // brackets
    let truncated = false;
    for (const event of redactedEvents) {
      const size = Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
      if (used + size > budget) {
        truncated = true;
        break;
      }
      events.push(event);
      used += size;
    }

    return {
      id: stored.id,
      agentId: stored.agentId,
      versionId: stored.versionId,
      startedAt: stored.startedAt,
      outcome: stored.outcome,
      tags: [...stored.tags],
      events,
      redactions: redactionRules,
      truncated,
    };
  }
}
