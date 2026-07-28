/**
 * Conversation-runtime credential (build spec section 19): the Agent Secret
 * Key is scoped to a single agent's conversation surface. Its kind
 * discriminator is exactly what @raia/provider-http's runtime guard rejects,
 * so this credential can never construct a ManagementProvider.
 */
export interface AgentSecretCredential {
  readonly kind: "agent-secret-key";
  readonly secretKey: string;
}

export function agentSecretCredentialFromEnv(
  env: Record<string, string | undefined>,
): AgentSecretCredential | undefined {
  const secretKey = env["RAIA_AGENT_SECRET_KEY"];
  if (secretKey === undefined || secretKey.length === 0) {
    return undefined;
  }
  return { kind: "agent-secret-key", secretKey };
}
