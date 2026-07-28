/**
 * Conversation-client contract tests (WP6 gate): the pinned checksums are
 * exact, profile gating fails closed, the wire uses the Agent-Secret-Key
 * header from the pinned contract, and unsupported operations are typed
 * capability failures instead of invented endpoints.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CapabilityUnavailableError,
  CONTRACT_OPERATIONS,
  CONTRACT_SECURITY_SCHEMES,
  createConversationRuntime,
  describeRuntime,
  ExternalConversationClient,
  PROJECTED_CONTRACT_SHA256,
  RAW_CONTRACT_SHA256,
} from "../src/index.js";
import {
  startMockConversationServer,
  type StartedConversationServer,
} from "../src/mock-conversation-server.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "test-agent-secret-key-value";

describe("pinned contract identity", () => {
  it("embeds the recorded raw and projected checksums", () => {
    expect(RAW_CONTRACT_SHA256).toBe(
      "fabbd26bf357ed184896d80a6ffd36c6f4873b42e8ae457ea0d0ae7a2c377cda",
    );
    expect(PROJECTED_CONTRACT_SHA256).toBe(
      "a76a1b2a1054f6a6c46443b60625da03667c9238f7559d547e9bdb94a44fb188",
    );
  });

  it("derives routes and auth schemes from the pinned contract, not prose docs", () => {
    expect(CONTRACT_OPERATIONS.ExternalApiConversationsController_processMessage).toEqual({
      method: "POST",
      path: "/external/conversations/{id}/messages",
    });
    expect(CONTRACT_SECURITY_SCHEMES).toContain("Agent-Secret-Key");
    // The /api/v1 prefix of the unpinned developer docs must appear nowhere.
    for (const operation of Object.values(CONTRACT_OPERATIONS)) {
      expect(operation.path.startsWith("/external/")).toBe(true);
    }
  });

  it("check-sync fails closed when the generated constants drift", async () => {
    const generatedPath = path.join(packageRoot, "src", "generated", "contract-constants.ts");
    const original = await readFile(generatedPath, "utf8");
    const script = path.join(packageRoot, "scripts", "check-contract-sync.mjs");
    execFileSync(process.execPath, [script], { encoding: "utf8" });
    try {
      await writeFile(generatedPath, original.replace(RAW_CONTRACT_SHA256, "0".repeat(64)));
      expect(() => execFileSync(process.execPath, [script], { encoding: "utf8" })).toThrowError(
        /OUT OF SYNC/,
      );
    } finally {
      await writeFile(generatedPath, original);
    }
  });
});

describe("runtime profile gating", () => {
  it("developer-v1 is capability-disabled and fails closed", () => {
    const description = describeRuntime({ env: { RAIA_RUNTIME_PROFILE: "developer-v1" } });
    expect(description.available).toBe(false);
    expect(description.unavailableReason).toContain("capability-disabled");
    expect(() =>
      createConversationRuntime({ env: { RAIA_RUNTIME_PROFILE: "developer-v1" } }),
    ).toThrowError(CapabilityUnavailableError);
  });

  it("unknown profiles never guess", () => {
    expect(() =>
      createConversationRuntime({ env: { RAIA_RUNTIME_PROFILE: "future-profile" } }),
    ).toThrowError(CapabilityUnavailableError);
  });

  it("custom-openapi reports a local file checksum but has no generated client", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "raia-custom-contract-"));
    try {
      const file = path.join(dir, "local.openapi.json");
      await writeFile(file, '{"openapi":"3.1.0"}');
      const description = describeRuntime({
        env: { RAIA_RUNTIME_PROFILE: "custom-openapi", RAIA_RUNTIME_CONTRACT_FILE: file },
      });
      expect(description.available).toBe(false);
      expect(description.contractSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("external-openapi-v1 without a secret key reports unavailable without credentials", () => {
    const description = describeRuntime({ env: {} });
    expect(description.profile).toBe("external-openapi-v1");
    expect(description.available).toBe(false);
    expect(description.credentialPresent).toBe(false);
    expect(description.contractSha256).toBe(PROJECTED_CONTRACT_SHA256);
    expect(description.authScheme).toContain("Agent-Secret-Key");
    expect(JSON.stringify(description)).not.toContain(SECRET);
  });

  it("refuses non-loopback base URL overrides", () => {
    expect(() =>
      createConversationRuntime({
        env: {
          RAIA_AGENT_SECRET_KEY: SECRET,
          RAIA_CONVERSATION_TEST_BASE_URL: "https://attacker.example.com",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "VALIDATION_FAILED" }));
  });
});

describe("wire behavior against the loopback contract server", () => {
  let server: StartedConversationServer;
  let client: ExternalConversationClient;

  beforeAll(async () => {
    server = await startMockConversationServer({ secretKey: SECRET });
    client = createConversationRuntime({
      env: {
        RAIA_AGENT_SECRET_KEY: SECRET,
        RAIA_CONVERSATION_TEST_BASE_URL: server.baseUrl,
      },
      conversationUserId: "user_eval_1",
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it("creates a conversation and authenticates with the Agent-Secret-Key header", async () => {
    const conversation = await client.createConversation();
    expect(conversation.id).toBe("conv_1");
    const request = server.requests.at(-1)!;
    expect(request.headers["agent-secret-key"]).toBe(SECRET);
    expect(request.headers["authorization"]).toBeUndefined();
  });

  it("sends a message and returns the assistant reply", async () => {
    const reply = await client.sendMessage({ message: "hello", conversationId: "conv_1" });
    expect(reply).toMatchObject({
      conversationId: "conv_1",
      role: "assistant",
      content: "echo: hello",
    });
    const messages = await client.getMessages("conv_1");
    expect(messages).toHaveLength(2);
  });

  it("creates the conversation implicitly when sendMessage has none", async () => {
    const reply = await client.sendMessage({ message: "implicit" });
    expect(reply.conversationId).toBe("conv_2");
  });

  it("maps an invalid secret key to a typed auth error without echoing the body", async () => {
    const bad = new ExternalConversationClient({
      credential: { kind: "agent-secret-key", secretKey: "wrong-key" },
      baseUrlOverride: server.baseUrl,
      conversationUserId: "user_eval_1",
    });
    const error = await bad.createConversation().catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ProviderError", code: "AUTHENTICATION_REQUIRED" });
    expect(String((error as Error).message)).not.toContain("Invalid API key");
  });

  it("fails closed on per-conversation delete (not in the pinned contract)", async () => {
    await expect(client.deleteConversation("conv_1")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("fails closed on channel-scoped creation", async () => {
    await expect(client.createConversation({ channel: "email" })).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("requires a conversationUserId as the pinned contract does", async () => {
    const noUser = new ExternalConversationClient({
      credential: { kind: "agent-secret-key", secretKey: SECRET },
      baseUrlOverride: server.baseUrl,
    });
    await expect(noUser.createConversation()).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("credential boundary", () => {
  it("the agent secret credential cannot construct the management provider", async () => {
    const { HttpManagementProvider } = await import("@raia/provider-http");
    expect(
      () =>
        new HttpManagementProvider({
          // @ts-expect-error — forbidden at the type level; runtime must also refuse.
          credential: { kind: "agent-secret-key", secretKey: SECRET },
        }),
    ).toThrowError(expect.objectContaining({ code: "AUTHENTICATION_REQUIRED" }));
  });
});
