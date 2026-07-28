/**
 * HttpManagementProvider (build spec sections 16 and 18): ManagementProvider
 * client for the proposed `/agent-devkit/v1` contract in
 * `contracts/raia-management.openapi.yaml`. The contract is proposed, not a
 * live raia API; the client is exercised against the conforming local server
 * in `apps/mock-management-api`. Requests carry X-Request-Id, mutations carry
 * Idempotency-Key (and If-Match where the contract requires it), failures map
 * problem+json to typed ProviderErrors, and retries are bounded and jittered.
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
  Trace,
  TraceSummary,
  Workspace,
} from "@raia/contracts";
import { assertManagementCredential, type ManagementCredential } from "./credentials.js";
import { providerErrorFromResponse } from "./problems.js";
import { withRetry, type RetryOptions } from "./retry.js";
import { fetchTransport, type HttpTransport } from "./transport.js";

/**
 * The two proposed regional endpoints from the pinned management contract.
 * Any other target requires an explicit baseUrl (e.g. the conforming local
 * test server); the client never derives a URL from anything else.
 */
const REGION_BASE_URLS: Record<"us" | "eu", string> = {
  us: "https://api.raia2.com/agent-devkit/v1",
  eu: "https://api-eu.raia2.com/agent-devkit/v1",
};

export interface HttpProviderLogEntry {
  method: string;
  path: string;
  status: number | "error";
  requestId: string;
  attempt: number;
}

export interface HttpManagementProviderOptions {
  credential: ManagementCredential;
  region?: "us" | "eu";
  /** Explicit override (conforming local server, self-hosted gateway). */
  baseUrl?: string;
  transport?: HttpTransport;
  /** Per-request timeout; the contract default is 30 seconds. */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Redacted request log: method, path, status, request id — never headers or bodies. */
  logger?: (entry: HttpProviderLogEntry) => void;
}

interface RequestSpec {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
}

/** The wire contract uses explicit nulls for optional fields; the provider contract uses absence. */
function stripNulls<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null) {
      result[key] = entry;
    }
  }
  return result as T;
}

function pageQuery(page: PageRequest | undefined): Record<string, string | undefined> {
  return {
    cursor: page?.cursor,
    limit: page?.limit !== undefined ? String(page.limit) : undefined,
  };
}

function requireIdempotencyKey(context: MutationContext): string {
  if (context.idempotencyKey.length < 16 || context.idempotencyKey.length > 200) {
    throw new ProviderError(
      "Idempotency-Key must be 16-200 characters (management contract requirement).",
      "VALIDATION_FAILED",
      context.requestId,
    );
  }
  return context.idempotencyKey;
}

export class HttpManagementProvider implements ManagementProvider {
  readonly #credential: ManagementCredential;
  readonly #baseUrl: string;
  readonly #transport: HttpTransport;
  readonly #timeoutMs: number;
  readonly #retry: RetryOptions;
  readonly #logger: ((entry: HttpProviderLogEntry) => void) | undefined;

  constructor(options: HttpManagementProviderOptions) {
    assertManagementCredential(options.credential);
    this.#credential = options.credential;
    const baseUrl = options.baseUrl ?? REGION_BASE_URLS[options.region ?? "us"];
    if (!/^https?:\/\//.test(baseUrl)) {
      throw new ProviderError(
        "The management base URL must be an explicit http(s) endpoint.",
        "VALIDATION_FAILED",
      );
    }
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#transport = options.transport ?? fetchTransport;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#retry = options.retry ?? {};
    this.#logger = options.logger;
  }

