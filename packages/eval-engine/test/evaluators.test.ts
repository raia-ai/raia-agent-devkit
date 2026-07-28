/**
 * Direct unit tests for every deterministic evaluator type and its edge
 * paths (build spec section 21): safety limits, missing observations, target
 * selection, and redacted/capped failure messages.
 */
import { describe, expect, it } from "vitest";
import type { EvalAssertion, EvalCase } from "@raia/contracts";
import { checkRegexSafety, evaluateAssertion } from "../src/index.js";
import type { FixtureData } from "../src/index.js";

const CASE = {
  id: "case-1",
  description: "unit case",
  criticality: "standard",
  conversation: { turns: [{ role: "user", content: "What is my order status?" }] },
  assertions: [],
} as unknown as EvalCase;

const FIXTURE: FixtureData = {
  assistantMessage: 'Your order shipped. {"status":"SHIPPED","eta":"2026-08-01"}',
  toolCalls: [{ name: "lookup-order", arguments: { orderId: "ORD-000001" } }],
  stateTransitions: ["greeting", "resolving"],
  finalState: "resolved",
  latencyMs: 900,
  costUsd: 0.004,
};

function assertion(fields: Record<string, unknown>): EvalAssertion {
  return { id: "a1", ...fields } as unknown as EvalAssertion;
}

async function run(
  fields: Record<string, unknown>,
  fixture: FixtureData = FIXTURE,
): Promise<{ status: string; message?: string }> {
  return evaluateAssertion(assertion(fields), CASE, fixture, {});
}

describe("checkRegexSafety", () => {
  it("rejects oversized patterns, quantifier floods, backreferences, invalid syntax", () => {
    expect(checkRegexSafety("a".repeat(513))).toContain("512 characters");
    expect(checkRegexSafety("(a+)+".repeat(20))).toContain("quantifiers");
    expect(checkRegexSafety("(a)\\1")).toContain("backreferences");
    expect(checkRegexSafety("(unclosed")).toBeTruthy();
    expect(checkRegexSafety("^ORD-[0-9]{6}$")).toBeUndefined();
  });
});

describe("evaluateAssertion", () => {
  it("exact: passes on identity and fails with the actual text in the message", async () => {
    const pass = await run({
      type: "exact",
      target: "final-state",
      expected: "resolved",
    });
    expect(pass.status).toBe("passed");
    const fail = await run({ type: "exact", expected: "something else" });
    expect(fail.status).toBe("failed");
    expect(fail.message).toContain("expected exact match");
  });

  it("contains: case-insensitive, and supports the conversation target", async () => {
    expect((await run({ type: "contains", expected: "YOUR ORDER SHIPPED" })).status).toBe("passed");
    const conversation = await run({
      type: "contains",
      target: "conversation",
      expected: "user: What is my order status?",
    });
    expect(conversation.status).toBe("passed");
    expect((await run({ type: "contains", expected: "refund" })).status).toBe("failed");
  });

  it("regex: unsafe patterns fail closed; oversized targets fail; valid patterns match", async () => {
    expect((await run({ type: "regex", expected: "(a)\\1" })).message).toContain("unsafe");
    const oversized: FixtureData = { assistantMessage: "x".repeat(1024 * 1024 + 1) };
    expect((await run({ type: "regex", expected: "x" }, oversized)).message).toContain(
      "size limit",
    );
    expect((await run({ type: "regex", expected: "SHIPPED" })).status).toBe("passed");
    expect((await run({ type: "regex", expected: "^\\d+$" })).status).toBe("failed");
  });

  it("json-schema: schema size cap, non-JSON target, violations, invalid schema", async () => {
    const bigSchema = {
      type: "object",
      description: "p".repeat(128 * 1024),
    };
    expect((await run({ type: "json-schema", schema: bigSchema })).message).toContain("size limit");
    expect((await run({ type: "json-schema", schema: { type: "object" } })).message).toContain(
      "not valid JSON",
    );
    const jsonFixture: FixtureData = { assistantMessage: '{"status":"SHIPPED"}' };
    expect(
      (
        await run(
          { type: "json-schema", schema: { type: "object", required: ["status"] } },
          jsonFixture,
        )
      ).status,
    ).toBe("passed");
    const violation = await run(
      { type: "json-schema", schema: { type: "object", required: ["missingField"] } },
      jsonFixture,
    );
    expect(violation.status).toBe("failed");
    expect(violation.message).toContain("schema violation");
    const invalidSchema = await run(
      { type: "json-schema", schema: { type: "object", required: "not-an-array" } },
      jsonFixture,
    );
    expect(invalidSchema.status).toBe("failed");
  });

  it("tool-call and tool-not-called check observed tool usage", async () => {
    expect((await run({ type: "tool-call", toolName: "lookup-order" })).status).toBe("passed");
    expect((await run({ type: "tool-call", toolName: "refund" })).status).toBe("failed");
    expect((await run({ type: "tool-not-called", toolName: "refund" })).status).toBe("passed");
    expect((await run({ type: "tool-not-called", toolName: "lookup-order" })).status).toBe(
      "failed",
    );
  });

  it("latency and cost fail when unrecorded and compare against maxima", async () => {
    const bare: FixtureData = { assistantMessage: "hello" };
    expect((await run({ type: "latency", maximum: 1000 }, bare)).message).toContain("latencyMs");
    expect((await run({ type: "cost", maximum: 1 }, bare)).message).toContain("costUsd");
    expect((await run({ type: "latency", maximum: 1000 })).status).toBe("passed");
    expect((await run({ type: "latency", maximum: 100 })).status).toBe("failed");
    expect((await run({ type: "cost", maximum: 0.01 })).status).toBe("passed");
    expect((await run({ type: "cost", maximum: 0.001 })).status).toBe("failed");
  });

  it("conversation-state compares the final state", async () => {
    expect((await run({ type: "conversation-state", expected: "resolved" })).status).toBe("passed");
    const fail = await run({ type: "conversation-state", expected: "escalated" });
    expect(fail.status).toBe("failed");
    expect(fail.message).toContain('"resolved"');
  });

  it("rubric skips without a provider and scores with one", async () => {
    const skipped = await run({ type: "rubric", rubric: "helpful", minimumScore: 0.5 });
    expect(skipped.status).toBe("skipped");
    const evaluator = { id: "fake", evaluate: () => Promise.resolve({ score: 0.4 }) };
    const scored = await evaluateAssertion(
      assertion({ type: "rubric", rubric: "helpful", minimumScore: 0.5 }),
      CASE,
      FIXTURE,
      { rubricEvaluator: evaluator },
    );
    expect(scored.status).toBe("failed");
    expect(scored.message).toContain("below minimum");
  });

  it("unknown assertion types fail closed and failure messages are redacted + capped", async () => {
    expect((await run({ type: "telepathy" })).message).toContain("unknown assertion type");
    const secretValue = "F8kQz3Wr7Xv1Nb5TjCm2Hd6Ys4Ug0Pe9";
    const secretFixture: FixtureData = {
      assistantMessage: `api_key=${secretValue} ${"long ".repeat(200)}`,
    };
    const outcome = await run({ type: "exact", expected: "nope" }, secretFixture);
    expect(outcome.status).toBe("failed");
    expect(outcome.message).not.toContain(secretValue);
    expect(outcome.message).toContain("[REDACTED:");
    expect(outcome.message!.length).toBeLessThanOrEqual(301);
  });
});
