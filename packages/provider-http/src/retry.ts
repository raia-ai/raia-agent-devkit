/**
 * Bounded retry with jittered exponential backoff (build spec section 18):
 * honor Retry-After, retry only typed-retryable failures, cap both attempts
 * and elapsed time, and never retry authentication, permission, validation,
 * stale-base, idempotency-mismatch, or invalid-transition errors. All remote
 * mutations carry an Idempotency-Key, which is what makes their retry safe.
 */
import { ProviderError } from "@raia/contracts";
import { isRetryable } from "./problems.js";

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Elapsed-time cap across all waits (default 15000 ms). */
  maxElapsedMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter source in [0, 1). */
  random?: () => number;
  /** Observability seam; receives no header or body material. */
  onRetry?: (info: { attempt: number; delayMs: number; code: string }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(options.maxAttempts ?? 3, 1);
  const maxElapsedMs = options.maxElapsedMs ?? 15_000;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let elapsedMs = 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!(error instanceof ProviderError) || !isRetryable(error) || attempt >= maxAttempts) {
        throw error;
      }
      const retryAfterMs = (error.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
      const backoffMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = Math.round(
        retryAfterMs !== undefined ? retryAfterMs : backoffMs * (0.5 + random() / 2),
      );
      if (elapsedMs + delayMs > maxElapsedMs) {
        throw error;
      }
      elapsedMs += delayMs;
      options.onRetry?.({ attempt, delayMs, code: error.code });
      await sleep(delayMs);
    }
  }
}
