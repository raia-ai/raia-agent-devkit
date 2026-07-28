/**
 * Conforming local HTTP server for `contracts/raia-management.openapi.yaml`
 * (build spec section 18). It exposes the MockManagementProvider over the
 * exact wire contract — paths, Idempotency-Key / If-Match headers, problem+json
 * failures, Retry-After, ETag, and X-Request-Id — so the HTTP client can be
 * contract-tested without any live raia endpoint.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ProviderError, type ProviderErrorCode } from "@raia/contracts";
import type {
  ManagementProvider,
  MutationContext,
  OperationContext,
  PageRequest,
} from "@raia/contracts";

export interface MockManagementServerOptions {
  provider: ManagementProvider;
  /**
   * Bearer tokens accepted as authenticated principals. When omitted, any
   * non-empty bearer token authenticates (scope checks stay in the provider).
   */
  acceptedTokens?: string[];
  /** Injectable request-id factory (deterministic in tests). */
  requestId?: () => string;
}

const CODE_TO_STATUS: Record<ProviderErrorCode, number> = {
  AUTHENTICATION_REQUIRED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  STALE_BASE: 409,
  IDEMPOTENCY_MISMATCH: 409,
  INVALID_TRANSITION: 409,
  VALIDATION_FAILED: 422,
  POLICY_FAILED: 422,
  EVALUATION_GATE_FAILED: 422,
  UNAVAILABLE: 503,
  TIMEOUT: 504,
  INTERNAL: 500,
};

const MAX_BODY_BYTES = 12 * 1024 * 1024;