  async #request<T>(context: OperationContext, spec: RequestSpec): Promise<T> {
    const url = new URL(this.#baseUrl + spec.path);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#credential.bearerToken}`,
      accept: "application/json",
      "x-request-id": context.requestId,
      ...spec.headers,
    };
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(spec.body);
    }

    return withRetry(async (attempt) => {
      let response;
      try {
        response = await this.#transport({
          method: spec.method,
          url: url.toString(),
          headers,
          ...(body !== undefined ? { body } : {}),
          timeoutMs: this.#timeoutMs,
          ...(context.signal !== undefined ? { signal: context.signal } : {}),
        });
      } catch (error) {
        this.#logger?.({
          method: spec.method,
          path: spec.path,
          status: "error",
          requestId: context.requestId,
          attempt,
        });
        throw error;
      }
      this.#logger?.({
        method: spec.method,
        path: spec.path,
        status: response.status,
        requestId: context.requestId,
        attempt,
      });
      if (response.status >= 400) {
        throw providerErrorFromResponse(response.status, response.body, response.headers);
      }
      if (response.body.length === 0) {
        return undefined as T;
      }
      try {
        return JSON.parse(response.body) as T;
      } catch {
        throw new ProviderError(
          "The server returned a malformed JSON response.",
          "INTERNAL",
          response.headers["x-request-id"] ?? context.requestId,
        );
      }
    }, this.#retry);
  }

  async #page<T extends object>(
    context: OperationContext,
    path: string,
    page: PageRequest | undefined,
    extraQuery?: Record<string, string | undefined>,
  ): Promise<Page<T>> {
    const raw = await this.#request<{ items: T[]; nextCursor?: string | null }>(context, {
      method: "GET",
      path,
      query: { ...pageQuery(page), ...extraQuery },
    });
    const result: Page<T> = { items: raw.items.map((item) => stripNulls(item)) };
    if (raw.nextCursor !== undefined && raw.nextCursor !== null) {
      result.nextCursor = raw.nextCursor;
    }
    return result;
  }

  async getIdentity(context: OperationContext): Promise<Identity> {
    const identity = await this.#request<Identity>(context, { method: "GET", path: "/me" });
    // workspaceIds is optional on the wire but required by the contract type.
    return stripNulls({ ...identity, workspaceIds: identity.workspaceIds ?? [] });
  }

  listWorkspaces(context: OperationContext, page?: PageRequest): Promise<Page<Workspace>> {
    return this.#page<Workspace>(context, "/workspaces", page);
  }

  listAgents(
    context: OperationContext,
    workspaceId: string,
    page?: PageRequest,
  ): Promise<Page<AgentSummary>> {
    return this.#page<AgentSummary>(
      context,
      `/workspaces/${encodeURIComponent(workspaceId)}/agents`,
      page,
    );
  }

  async exportAgent(
    context: OperationContext,
    agentId: string,
    versionId?: string,
  ): Promise<AgentExport> {
    return this.#request<AgentExport>(context, {
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/export`,
      query: { versionId },
    });
  }

  async createChangePlan(
    context: OperationContext,
    input: Parameters<ManagementProvider["createChangePlan"]>[1],
  ): Promise<ChangePlan> {
    const { agentId, ...body } = input;
    return this.#request<ChangePlan>(context, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/change-plans`,
      body,
    });
  }

  async createDraft(
    context: MutationContext,
    input: Parameters<ManagementProvider["createDraft"]>[1],
  ): Promise<Draft> {
    if (context.expectedEtag === undefined || context.baseVersionId === undefined) {
      throw new ProviderError(
        "createDraft requires an explicit base version and If-Match ETag (management contract requirement).",
        "VALIDATION_FAILED",
        context.requestId,
      );
    }
    const { agentId, ...rest } = input;
    return this.#request<Draft>(context, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/drafts`,
      headers: {
        "idempotency-key": requireIdempotencyKey(context),
        "if-match": context.expectedEtag,
      },
      body: { baseVersionId: context.baseVersionId, ...rest },
    });
  }

  async createEvaluationRun(
    context: MutationContext,
    input: Parameters<ManagementProvider["createEvaluationRun"]>[1],
  ): Promise<EvaluationRun> {
    const run = await this.#request<EvaluationRun>(context, {
      method: "POST",
      path: "/evaluation-runs",
      headers: { "idempotency-key": requireIdempotencyKey(context) },
      body: input,
    });
    return stripNulls(run);
  }

  async getEvaluationRun(context: OperationContext, runId: string): Promise<EvaluationRun> {
    const run = await this.#request<EvaluationRun>(context, {
      method: "GET",
      path: `/evaluation-runs/${encodeURIComponent(runId)}`,
    });
    return stripNulls(run);
  }

  async createReleaseCandidate(
    context: MutationContext,
    input: Parameters<ManagementProvider["createReleaseCandidate"]>[1],
  ): Promise<ReleaseCandidate> {
    if (context.baseVersionId === undefined) {
      throw new ProviderError(
        "createReleaseCandidate requires an explicit base version (management contract requirement).",
        "VALIDATION_FAILED",
        context.requestId,
      );
    }
    return this.#request<ReleaseCandidate>(context, {
      method: "POST",
      path: "/release-candidates",
      headers: { "idempotency-key": requireIdempotencyKey(context) },
      body: { baseVersionId: context.baseVersionId, ...input },
    });
  }

  async createDeployment(
    context: MutationContext,
    input: Parameters<ManagementProvider["createDeployment"]>[1],
  ): Promise<Deployment> {
    const deployment = await this.#request<Deployment>(context, {
      method: "POST",
      path: "/deployments",
      headers: { "idempotency-key": requireIdempotencyKey(context) },
      body: input,
    });
    return stripNulls(deployment);
  }

  async getDeployment(context: OperationContext, deploymentId: string): Promise<Deployment> {
    const deployment = await this.#request<Deployment>(context, {
      method: "GET",
      path: `/deployments/${encodeURIComponent(deploymentId)}`,
    });
    return stripNulls(deployment);
  }

  async rollbackDeployment(
    context: MutationContext,
    deploymentId: string,
    reason: string,
  ): Promise<Deployment> {
    const deployment = await this.#request<Deployment>(context, {
      method: "POST",
      path: `/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      headers: { "idempotency-key": requireIdempotencyKey(context) },
      body: { reason },
    });
    return stripNulls(deployment);
  }

  listTraces(
    context: OperationContext,
    input: Parameters<ManagementProvider["listTraces"]>[1],
  ): Promise<Page<TraceSummary>> {
    return this.#page<TraceSummary>(
      context,
      `/agents/${encodeURIComponent(input.agentId)}/traces`,
      input.page,
      { versionId: input.versionId, outcome: input.outcome },
    );
  }

  async getTrace(context: OperationContext, traceId: string, _maxBytes: number): Promise<Trace> {
    // The wire contract caps trace size server-side; the maxBytes argument is
    // advisory for HTTP (the server enforces its own cap).
    return this.#request<Trace>(context, {
      method: "GET",
      path: `/traces/${encodeURIComponent(traceId)}`,
    });
  }
}
