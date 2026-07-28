/**
 * Retry policy and credential-boundary tests (build spec sections 18 and 19):
 * Retry-After is honored, backoff is bounded and jittered, non-retryable codes
 * fail immediately, and an Agent Secret Key can never construct a management
 * provider — at the type level and at runtime.
 */
import { describe, expect, it } from "vitest";
import { ProviderError } from "@raia/contracts";
import {
  HttpManagementProvider,
  managementCredentialFromEnv,
  withRetry,
  type TransportResponse,
} from "../src/index.js";

const ok = (body: unknown): TransportResponse => ({
  status: 200,
  headers: { "x-request-id": "req_srv" },
  body: JSON.stringify(body),
});

const problem = (
  status: number,
  code: string,
  headers: Record<string, string> = {},
): TransportResponse => ({
  status,
  headers: { "x-request-id": "req_srv", ...headers },
  body: JSON.stringify({ type: "about:blank", title: code, status, requestId: "req_srv", code }),
});

function clientWith(responses: TransportResponse[], sleeps: number[]): HttpManagementProvider {
  let call = 0;
  return new HttpManagementProvider({
    credential: { kind: "oauth-access-token", bearerToken: "test-access-token" },
    baseUrl: "http://127.0.0.1:9",
    transport: () => Promise.resolve(responses[Math.min(call++, responses.length - 1)]!),
    retry: {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 0.5,
    },
  });
}

const IDENTITY = { principalId: "p", principalType: "user", scopes: [], workspaceIds: [] };

describe("retry policy", () => {
  it("honors Retry-After on 429 and then succeeds", async () => {
    const sleeps: number[] = [];
    const client = clientWith(
      [problem(429, "RATE_LIMITED", { "retry-after": "2" }), ok(IDENTITY)],
      sleeps,
    );
    const identity = await client.getIdentity({ requestId: "req_1" });
    expect(identity.principalId).toBe("p");
    expect(sleeps).toEqual([2000]);
  });

  it("uses jittered exponential backoff for 503 without Retry-After and caps attempts", async () => {
    const sleeps: number[] = [];
    const client = clientWith([problem(503, "UNAVAILABLE")], sleeps);
    await expect(client.getIdentity({ requestId: "req_1" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    // 3 attempts total → 2 waits at random()=0.5: 250*0.75, 500*0.75.
    expect(sleeps).toEqual([188, 375]);
  });

  it.each([
    [401, "AUTHENTICATION_REQUIRED"],
    [403, "PERMISSION_DENIED"],
    [409, "STALE_BASE"],
    [409, "IDEMPOTENCY_MISMATCH"],
    [409, "INVALID_TRANSITION"],
    [422, "VALIDATION_FAILED"],
  ])("never retries %i %s", async (status, code) => {
    const sleeps: number[] = [];
    const client = clientWith([problem(status, code)], sleeps);
    await expect(client.getIdentity({ requestId: "req_1" })).rejects.toMatchObject({ code });
    expect(sleeps).toEqual([]);
  });

  it("stops when the elapsed-time cap would be exceeded", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        () => {
          attempts += 1;
          return Promise.reject(new ProviderError("down", "UNAVAILABLE", undefined, true));
        },
        {
          maxAttempts: 10,
          maxElapsedMs: 300,
          baseDelayMs: 250,
          sleep: () => Promise.resolve(),
          random: () => 1,
        },
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    // First wait (250ms) fits the 300ms budget; the second (500ms) does not.
    expect(attempts).toBe(2);
  });
});

describe("management credential boundary", () => {
  it("reads only RAIA_ACCESS_TOKEN from the environment", () => {
    expect(
      managementCredentialFromEnv({ RAIA_AGENT_SECRET_KEY: "agent-scoped-value" }),
    ).toBeUndefined();
    expect(managementCredentialFromEnv({ RAIA_ACCESS_TOKEN: "ci-token" })).toEqual({
      kind: "service-token",
      bearerToken: "ci-token",
    });
  });

  it("rejects an agent-secret-key credential at runtime with a typed error", () => {
    expect(
      () =>
        new HttpManagementProvider({
          // @ts-expect-error — the type system already forbids this; the
          // runtime guard must also hold for untyped callers.
          credential: { kind: "agent-secret-key", secretKey: "agent-scoped-value" },
        }),
    ).toThrowError(
      expect.objectContaining({
        name: "ProviderError",
        code: "AUTHENTICATION_REQUIRED",
        message: expect.stringContaining("cannot authorize lifecycle management"),
      }),
    );
  });

  it("rejects empty token material", () => {
    expect(
      () =>
        new HttpManagementProvider({
          credential: { kind: "service-token", bearerToken: "" },
        }),
    ).toThrowError(expect.objectContaining({ code: "AUTHENTICATION_REQUIRED" }));
  });

  it("rejects a non-http base URL", () => {
    expect(
      () =>
        new HttpManagementProvider({
          credential: { kind: "service-token", bearerToken: "t".repeat(16) },
          baseUrl: "file:///etc/passwd",
        }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });

  it("never places token material in log entries", async () => {
    const entries: unknown[] = [];
    const client = new HttpManagementProvider({
      credential: { kind: "oauth-access-token", bearerToken: "super-sensitive-token-material" },
      baseUrl: "http://127.0.0.1:9",
      transport: () => Promise.resolve(ok(IDENTITY)),
      logger: (entry) => entries.push(entry),
    });
    await client.getIdentity({ requestId: "req_1" });
    expect(JSON.stringify(entries)).not.toContain("super-sensitive-token-material");
    expect(entries).toEqual([
      { method: "GET", path: "/me", status: 200, requestId: "req_1", attempt: 1 },
    ]);
  });
});
