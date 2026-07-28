/**
 * Deterministic assertion evaluators (build spec section 21). Regex evaluation
 * uses safe limits; JSON Schema uses a separately configured Ajv instance with
 * size limits; failure messages are redacted and capped.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { EvalAssertion, EvalCase } from "@raia/contracts";
import { redactText } from "@raia/core";
import type { AssertionOutcome, FixtureData, RubricEvaluator } from "./types.js";

const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => unknown;

// Separate Ajv instance for assertion schemas (never shared with contract validation).
const assertionAjv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
addFormats(assertionAjv);

const MAX_MESSAGE_LENGTH = 300;
const MAX_REGEX_LENGTH = 512;
const MAX_REGEX_QUANTIFIERS = 32;
const MAX_SCHEMA_BYTES = 128 * 1024;
const MAX_TARGET_BYTES = 1024 * 1024;

function cap(message: string): string {
  const redacted = redactText(message);
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
    : redacted;
}

function targetText(assertion: EvalAssertion, evalCase: EvalCase, fixture: FixtureData): string {
  const target = (assertion as { target?: string }).target ?? "last-assistant-message";
  if (target === "conversation") {
    const turns =
      "turns" in evalCase.conversation
        ? evalCase.conversation.turns.map((turn) => `${turn.role}: ${turn.content}`)
        : [];
    return [...turns, `assistant: ${fixture.assistantMessage}`].join("\n");
  }
  if (target === "final-state") {
    return fixture.finalState ?? "";
  }
  return fixture.assistantMessage;
}

/** Deterministic complexity guard: length cap plus a quantifier budget. */
export function checkRegexSafety(pattern: string): string | undefined {
  if (pattern.length > MAX_REGEX_LENGTH) {
    return `pattern exceeds ${MAX_REGEX_LENGTH} characters`;
  }
  const quantifiers = pattern.match(/[*+?]|\{\d+(,\d*)?\}/g) ?? [];
  if (quantifiers.length > MAX_REGEX_QUANTIFIERS) {
    return `pattern exceeds ${MAX_REGEX_QUANTIFIERS} quantifiers`;
  }
  if (/\\[1-9]/.test(pattern)) {
    return "backreferences are not supported";
  }
  try {
    new RegExp(pattern);
  } catch (error) {
    return error instanceof Error ? error.message : "invalid pattern";
  }
  return undefined;
}

export async function evaluateAssertion(
  assertion: EvalAssertion,
  evalCase: EvalCase,
  fixture: FixtureData,
  options: { rubricEvaluator?: RubricEvaluator },
): Promise<AssertionOutcome> {
  const record = assertion as Record<string, unknown>;
  const id = String(record["id"]);
  const type = String(record["type"]);
  const critical = record["critical"] === true;

  const outcome = (status: AssertionOutcome["status"], message?: string): AssertionOutcome => ({
    assertionId: id,
    type,
    status,
    critical,
    ...(message !== undefined ? { message: cap(message) } : {}),
  });

  const toolCalls = fixture.toolCalls ?? [];

  switch (type) {
    case "exact": {
      const actual = targetText(assertion, evalCase, fixture);
      const expected = String(record["expected"] ?? "");
      return actual === expected
        ? outcome("passed")
        : outcome("failed", `expected exact match; got "${actual}"`);
    }
    case "contains": {
      const actual = targetText(assertion, evalCase, fixture);
      const expected = String(record["expected"] ?? "");
      return actual.toLowerCase().includes(expected.toLowerCase())
        ? outcome("passed")
        : outcome("failed", `expected content to contain "${expected}"`);
    }
    case "regex": {
      const pattern = String(record["expected"] ?? "");
      const unsafe = checkRegexSafety(pattern);
      if (unsafe !== undefined) {
        return outcome("failed", `unsafe or invalid regex: ${unsafe}`);
      }
      const actual = targetText(assertion, evalCase, fixture);
      if (Buffer.byteLength(actual, "utf8") > MAX_TARGET_BYTES) {
        return outcome("failed", "target exceeds the evaluation size limit");
      }
      return new RegExp(pattern, "s").test(actual)
        ? outcome("passed")
        : outcome("failed", `pattern did not match the target`);
    }
    case "json-schema": {
      const schema = record["schema"] as object;
      if (Buffer.byteLength(JSON.stringify(schema), "utf8") > MAX_SCHEMA_BYTES) {
        return outcome("failed", "assertion schema exceeds the size limit");
      }
      const actual = targetText(assertion, evalCase, fixture);
      let parsed: unknown;
      try {
        parsed = JSON.parse(actual);
      } catch {
        return outcome("failed", "target is not valid JSON");
      }
      try {
        const validate = assertionAjv.compile(schema);
        return validate(parsed)
          ? outcome("passed")
          : outcome(
              "failed",
              `schema violation: ${(validate.errors ?? [])
                .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`)
                .join("; ")}`,
            );
      } catch (error) {
        return outcome("failed", `invalid assertion schema: ${(error as Error).message}`);
      }
    }
    case "tool-call": {
      const toolName = String(record["toolName"]);
      return toolCalls.some((call) => call.name === toolName)
        ? outcome("passed")
        : outcome("failed", `expected a call to tool "${toolName}"`);
    }
    case "tool-not-called": {
      const toolName = String(record["toolName"]);
      return toolCalls.some((call) => call.name === toolName)
        ? outcome("failed", `tool "${toolName}" must not be called`)
        : outcome("passed");
    }
    case "latency": {
      const maximum = Number(record["maximum"]);
      if (fixture.latencyMs === undefined) {
        return outcome("failed", "fixture does not record latencyMs");
      }
      return fixture.latencyMs <= maximum
        ? outcome("passed")
        : outcome("failed", `latency ${fixture.latencyMs}ms exceeds maximum ${maximum}ms`);
    }
    case "cost": {
      const maximum = Number(record["maximum"]);
      if (fixture.costUsd === undefined) {
        return outcome("failed", "fixture does not record costUsd");
      }
      return fixture.costUsd <= maximum
        ? outcome("passed")
        : outcome("failed", `cost ${fixture.costUsd} exceeds maximum ${maximum}`);
    }
    case "conversation-state": {
      const expected = String(record["expected"] ?? "");
      const actual = fixture.finalState ?? "";
      return actual === expected
        ? outcome("passed")
        : outcome("failed", `final state "${actual}" != expected "${expected}"`);
    }
    case "rubric": {
      if (options.rubricEvaluator === undefined) {
        return outcome(
          "skipped",
          "rubric evaluation is disabled: no evaluator provider is configured",
        );
      }
      const rubric = String(record["rubric"]);
      const minimumScore = Number(record["minimumScore"]);
      const { score } = await options.rubricEvaluator.evaluate({
        rubric,
        content: targetText(assertion, evalCase, fixture),
      });
      return score >= minimumScore
        ? outcome("passed")
        : outcome("failed", `rubric score ${score} below minimum ${minimumScore}`);
    }
    default:
      return outcome("failed", `unknown assertion type "${type}"`);
  }
}
