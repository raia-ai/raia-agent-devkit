/**
 * Exit-code contract (build spec section 20.1) and safe error rendering
 * (section 26). The JSON error envelope is `{ok:false, error:{...}}`.
 */
import { ProviderError } from "@raia/contracts";
import { DevkitError, redactText } from "@raia/core";
import type { CliIO, GlobalFlags } from "./io.js";

export const EXIT = {
  OK: 0,
  OPERATIONAL: 1,
  USAGE: 2,
  VALIDATION: 3,
  AUTH: 4,
  CONFLICT: 5,
  EVAL_GATE: 6,
} as const;

/** Usage/configuration error raised by commands (exit 2). */
export class UsageError extends Error {
  readonly code = "INVALID_USAGE";
}

const DEVKIT_VALIDATION_CODES = new Set([
  "MANIFEST_INVALID",
  "SCHEMA_INVALID",
  "DUPLICATE_NAME",
  "REFERENCE_INVALID",
  "PATH_ESCAPE",
  "SECRET_DETECTED",
  "LOCK_INVALID",
  "LOCK_DRIFT",
]);

export function exitCodeFor(error: unknown): number {
  if (error instanceof UsageError) {
    return EXIT.USAGE;
  }
  if (error instanceof DevkitError) {
    return DEVKIT_VALIDATION_CODES.has(error.code) ? EXIT.VALIDATION : EXIT.OPERATIONAL;
  }
  if (error instanceof ProviderError) {
    switch (error.code) {
      case "AUTHENTICATION_REQUIRED":
      case "PERMISSION_DENIED":
        return EXIT.AUTH;
      case "CONFLICT":
      case "STALE_BASE":
      case "IDEMPOTENCY_MISMATCH":
      case "INVALID_TRANSITION":
        return EXIT.CONFLICT;
      case "EVALUATION_GATE_FAILED":
        return EXIT.EVAL_GATE;
      case "VALIDATION_FAILED":
      case "POLICY_FAILED":
        return EXIT.VALIDATION;
      default:
        return EXIT.OPERATIONAL;
    }
  }
  return EXIT.OPERATIONAL;
}

interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof DevkitError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: false,
        ...(error.details !== undefined ? { details: error.details } : {}),
        ...(error.path !== undefined ? { details: { ...error.details, path: error.path } } : {}),
      },
    };
  }
  if (error instanceof ProviderError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: redactText(error.message),
        retryable: error.retryable,
        ...(error.requestId !== undefined ? { requestId: error.requestId } : {}),
      },
    };
  }
  if (error instanceof UsageError) {
    return {
      ok: false,
      error: { code: "INVALID_USAGE", message: redactText(error.message), retryable: false },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: { code: "INTERNAL", message: redactText(message), retryable: false },
  };
}

export function reportError(io: CliIO, flags: GlobalFlags, error: unknown): number {
  const envelope = toErrorEnvelope(error);
  if (flags.json) {
    io.stdout(JSON.stringify(envelope, null, 2));
  } else {
    io.stderr(`error [${envelope.error.code}]: ${envelope.error.message}`);
  }
  return exitCodeFor(error);
}
