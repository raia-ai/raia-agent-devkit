/**
 * external-openapi-v1 conversation client (build spec section 16): implements
 * the normative ConversationProvider against the pinned, audited projection of
 * the published raia external OpenAPI document. Routes and the
 * Agent-Secret-Key header come from generated contract constants — nothing is
 * guessed. Operations the pinned contract cannot express fail closed with
 * CapabilityUnavailableError. No operation is retried automatically: message
 * sends may incur model cost and the vendor contract defines no idempotency.
 */
import { ProviderError, type ConversationProvider } from "@raia/contracts";
import { fetchTransport, type HttpTransport } from "@raia/provider-http";
import type { AgentSecretCredential } from "./credentials.js";
import { CapabilityUnavailableError } from "./errors.js";
import { CONTRACT_OPERATIONS, CONTRACT_SERVERS } from "./generated/contract-constants.js";

export const EXTERNAL_OPENAPI_V1 = "external-openapi-v1";

export interface ConversationClientOptions {
  credential: AgentSecretCredential;
  region?: "us" | "eu";
  /**
   * Explicit endpoint override for the conforming local test server. Anything
   * beyond the two pinned regional servers must be loopback: the client never
   * sends an Agent Secret Key to an arbitrary remote URL.
   */
  baseUrlOverride?: string;
  /** Default conversationUserId; the pinned contract requires one per conversation. */
  conversationUserId?: string;
  transport?: HttpTransport;
  timeoutMs?: number;
}

function assertLoopback(baseUrl: string): void {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new ProviderError("The base URL override is not a valid URL.", "VALIDATION_FAILED");
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]" && host !== "::1") {
    throw new ProviderError(
      "Base URL overrides are restricted to loopback test servers; regional endpoints come from the pinned contract.",
      "VALIDATION_FAILED",
    );
  }
}

function errorForStatus(status: number, requestId: string | undefined): ProviderError {
  // Vendor error DTO bodies are not echoed: they are outside the DevKit's
  // control and could contain conversation content.
  if (status === 401) {
    return new ProviderError(
      "The conversation runtime rejected the credential.",
      "AUTHENTICATION_REQUIRED",
      requestId,
    );
  }
  if (status === 403) {
    return new ProviderError(
      "Invalid or unauthorized Agent Secret Key for this conversation operation.",
      "AUTHENTICATION_REQUIRED",
      requestId,
    );
  }
  if (status === 404) {
    return new ProviderError("Conversation resource not found.", "NOT_FOUND", requestId);
  }
  if (status === 429) {
    return new ProviderError(
      "Conversation runtime rate limit reached.",
      "RATE_LIMITED",
      requestId,
      true,
    );
  }
  if (status === 400 || status === 422) {
    return new ProviderError(
      "The conversation request failed validation.",
      "VALIDATION_FAILED",
      requestId,
    );
  }
  return new ProviderError(
    `Conversation runtime error (HTTP ${status}).`,
    status >= 500 ? "UNAVAILABLE" : "INTERNAL",
    requestId,
    status >= 500,
  );
}

interface WireMessage {
  id: string;
  message: string;
  conversationId: string;
  senderRole: string;
  createdAt: string;
  [key: string]: unknown;
}

export class ExternalConversationClient implements ConversationProvider {
  readonly profile = EXTERNAL_OPENAPI_V1;
  readonly #credential: AgentSecretCredential;
  readonly #baseUrl: string;
  readonly #transport: HttpTransport;
  readonly #timeoutMs: number;
  readonly #conversationUserId: string | undefined;

