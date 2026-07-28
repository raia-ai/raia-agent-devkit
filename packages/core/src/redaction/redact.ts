/**
 * Secret detection and structured redaction (build spec sections 15 and 25,
 * ADR 0001 section 6). Findings never carry the matched value.
 */

export const SECRET_RULE_SET_VERSION = "1";

interface SecretRule {
  id: string;
  pattern: RegExp;
  /** When set, the rule only fires if the captured value passes the entropy gate. */
  entropyGroup?: number;
}

const PLACEHOLDER_VALUES = new Set(["placeholder", "redacted", "example", "changeme"]);
const ALLOWED_REFERENCE_PREFIX = /^(env|vault|raia-secret):\/\//i;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isAllowlisted(value: string): boolean {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  return ALLOWED_REFERENCE_PREFIX.test(trimmed) || PLACEHOLDER_VALUES.has(trimmed.toLowerCase());
}

const SECRET_RULES: readonly SecretRule[] = [
  { id: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  { id: "openai-style-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "credential-assignment",
    // The lookbehind stops substring hits inside reference schemes like
    // `raia-secret://...` (the allowlisted secretRef form).
    pattern:
      /(?<![A-Za-z0-9_-])(?:api[_-]?key|apikey|secret|token|password|authorization|credential)["']?\s*[:=]\s*["']?([A-Za-z0-9+/_.-]{16,})/gi,
    entropyGroup: 1,
  },
];

export interface SecretFinding {
  ruleId: string;
  ruleSetVersion: string;
  /** Where the secret was found (file path or JSON pointer); never the value. */
  location: string;
  line: number;
}

export function scanForSecrets(text: string, location: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      const candidate = rule.entropyGroup === undefined ? match[0] : match[rule.entropyGroup];
      if (candidate === undefined) {
        continue;
      }
      if (isAllowlisted(candidate)) {
        continue;
      }
      if (rule.entropyGroup !== undefined && shannonEntropy(candidate) < 3.2) {
        continue;
      }
      const line = text.slice(0, match.index).split("\n").length;
      findings.push({
        ruleId: rule.id,
        ruleSetVersion: SECRET_RULE_SET_VERSION,
        location,
        line,
      });
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}

/** Replaces any detected secret material in free text with a redaction marker. */
export function redactText(text: string): string {
  let result = text;
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, (full: string, ...groups: unknown[]) => {
      const captured =
        rule.entropyGroup !== undefined ? (groups[rule.entropyGroup - 1] as string) : full;
      if (captured === undefined || isAllowlisted(captured)) {
        return full;
      }
      if (rule.entropyGroup !== undefined && shannonEntropy(captured) < 3.2) {
        return full;
      }
      if (rule.entropyGroup !== undefined) {
        return full.replace(captured, `[REDACTED:${rule.id}]`);
      }
      return `[REDACTED:${rule.id}]`;
    });
  }
  return result;
}

const SENSITIVE_KEY_PATTERN =
  /^(authorization|token|secret|password|cookie|api[-_]?key|credential)$/i;

/** Deep redaction for structured data destined for logs, errors, or reports. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactValue(member);
      }
    }
    return result;
  }
  return value;
}
