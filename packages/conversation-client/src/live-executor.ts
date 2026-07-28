/**
 * Live case executor (build spec section 21): plugs the conversation runtime
 * into the evaluation engine's executor seam. Each case gets a fresh
 * conversation; every user turn is sent in order and the final assistant
 * reply becomes the observed output. Tool calls and state transitions are not
 * observable over the conversation surface, so tool-policy and expected-state
 * checks evaluate against an empty observation — they skip/fail explicitly
 * rather than being silently invented.
 */
import type { ConversationProvider } from "@raia/contracts";
import type { CaseExecutor } from "@raia/eval-engine";

export interface LiveExecutorOptions {
  provider: ConversationProvider;
  /** Injectable monotonic-ish clock for latency measurement. */
  nowMs?: () => number;
}

export function createLiveCaseExecutor(options: LiveExecutorOptions): CaseExecutor {
  const nowMs = options.nowMs ?? (() => Date.now());
  return async (_suite, evalCase) => {
    if (!("turns" in evalCase.conversation)) {
      return {
        skippedReason:
          "simulator conversations are not supported by the live conversation runtime in the MVP.",
      };
    }
    const userTurns = evalCase.conversation.turns.filter((turn) => turn.role === "user");
    if (userTurns.length === 0) {
      return { skippedReason: "the case has no user turns to send." };
    }
    const started = nowMs();
    const conversation = await options.provider.createConversation({
      ...(evalCase.initialContext !== undefined
        ? { context: JSON.stringify(evalCase.initialContext) }
        : {}),
    });
    let lastReply = "";
    for (const turn of userTurns) {
      const reply = await options.provider.sendMessage({
        message: turn.content,
        conversationId: conversation.id,
      });
      lastReply = reply.content;
    }
    return {
      fixture: {
        assistantMessage: lastReply,
        latencyMs: nowMs() - started,
      },
    };
  };
}
