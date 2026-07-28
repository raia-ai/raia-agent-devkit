/**
 * Management-plane credentials (build spec section 19). Lifecycle access uses
 * an OAuth access token or a CI service token — never an Agent Secret Key.
 * The kind discriminator makes the boundary explicit at the type level, and
 * the runtime guard enforces it against untyped callers.
 */
import { ProviderError } from "@raia/contracts";

export interface ManagementCredential {
  /** Interactive OAuth access token or workspace-scoped CI service token. */
  readonly kind: "oauth-access-token" | "service-token";
  readonly bearerToken: string;
}

/**
 * `RAIA_ACCESS_TOKEN` is the allowed CI fallback for a management credential.
 * `RAIA_AGENT_SECRET_KEY` is deliberately never read here: it is scoped to a
 * single agent's conversation runtime and must not satisfy ManagementProvider.
 */
export function managementCredentialFromEnv(
  env: Record<string, string | undefined>,
): ManagementCredential | undefined {
  const token = env["RAIA_ACCESS_TOKEN"];
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  return { kind: "service-token", bearerToken: token };
}

/** Fails closed when anything but a management credential is supplied. */
export function assertManagementCredential(
  credential: unknown,
): asserts credential is ManagementCredential {
  const candidate = credential as { kind?: string; bearerToken?: unknown } | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    (candidate.kind !== "oauth-access-token" && candidate.kind !== "service-token")
  ) {
    throw new ProviderError(
      candidate?.kind === "agent-secret-key"
        ? "An Agent Secret Key is scoped to one agent's conversation runtime and cannot authorize lifecycle management."
        : "A management credential (oauth-access-token or service-token) is required.",
      "AUTHENTICATION_REQUIRED",
    );
  }
  if (typeof candidate.bearerToken !== "string" || candidate.bearerToken.length === 0) {
    throw new ProviderError(
      "The management credential has no token material.",
      "AUTHENTICATION_REQUIRED",
    );
  }
}
