/**
 * Stable domain error codes (build spec sections 15 and 26). Messages must stay
 * safe to render: construction runs every detail value through redaction.
 */
import { redactText, redactValue } from "./redaction/redact.js";

export type DevkitErrorCode =
  | "MANIFEST_INVALID"
  | "SCHEMA_INVALID"
  | "DUPLICATE_NAME"
  | "REFERENCE_INVALID"
  | "PATH_ESCAPE"
  | "SECRET_DETECTED"
  | "LOCK_INVALID"
  | "LOCK_DRIFT"
  | "INVALID_TRANSITION"
  | "EVIDENCE_MISMATCH"
  | "CANONICALIZATION_ERROR"
  | "IO_ERROR";

export class DevkitError extends Error {
  override readonly name = "DevkitError";
  readonly code: DevkitErrorCode;
  readonly path: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: DevkitErrorCode,
    message: string,
    options?: { path?: string; details?: Record<string, unknown> },
  ) {
    super(redactText(message));
    this.code = code;
    this.path = options?.path;
    this.details = options?.details
      ? (redactValue(options.details) as Record<string, unknown>)
      : undefined;
  }
}
