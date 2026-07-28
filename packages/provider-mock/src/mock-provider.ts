/**
 * Filesystem-backed mock ManagementProvider (build spec section 17).
 * WP2 scope: identity, discovery, export, versioning, ETags, pagination, and
 * typed errors. Lifecycle mutations (drafts, evaluations, releases,
 * deployments, traces) arrive in WP3/WP4 and currently fail closed with a
 * typed UNAVAILABLE error rather than pretending to succeed.
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
import { StateStore } from "./state.js";
import { buildBundleFromFixture } from "./seed.js";

export interface MockProviderOptions {
  /** Directory that holds the mock's atomic JSON state. */
  stateDir: string;
  /** Injectable clock (ISO timestamp factory). */
  now?: () => string;
  /** Scopes granted to the mock identity (permission fixtures). */
  scopes?: string[];
  /** Marks the provider as unreachable to simulate outages. */
  unavailable?: boolean;
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

  constructor(options: MockProviderOptions) {
    this.#store = new StateStore(options.stateDir);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#scopes = options.scopes ?? DEFAULT_SCOPES;
    this.#unavailable = options.unavailable ?? false;
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
      "createChangePlan is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async createDraft(context: MutationContext, _input: unknown & object): Promise<Draft> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "createDraft is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async createEvaluationRun(
    context: MutationContext,
    _input: unknown & object,
  ): Promise<EvaluationRun> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "createEvaluationRun is implemented in a later work package (WP3).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async getEvaluationRun(context: OperationContext, _runId: string): Promise<EvaluationRun> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "getEvaluationRun is implemented in a later work package (WP3).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async createReleaseCandidate(
    context: MutationContext,
    _input: unknown & object,
  ): Promise<ReleaseCandidate> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "createReleaseCandidate is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async createDeployment(context: MutationContext, _input: unknown & object): Promise<Deployment> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "createDeployment is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async getDeployment(context: OperationContext, _deploymentId: string): Promise<Deployment> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "getDeployment is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async rollbackDeployment(
    context: MutationContext,
    _deploymentId: string,
    _reason: string,
  ): Promise<Deployment> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "rollbackDeployment is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async listTraces(
    context: OperationContext,
    _input: { agentId: string; page?: PageRequest },
  ): Promise<Page<TraceSummary>> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "listTraces is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }

  async getTrace(context: OperationContext, _traceId: string, _maxBytes: number): Promise<Trace> {
    this.#checkAvailable(context);
    throw new ProviderError(
      "getTrace is implemented in a later work package (WP4).",
      "UNAVAILABLE",
      context.requestId,
    );
  }
}
