/**
 * Injectable HTTP transport (build spec section 16: no process globals inside
 * core logic; transports, clocks, and randomness are injected). The default
 * transport uses global fetch with a per-request timeout.
 */
import { ProviderError } from "@raia/contracts";

export interface TransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Lower-cased header name → first value. */
  headers: Record<string, string>;
  body: string;
}

export type HttpTransport = (request: TransportRequest) => Promise<TransportResponse>;

export const fetchTransport: HttpTransport = async (request) => {
  const signals = [AbortSignal.timeout(request.timeoutMs)];
  if (request.signal !== undefined) {
    signals.push(request.signal);
  }
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: AbortSignal.any(signals),
      redirect: "error",
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ProviderError(
        `Request timed out after ${request.timeoutMs}ms.`,
        "TIMEOUT",
        undefined,
        true,
      );
    }
    // Network-level failure: no response, so no body to leak. The message is
    // kept generic; the URL host is operator-configured, not secret.
    throw new ProviderError(
      `Network request failed (${name ?? "unknown error"}).`,
      "UNAVAILABLE",
      undefined,
      true,
    );
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: response.status, headers, body: await response.text() };
};
