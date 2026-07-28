/**
 * Live-mode evaluation through the executor seam (build spec section 21):
 * the conversation runtime drives real turns against the loopback contract
 * server, and the engine records mode "live" with the runtime profile.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sha256 } from "@raia/contracts";
import { runEvaluation } from "@raia/eval-engine";
import type { LoadedSuite } from "@raia/core";
import { createConversationRuntime, createLiveCaseExecutor } from "../src/index.js";
import {
  startMockConversationServer,
  type StartedConversationServer,
} from "../src/mock-conversation-server.js";

const SECRET = "test-agent-secret-key-value";
const sha = (c: string): Sha256 => `sha256:${c.repeat(64)}` as Sha256;

function suiteWith(cases: unknown[]): LoadedSuite {
  return {
    posixRelative: "evals/live.yaml",
    source: "",
    sha256: sha("a"),
    suite: {
      apiVersion: "raia.dev/v1",
      kind: "AgentEvaluationSuite",
      metadata: { name: "live-suite" },
      spec: { cases },
    },
    fixtures: new Map(),
  } as unknown as LoadedSuite;
}

let server: StartedConversationServer;

beforeAll(async () => {
  server = await startMockConversationServer({
    secretKey: SECRET,
    reply: (message) =>
      message.includes("reset") ? "You can reset your password from Settings." : "I can help.",
  });
});

afterAll(async () => {
  await server.close();
});

describe("live case executor", () => {
  it("runs turn conversations against the runtime and evaluates assertions", async () => {
    const runtime = createConversationRuntime({
      env: { RAIA_AGENT_SECRET_KEY: SECRET, RAIA_CONVERSATION_TEST_BASE_URL: server.baseUrl },
      conversationUserId: "user_eval_1",
    });
    let tick = 0;
    const run = await runEvaluation({
      suites: [
        suiteWith([
          {
            id: "live-reset",
            description: "password reset answer",
            criticality: "blocking",
            conversation: { turns: [{ role: "user", content: "How do I reset my password?" }] },
            assertions: [
              { id: "a1", type: "contains", value: "reset your password", critical: true },
            ],
          },
          {
            id: "live-simulator-skip",
            description: "simulator cases skip in live mode too",
            criticality: "informational",
            conversation: { simulator: { persona: "impatient customer", goal: "get a refund" } },
            assertions: [{ id: "a1", type: "contains", value: "refund" }],
          },
        ]),
      ],
      candidateSha256: sha("c"),
      mode: "live",
      providerLabel: "external-openapi-v1",
      caseExecutor: createLiveCaseExecutor({ provider: runtime, nowMs: () => (tick += 5) }),
      now: () => "2026-07-28T00:00:00.000Z",
    });

    expect(run.mode).toBe("live");
    expect(run.provider).toBe("external-openapi-v1");
    const [reset, simulator] = run.suites[0]!.cases;
    expect(reset!.status).toBe("passed");
    expect(simulator!.status).toBe("skipped");
    // The loopback server actually saw the conversation.
    expect(
      server.requests.filter((request) => request.path.endsWith("/messages")).length,
    ).toBeGreaterThan(0);
  });
});
