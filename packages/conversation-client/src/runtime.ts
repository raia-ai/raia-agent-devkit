/**
 * Runtime-profile selection (build spec section 16). Three named profiles:
 *
 * - external-openapi-v1 — pinned, audited projection of the published
 *   external OpenAPI; the only profile with a generated client.
 * - developer-v1 — capability-disabled until raia supplies an authoritative
 *   OpenAPI document for the `/api/v1/...` interface; prose examples are not
 *   a generated-client contract.
 * - custom-openapi — an explicit local contract file; never a remote URL
 *   during normal execution. No generator ships for it in the MVP, so it is
 *   description-only and fails closed for execution.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { agentSecretCredentialFromEnv } from "./credentials.js";
import { CapabilityUnavailableError } from "./errors.js";
import { ExternalConversationClient, EXTERNAL_OPENAPI_V1 } from "./client.js";
import {
  CONTRACT_SERVERS,
  PROJECTED_CONTRACT_SHA256,
  RAW_CONTRACT_SHA256,
} from "./generated/contract-constants.js";

export type RuntimeProfileName = "external-openapi-v1" | "developer-v1" | "custom-openapi";

export interface RuntimeDescription {
  profile: RuntimeProfileName;
  /** Whether live conversation execution is possible with this configuration. */
  available: boolean;
  /** Why the runtime is unavailable, when it is. */
  unavailableReason?: string;
  contractSha256?: string;
  rawContractSha256?: string;
  server?: string;
  authScheme?: string;
  /** Presence only — never token material. */
  credentialPresent: boolean;
}

export interface RuntimeEnvOptions {
  env: Record<string, string | undefined>;
  region?: "us" | "eu";
}

function profileFromEnv(env: Record<string, string | undefined>): RuntimeProfileName {
  const raw = env["RAIA_RUNTIME_PROFILE"] ?? EXTERNAL_OPENAPI_V1;
  if (raw === "external-openapi-v1" || raw === "developer-v1" || raw === "custom-openapi") {
    return raw;
  }
  throw new CapabilityUnavailableError(
    `Unknown runtime profile "${raw}" (external-openapi-v1 | developer-v1 | custom-openapi).`,
    raw,
  );
}

/** Doctor-facing report: never throws and never reveals credentials. */
export function describeRuntime(options: RuntimeEnvOptions): RuntimeDescription {
  const credentialPresent = agentSecretCredentialFromEnv(options.env) !== undefined;
  let profile: RuntimeProfileName;
  try {
    profile = profileFromEnv(options.env);
  } catch (error) {
    return {
      profile: "developer-v1",
      available: false,
      unavailableReason: (error as Error).message,
      credentialPresent,
    };
  }
  if (profile === "external-openapi-v1") {
    return {
      profile,
      available: credentialPresent,
      ...(credentialPresent ? {} : { unavailableReason: "RAIA_AGENT_SECRET_KEY is not set." }),
      contractSha256: PROJECTED_CONTRACT_SHA256,
      rawContractSha256: RAW_CONTRACT_SHA256,
      server: CONTRACT_SERVERS[options.region ?? "us"],
      authScheme: "Agent-Secret-Key header (agent-scoped; cannot authorize lifecycle management)",
      credentialPresent,
    };
  }
  if (profile === "custom-openapi") {
    const contractPath = options.env["RAIA_RUNTIME_CONTRACT_FILE"];
    let contractSha256: string | undefined;
    let reason = "custom-openapi has no generated client in the MVP; live execution fails closed.";
    if (contractPath === undefined) {
      reason = "custom-openapi requires RAIA_RUNTIME_CONTRACT_FILE to point at a local file.";
    } else {
      try {
        contractSha256 = createHash("sha256").update(readFileSync(contractPath)).digest("hex");
      } catch {
        reason = `custom-openapi contract file is unreadable: ${contractPath}`;
      }
    }
    return {
      profile,
      available: false,
      unavailableReason: reason,
      ...(contractSha256 !== undefined ? { contractSha256 } : {}),
      credentialPresent,
    };
  }
  return {
    profile,
    available: false,
    unavailableReason:
      "developer-v1 is capability-disabled: raia has not published an authoritative OpenAPI document for the /api/v1/... interface.",
    credentialPresent,
  };
}

/**
 * Builds the live conversation client for the configured profile, or fails
 * closed with CapabilityUnavailableError. Test servers may be targeted via
 * RAIA_CONVERSATION_TEST_BASE_URL, which the client restricts to loopback.
 */
export function createConversationRuntime(
  options: RuntimeEnvOptions & { conversationUserId?: string },
): ExternalConversationClient {
  const description = describeRuntime(options);
  if (description.profile !== "external-openapi-v1") {
    throw new CapabilityUnavailableError(
      description.unavailableReason ??
        "The configured runtime profile has no pinned valid contract.",
      description.profile,
    );
  }
  const credential = agentSecretCredentialFromEnv(options.env);
  if (credential === undefined) {
    throw new CapabilityUnavailableError(
      "Live conversation execution requires RAIA_AGENT_SECRET_KEY.",
      description.profile,
    );
  }
  const override = options.env["RAIA_CONVERSATION_TEST_BASE_URL"];
  return new ExternalConversationClient({
    credential,
    ...(options.region !== undefined ? { region: options.region } : {}),
    ...(override !== undefined ? { baseUrlOverride: override } : {}),
    ...(options.conversationUserId !== undefined
      ? { conversationUserId: options.conversationUserId }
      : {}),
  });
}