function sendProblem(
  response: ServerResponse,
  requestId: string,
  status: number,
  code: string,
  title: string,
  detail?: string,
): void {
  const problem = {
    type: `https://docs.raia.ai/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    requestId,
    code,
    ...(detail !== undefined ? { detail } : {}),
  };
  const headers: Record<string, string> = {
    "content-type": "application/problem+json",
    "x-request-id": requestId,
  };
  if (status === 429 || status === 503) {
    headers["retry-after"] = "1";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(problem));
}

function sendJson(
  response: ServerResponse,
  requestId: string,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "x-request-id": requestId,
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new ProviderError("Request body exceeds the size limit.", "VALIDATION_FAILED"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function pageRequest(url: URL): PageRequest {
  const page: PageRequest = {};
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null) {
    page.cursor = cursor;
  }
  const limitRaw = url.searchParams.get("limit");
  if (limitRaw !== null) {
    const limit = Number.parseInt(limitRaw, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ProviderError("limit must be an integer between 1 and 200.", "VALIDATION_FAILED");
    }
    page.limit = limit;
  }
  return page;
}

function mutationContext(request: IncomingMessage, requestId: string): MutationContext {
  const idempotencyKey = headerValue(request, "idempotency-key");
  if (idempotencyKey === undefined || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    throw new ProviderError(
      "Idempotency-Key header is required and must be 16-200 characters.",
      "VALIDATION_FAILED",
      requestId,
    );
  }
  return { requestId, idempotencyKey };
}

/** Creates (but does not start) the conforming management API server. */
export function createMockManagementServer(options: MockManagementServerOptions): Server {
  const provider = options.provider;
  let requestCounter = 0;
  const nextRequestId = options.requestId ?? (() => `req_srv_${(requestCounter += 1)}`);

  return createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) {
        sendProblem(response, nextRequestId(), 500, "INTERNAL", "Internal server error");
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = nextRequestId();
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

    const authorization = headerValue(request, "authorization") ?? "";
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (
      bearer.length === 0 ||
      (options.acceptedTokens && !options.acceptedTokens.includes(bearer))
    ) {
      sendProblem(
        response,
        requestId,
        401,
        "AUTHENTICATION_REQUIRED",
        "Authentication missing or invalid",
      );
      return;
    }

    const context: OperationContext = { requestId };
    try {
      const bodyText = method === "GET" ? "" : await readBody(request);
      const body: unknown = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
      await route(request, response, requestId, url, method, segments, context, body);
    } catch (error) {
      if (error instanceof ProviderError) {
        sendProblem(response, requestId, CODE_TO_STATUS[error.code], error.code, error.message);
        return;
      }
      if (error instanceof SyntaxError) {
        sendProblem(
          response,
          requestId,
          422,
          "VALIDATION_FAILED",
          "Request body is not valid JSON",
        );
        return;
      }
      sendProblem(response, requestId, 500, "INTERNAL", "Internal server error");
    }
  }

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
    requestId: string,
    url: URL,
    method: string,
    segments: string[],
    context: OperationContext,
    body: unknown,
  ): Promise<void> {
    // GET /me
    if (method === "GET" && segments.length === 1 && segments[0] === "me") {
      sendJson(response, requestId, 200, await provider.getIdentity(context));
      return;
    }
    // GET /workspaces
    if (method === "GET" && segments.length === 1 && segments[0] === "workspaces") {
      const page = await provider.listWorkspaces(context, pageRequest(url));
      sendJson(response, requestId, 200, {
        items: page.items,
        nextCursor: page.nextCursor ?? null,
      });
      return;
    }
    // GET /workspaces/{workspaceId}/agents
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "workspaces" &&
      segments[2] === "agents"
    ) {
      const page = await provider.listAgents(context, segments[1]!, pageRequest(url));
      sendJson(response, requestId, 200, {
        items: page.items,
        nextCursor: page.nextCursor ?? null,
      });
      return;
    }
    // GET /agents/{agentId}/export
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "agents" &&
      segments[2] === "export"
    ) {
      const versionId = url.searchParams.get("versionId") ?? undefined;
      const exported = await provider.exportAgent(context, segments[1]!, versionId);
      sendJson(response, requestId, 200, exported, { etag: exported.etag });
      return;
    }
    // POST /agents/{agentId}/change-plans
    if (
      method === "POST" &&
      segments.length === 3 &&
      segments[0] === "agents" &&
      segments[2] === "change-plans"
    ) {
      const input = body as {
        baseVersionId: string;
        manifestSha256: `sha256:${string}`;
        bundle: never;
      };
      const plan = await provider.createChangePlan(context, {
        agentId: segments[1]!,
        baseVersionId: input.baseVersionId,
        manifestSha256: input.manifestSha256,
        bundle: input.bundle,
      });
      sendJson(response, requestId, 200, plan);
      return;
    }
    // POST /agents/{agentId}/drafts
    if (
      method === "POST" &&
      segments.length === 3 &&
      segments[0] === "agents" &&
      segments[2] === "drafts"
    ) {
      const mutation = mutationContext(request, requestId);
      const ifMatch = headerValue(request, "if-match");
      if (ifMatch === undefined) {
        throw new ProviderError("If-Match header is required.", "VALIDATION_FAILED", requestId);
      }
      const input = body as {
        baseVersionId: string;
        manifestSha256: `sha256:${string}`;
        bundle: never;
        clientMetadata?: Record<string, unknown>;
      };
      mutation.baseVersionId = input.baseVersionId;
      mutation.expectedEtag = ifMatch;
      const draft = await provider.createDraft(mutation, {
        agentId: segments[1]!,
        manifestSha256: input.manifestSha256,
        bundle: input.bundle,
        ...(input.clientMetadata !== undefined ? { clientMetadata: input.clientMetadata } : {}),
      });
      sendJson(response, requestId, 201, draft, { etag: draft.etag });
      return;
    }
    // POST /evaluation-runs
    if (method === "POST" && segments.length === 1 && segments[0] === "evaluation-runs") {
      const mutation = mutationContext(request, requestId);
      const run = await provider.createEvaluationRun(
        mutation,
        body as Parameters<ManagementProvider["createEvaluationRun"]>[1],
      );
      sendJson(response, requestId, 202, run);
      return;
    }
    // GET /evaluation-runs/{runId}
    if (method === "GET" && segments.length === 2 && segments[0] === "evaluation-runs") {
      sendJson(response, requestId, 200, await provider.getEvaluationRun(context, segments[1]!));
      return;
    }
    // POST /release-candidates
    if (method === "POST" && segments.length === 1 && segments[0] === "release-candidates") {
      const mutation = mutationContext(request, requestId);
      const input = body as Parameters<ManagementProvider["createReleaseCandidate"]>[1] & {
        baseVersionId: string;
      };
      mutation.baseVersionId = input.baseVersionId;
      const candidate = await provider.createReleaseCandidate(mutation, input);
      sendJson(response, requestId, 201, candidate);
      return;
    }
    // POST /deployments
    if (method === "POST" && segments.length === 1 && segments[0] === "deployments") {
      const mutation = mutationContext(request, requestId);
      const deployment = await provider.createDeployment(
        mutation,
        body as Parameters<ManagementProvider["createDeployment"]>[1],
      );
      sendJson(response, requestId, 202, deployment);
      return;
    }
    // GET /deployments/{deploymentId}
    if (method === "GET" && segments.length === 2 && segments[0] === "deployments") {
      sendJson(response, requestId, 200, await provider.getDeployment(context, segments[1]!));
      return;
    }
    // POST /deployments/{deploymentId}/rollback
    if (
      method === "POST" &&
      segments.length === 3 &&
      segments[0] === "deployments" &&
      segments[2] === "rollback"
    ) {
      const mutation = mutationContext(request, requestId);
      const input = body as { reason?: string };
      if (typeof input?.reason !== "string" || input.reason.length === 0) {
        throw new ProviderError("A rollback reason is required.", "VALIDATION_FAILED", requestId);
      }
      const deployment = await provider.rollbackDeployment(mutation, segments[1]!, input.reason);
      sendJson(response, requestId, 202, deployment);
      return;
    }
    // GET /agents/{agentId}/traces
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "agents" &&
      segments[2] === "traces"
    ) {
      const outcome = url.searchParams.get("outcome");
      const versionId = url.searchParams.get("versionId");
      const page = await provider.listTraces(context, {
        agentId: segments[1]!,
        ...(versionId !== null ? { versionId } : {}),
        ...(outcome !== null ? { outcome: outcome as "success" } : {}),
        page: pageRequest(url),
      });
      sendJson(response, requestId, 200, {
        items: page.items,
        nextCursor: page.nextCursor ?? null,
      });
      return;
    }
    // GET /traces/{traceId}
    if (method === "GET" && segments.length === 2 && segments[0] === "traces") {
      // The wire contract caps trace payloads server-side; 256 KiB mirrors the
      // MCP tool default budget.
      sendJson(response, requestId, 200, await provider.getTrace(context, segments[1]!, 262144));
      return;
    }

    sendProblem(response, requestId, 404, "NOT_FOUND", "Unknown operation");
  }
}

/** Starts the server on 127.0.0.1 and resolves with its base URL. */
export function startMockManagementServer(
  server: Server,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port."));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => (error ? rejectClose(error) : resolveClose()));
          }),
      });
    });
  });
}