  constructor(options: ConversationClientOptions) {
    if (
      options.credential?.kind !== "agent-secret-key" ||
      options.credential.secretKey.length === 0
    ) {
      throw new ProviderError(
        "The conversation runtime requires an Agent Secret Key credential (RAIA_AGENT_SECRET_KEY).",
        "AUTHENTICATION_REQUIRED",
      );
    }
    this.#credential = options.credential;
    if (options.baseUrlOverride !== undefined) {
      assertLoopback(options.baseUrlOverride);
      this.#baseUrl = options.baseUrlOverride.replace(/\/$/, "");
    } else {
      this.#baseUrl = CONTRACT_SERVERS[options.region ?? "us"];
    }
    this.#transport = options.transport ?? fetchTransport;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#conversationUserId = options.conversationUserId;
  }

  async #call<T>(
    operationId: keyof typeof CONTRACT_OPERATIONS,
    pathParams: Record<string, string>,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const operation = CONTRACT_OPERATIONS[operationId];
    let wirePath: string = operation.path;
    for (const [key, value] of Object.entries(pathParams)) {
      wirePath = wirePath.replace(`{${key}}`, encodeURIComponent(value));
    }
    const url = new URL(this.#baseUrl + wirePath);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      // The pinned contract's security scheme: an Agent-Secret-Key header,
      // NOT an Authorization: Bearer token.
      "agent-secret-key": this.#credential.secretKey,
      accept: "application/json",
    };
    let requestBody: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(body);
    }
    const response = await this.#transport({
      method: operation.method as "GET" | "POST",
      url: url.toString(),
      headers,
      ...(requestBody !== undefined ? { body: requestBody } : {}),
      timeoutMs: this.#timeoutMs,
    });
    if (response.status >= 400) {
      throw errorForStatus(response.status, response.headers["x-request-id"]);
    }
    if (response.body.length === 0) {
      return undefined as T;
    }
    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new ProviderError("The conversation runtime returned malformed JSON.", "INTERNAL");
    }
  }

  async createConversation(input?: {
    channel?: string;
    context?: string;
    user?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    if (input?.channel !== undefined) {
      throw new CapabilityUnavailableError(
        "Channel-scoped conversation creation (email/sms/voice start flows) is outside the DevKit's text evaluation scope.",
        this.profile,
      );
    }
    const conversationUserId =
      (typeof input?.user?.["id"] === "string" ? (input.user["id"] as string) : undefined) ??
      this.#conversationUserId;
    if (conversationUserId === undefined) {
      throw new ProviderError(
        "The pinned external contract requires a conversationUserId; provide user.id or configure conversationUserId.",
        "VALIDATION_FAILED",
      );
    }
    const conversation = await this.#call<{ id: string }>(
      "ExternalApiConversationsController_createConversation",
      {},
      {
        conversationUserId,
        ...(input?.context !== undefined ? { context: input.context } : {}),
      },
    );
    return { id: conversation.id };
  }

  deleteConversation(_conversationId: string): Promise<void> {
    // The pinned contract defines only "delete all conversations for a user";
    // a single-conversation delete would be an invented endpoint.
    return Promise.reject(
      new CapabilityUnavailableError(
        "The pinned external-openapi-v1 contract has no per-conversation delete operation.",
        this.profile,
      ),
    );
  }

  async sendMessage(input: {
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
  }> {
    const conversationId =
      input.conversationId ??
      (
        await this.createConversation({
          ...(input.channel !== undefined ? { channel: input.channel } : {}),
          ...(input.user !== undefined ? { user: input.user } : {}),
        })
      ).id;
    const reply = await this.#call<WireMessage>(
      "ExternalApiConversationsController_processMessage",
      { id: conversationId },
      {
        message: input.message,
        ...(input.context !== undefined ? { context: input.context } : {}),
      },
    );
    return {
      id: reply.id,
      conversationId: reply.conversationId ?? conversationId,
      role: "assistant",
      content: reply.message,
      createdAt: reply.createdAt,
    };
  }

  async getMessages(conversationId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.#call<{ messages: Array<Record<string, unknown>> }>(
      "ExternalApiConversationsController_getConversationMessages",
      { id: conversationId },
    );
    return result.messages;
  }
}
