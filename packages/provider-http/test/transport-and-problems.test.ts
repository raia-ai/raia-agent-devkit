/**
 * fetchTransport behavior against a real local server (timeouts, network
 * failures, header capture) and problem-mapping branches (status fallbacks,
 * Retry-After date form, non-JSON bodies).
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchTransport, parseRetryAfterMs, providerErrorFromResponse } from "../src/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/slow") {
      // Never responds; exercises the timeout path.
      return;
    }
    if (request.url === "/echo") {
      response.writeHead(200, { "content-type": "application/json", "x-echo": "yes" });
      response.end(JSON.stringify({ method: request.method, auth: request.headers.authorization }));
      return;
    }
    response.writeHead(302, { location: "/echo" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("fetchTransport", () => {
  it("performs a real request and lower-cases response headers", async () => {
    const response = await fetchTransport({
      method: "POST",
      url: `${baseUrl}/echo`,
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: "{}",
      timeoutMs: 5000,
    });
    expect(response.status).toBe(200);
    expect(response.headers["x-echo"]).toBe("yes");
    expect(JSON.parse(response.body)).toEqual({ method: "POST", auth: "Bearer t" });
  });

  it("maps a hung server to a retryable TIMEOUT", async () => {
    await expect(
      fetchTransport({ method: "GET", url: `${baseUrl}/slow`, headers: {}, timeoutMs: 200 }),
    ).rejects.toMatchObject({ name: "ProviderError", code: "TIMEOUT", retryable: true });
  });

  it("maps a caller abort signal to TIMEOUT and a dead port to retryable UNAVAILABLE", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchTransport({
        method: "GET",
        url: `${baseUrl}/echo`,
        headers: {},
        timeoutMs: 5000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(
      fetchTransport({ method: "GET", url: "http://127.0.0.1:9", headers: {}, timeoutMs: 2000 }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });

  it("refuses to follow redirects", async () => {
    await expect(
      fetchTransport({ method: "GET", url: `${baseUrl}/redirect`, headers: {}, timeoutMs: 5000 }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("problem mapping fallbacks", () => {
  it("falls back to status-derived codes when the body has no known code", () => {
    const cases: Array<[number, string]> = [
      [401, "AUTHENTICATION_REQUIRED"],
      [403, "PERMISSION_DENIED"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
      [400, "VALIDATION_FAILED"],
      [422, "VALIDATION_FAILED"],
      [429, "RATE_LIMITED"],
      [500, "INTERNAL"],
      [504, "TIMEOUT"],
      [502, "UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      expect(providerErrorFromResponse(status, "not json at all", {}).code, String(status)).toBe(
        code,
      );
    }
  });

  it("prefers the problem's own code and detail; picks request id from body or header", () => {
    const fromBody = providerErrorFromResponse(
      409,
      JSON.stringify({
        title: "Stale",
        detail: "the base moved",
        code: "STALE_BASE",
        requestId: "req_body",
      }),
      { "x-request-id": "req_header" },
    );
    expect(fromBody).toMatchObject({ code: "STALE_BASE", requestId: "req_body" });
    expect(fromBody.message).toContain("the base moved");

    const fromHeader = providerErrorFromResponse(500, "{}", { "x-request-id": "req_header" });
    expect(fromHeader.requestId).toBe("req_header");
  });

  it("parses Retry-After in seconds and HTTP-date forms, capped at 60s", () => {
    expect(parseRetryAfterMs("2.5")).toBe(2500);
    expect(parseRetryAfterMs("120")).toBe(60_000);
    const soon = new Date(Date.now() + 5_000).toUTCString();
    const parsed = parseRetryAfterMs(soon)!;
    expect(parsed).toBeGreaterThan(2_000);
    expect(parsed).toBeLessThanOrEqual(6_000);
    expect(parseRetryAfterMs("not-a-date")).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });
});
