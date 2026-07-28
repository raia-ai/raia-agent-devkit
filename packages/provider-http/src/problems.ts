/**
 * problem+json → typed ProviderError mapping (build spec section 18). The
 * server's `code` wins when it is a known ProviderErrorCode; otherwise the
 * HTTP status decides. Response bodies are never echoed verbatim into error
 * messages beyond the problem `title`/`detail` fields, which the contract
 * defines as operator-facing text.
 */
import { ProviderError, type ProviderErrorCode } from "@raia/contracts";

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "AUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "CONFLICT",
  "STALE_BASE",
  "IDEMPOTENCY_MISMATCH",
  "INVALID_TRANSITION",
  "VALIDATION_FAILED",
  "POLICY_FAILED",
  "EVALUATION_GATE_FAILED",
  "UNAVAILABLE",
  "TIMEOUT",
  "INTERNAL",
]);

function codeForStatus(status: number): ProviderErrorCode {
  if (status === 401) return "AUTHENTICATION_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422 || status === 400) return "VALIDATION_FAILED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 504) return "TIMEOUT";
  if (status === 500) return "INTERNAL";
  return "UNAVAILABLE";
}

const RETRYABLE_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TIMEOUT",
  "INTERNAL",
]);

/** Codes that must never be retried (spec section 18). */
export function isRetryable(error: ProviderError): boolean {
  return RETRYABLE_CODES.has(error.code);
}

export function parseRetryAfterMs(headerValue: string | undefined): number | undefined {
  if (headerValue === undefined) {
    return undefined;
  }
  const seconds = Number.parseFloat(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  return undefined;
}

export function providerErrorFromResponse(
  status: number,
  body: string,
  headers: Record<string, string>,
): ProviderError {
  let problem: {
    title?: unknown;
    detail?: unknown;
    requestId?: unknown;
    code?: unknown;
  } = {};
  try {
    problem = JSON.parse(body) as typeof problem;
  } catch {
    // Non-JSON error body (proxy, gateway): fall through to status mapping.
  }
  const code =
    typeof problem.code === "string" && KNOWN_CODES.has(problem.code)
      ? (problem.code as ProviderErrorCode)
      : codeForStatus(status);
  const title = typeof problem.title === "string" ? problem.title : `HTTP ${status}`;
  const detail = typeof problem.detail === "string" ? `: ${problem.detail}` : "";
  const requestId =
    typeof problem.requestId === "string" ? problem.requestId : headers["x-request-id"];
  const retryAfterMs = parseRetryAfterMs(headers["retry-after"]);
  return new ProviderError(
    `${title}${detail}`,
    code,
    requestId,
    RETRYABLE_CODES.has(code),
    retryAfterMs !== undefined ? { retryAfterMs } : undefined,
  );
}
