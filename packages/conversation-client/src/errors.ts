/**
 * Typed capability gating (build spec section 16): when the configured
 * runtime profile has no pinned valid contract — or the pinned contract does
 * not express an operation — the client stops with CAPABILITY_UNAVAILABLE.
 * It never guesses routes or authentication behavior. ProviderErrorCode has
 * no such code, so this is a client-specific typed error.
 */
export class CapabilityUnavailableError extends Error {
  override readonly name = "CapabilityUnavailableError";
  readonly code = "CAPABILITY_UNAVAILABLE";

  constructor(
    message: string,
    readonly profile: string,
  ) {
    super(message);
  }
}
