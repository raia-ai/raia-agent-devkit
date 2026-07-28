/**
 * Typed semantic diff with deterministic ordering and risk classification
 * (build spec section 15, lifecycle framework section 4, ADR 0001 section 7).
 *
 * High-risk floor (never classified lower): removed escalation, removed
 * guardrails, removed knowledge, broadened function authorization, incompatible
 * function schemas, model identity change, new external integration, weakened
 * confirmation, deployment-policy change.
 */
import type {
  FunctionDefinition,
  RaiaAgentManifest,
  RiskLevel,
  SemanticChange,
  Sha256,
} from "@raia/contracts";
import { canonicalJson } from "../hash/canonical.js";

export interface ManifestSnapshot {
  manifest: RaiaAgentManifest;
  /** Content hashes for local file artifacts, keyed by POSIX relative path. */
  artifactSha256ByPath: ReadonlyMap<string, Sha256>;
}

export interface SemanticDiffResult {
  changes: SemanticChange[];
  risk: RiskLevel;
}

type Severity = SemanticChange["severity"];

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxRisk(changes: readonly SemanticChange[]): RiskLevel {
  let highest: Severity = "info";
  for (const change of changes) {
    if (SEVERITY_ORDER[change.severity] > SEVERITY_ORDER[highest]) {
      highest = change.severity;
    }
  }
  return highest === "info" ? "low" : highest;
}

function artifactHash(
  snapshot: ManifestSnapshot,
  source: { file?: string; inline?: string; remoteRef?: string } | undefined,
): string | undefined {
  if (!source) {
    return undefined;
  }
  if (source.inline !== undefined) {
    return `inline:${source.inline}`;
  }
  if (source.remoteRef !== undefined) {
    return `remote:${source.remoteRef}`;
  }
  if (source.file !== undefined) {
    const normalized = source.file.replace(/\\/g, "/");
    return `file:${normalized}:${snapshot.artifactSha256ByPath.get(normalized) ?? "missing"}`;
  }
  return undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

interface SchemaShape {
  required: string[];
  properties: Record<string, unknown>;
  additionalProperties: unknown;
}

function shapeOf(schema: unknown): SchemaShape {
  const record = (schema ?? {}) as Record<string, unknown>;
  return {
    required: Array.isArray(record["required"]) ? (record["required"] as string[]) : [],
    properties:
      record["properties"] !== null && typeof record["properties"] === "object"
        ? (record["properties"] as Record<string, unknown>)
        : {},
    additionalProperties: record["additionalProperties"],
  };
}

/**
 * A function input schema is "broadened" when it accepts strictly more input:
 * required fields dropped, additionalProperties opened, or a property
 * constraint (pattern/enum) removed.
 */
export function isInputSchemaBroadened(before: unknown, after: unknown): boolean {
  const b = shapeOf(before);
  const a = shapeOf(after);
  if (b.required.some((field) => !a.required.includes(field))) {
    return true;
  }
  if (b.additionalProperties === false && a.additionalProperties !== false) {
    return true;
  }
  for (const [name, beforeProperty] of Object.entries(b.properties)) {
    const afterProperty = a.properties[name];
    if (afterProperty === undefined || afterProperty === null) {
      continue;
    }
    const beforeRecord = beforeProperty as Record<string, unknown>;
    const afterRecord = afterProperty as Record<string, unknown>;
    if (beforeRecord["pattern"] !== undefined && afterRecord["pattern"] === undefined) {
      return true;
    }
    if (beforeRecord["enum"] !== undefined && afterRecord["enum"] === undefined) {
      return true;
    }
  }
  return false;
}

/** Incompatible: previously accepted inputs may now be rejected, or outputs changed shape. */
export function isInputSchemaIncompatible(before: unknown, after: unknown): boolean {
  const b = shapeOf(before);
  const a = shapeOf(after);
  if (a.required.some((field) => !b.required.includes(field))) {
    return true;
  }
  return Object.keys(b.properties).some((name) => !(name in a.properties));
}

function change(
  partial: Omit<SemanticChange, "breaking"> & { breaking?: boolean },
): SemanticChange {
  return { breaking: false, ...partial };
}

const GUARDRAIL_PII_ORDER: Record<string, number> = {
  deny: 2,
  redact: 1,
  "allow-by-policy": 0,
};

export function diffManifests(
  before: ManifestSnapshot,
  after: ManifestSnapshot,
): SemanticDiffResult {
  const changes: SemanticChange[] = [];
  const b = before.manifest;
  const a = after.manifest;

  // metadata
  for (const key of [
    "name",
    "description",
    "workspaceId",
    "agentId",
    "labels",
    "annotations",
  ] as const) {
    if (!sameJson(b.metadata[key], a.metadata[key])) {
      changes.push(
        change({
          path: `metadata.${key}`,
          category: "metadata",
          operation:
            b.metadata[key] === undefined
              ? "add"
              : a.metadata[key] === undefined
                ? "remove"
                : "replace",
          before: b.metadata[key],
          after: a.metadata[key],
          severity: "info",
          reason: `Agent metadata field "${key}" changed.`,
        }),
      );
    }
  }

  // persona
  if (!sameJson(b.spec.persona ?? null, a.spec.persona ?? null)) {
    const beforeVoice = artifactHash(before, b.spec.persona?.brandVoice);
    const afterVoice = artifactHash(after, a.spec.persona?.brandVoice);
    const contentChanged =
      beforeVoice !== afterVoice ||
      !sameJson({ ...b.spec.persona, brandVoice: null }, { ...a.spec.persona, brandVoice: null });
    if (contentChanged) {
      changes.push(
        change({
          path: "spec.persona",
          category: "metadata",
          operation: b.spec.persona ? (a.spec.persona ? "replace" : "remove") : "add",
          severity: "low",
          reason: "Persona or brand voice changed.",
        }),
      );
    }
  }

  // instructions
  if (artifactHash(before, b.spec.instructions) !== artifactHash(after, a.spec.instructions)) {
    changes.push(
      change({
        path: "spec.instructions",
        category: "instructions",
        operation: "replace",
        severity: "medium",
        reason: "Agent operating instructions content changed.",
      }),
    );
  }

  // model
  if (b.spec.model.modelId !== a.spec.model.modelId) {
    changes.push(
      change({
        path: "spec.model.modelId",
        category: "model",
        operation: "replace",
        before: b.spec.model.modelId,
        after: a.spec.model.modelId,
        severity: "high",
        breaking: true,
        reason: "Model identity changed; behavior is not comparable without re-evaluation.",
      }),
    );
  }
  for (const key of ["temperature", "maxOutputTokens", "reasoning", "responseFormat"] as const) {
    if (!sameJson(b.spec.model[key], a.spec.model[key])) {
      changes.push(
        change({
          path: `spec.model.${key}`,
          category: "model",
          operation: "replace",
          before: b.spec.model[key],
          after: a.spec.model[key],
          severity: "medium",
          reason: `Model parameter "${key}" changed.`,
        }),
      );
    }
  }

  // name-keyed collections
  diffNamedCollection(changes, "skill", "spec.skills", b.spec.skills ?? [], a.spec.skills ?? [], {
    onAdd: () => ({ severity: "medium", reason: "Skill added to the agent." }),
    onRemove: () => ({
      severity: "medium",
      breaking: true,
      reason: "Skill removed from the agent.",
    }),
    onReplace: () => ({ severity: "medium", reason: "Skill configuration changed." }),
  });

  diffFunctions(changes, b.spec.functions ?? [], a.spec.functions ?? []);

  diffNamedCollection(
    changes,
    "knowledge",
    "spec.knowledge",
    b.spec.knowledge ?? [],
    a.spec.knowledge ?? [],
    {
      onAdd: () => ({ severity: "medium", reason: "Knowledge pack added." }),
      onRemove: () => ({
        severity: "high",
        breaking: true,
        reason: "Knowledge removal changes what the agent can answer (high-risk rule).",
      }),
      onReplace: () => ({
        severity: "medium",
        reason: "Knowledge pack or retrieval settings changed.",
      }),
    },
  );

  diffNamedCollection(
    changes,
    "integration",
    "spec.integrations",
    b.spec.integrations ?? [],
    a.spec.integrations ?? [],
    {
      onAdd: () => ({
        severity: "high",
        reason: "New external integration expands the agent's reach (high-risk rule).",
      }),
      onRemove: () => ({ severity: "medium", breaking: true, reason: "Integration removed." }),
      onReplace: () => ({ severity: "high", reason: "Integration configuration changed." }),
    },
  );

  diffEscalation(changes, b, a);
  diffGuardrails(changes, b, a);

  // evaluations
  if (!sameJson(b.spec.evaluations ?? null, a.spec.evaluations ?? null)) {
    changes.push(
      change({
        path: "spec.evaluations",
        category: "evaluation",
        operation: b.spec.evaluations ? (a.spec.evaluations ? "replace" : "remove") : "add",
        severity: "medium",
        reason: "Evaluation configuration changed.",
      }),
    );
  }

  // deployment
  if (b.spec.deployment?.defaultEnvironment !== a.spec.deployment?.defaultEnvironment) {
    changes.push(
      change({
        path: "spec.deployment.defaultEnvironment",
        category: "deployment",
        operation: "replace",
        before: b.spec.deployment?.defaultEnvironment,
        after: a.spec.deployment?.defaultEnvironment,
        severity: "medium",
        reason: "Default deployment environment changed.",
      }),
    );
  }
  if (b.spec.deployment?.releasePolicy !== a.spec.deployment?.releasePolicy) {
    changes.push(
      change({
        path: "spec.deployment.releasePolicy",
        category: "deployment",
        operation: "replace",
        before: b.spec.deployment?.releasePolicy,
        after: a.spec.deployment?.releasePolicy,
        severity: "high",
        reason: "Deployment policy reference changed (high-risk rule).",
      }),
    );
  }

  changes.sort(
    (x, y) =>
      x.category.localeCompare(y.category) ||
      x.path.localeCompare(y.path) ||
      x.operation.localeCompare(y.operation),
  );
  return { changes, risk: maxRisk(changes) };
}

interface CollectionHandlers {
  onAdd: () => { severity: Severity; breaking?: boolean; reason: string };
  onRemove: () => { severity: Severity; breaking?: boolean; reason: string };
  onReplace: () => { severity: Severity; breaking?: boolean; reason: string };
}

function diffNamedCollection<T extends { name: string }>(
  changes: SemanticChange[],
  category: SemanticChange["category"],
  basePath: string,
  before: readonly T[],
  after: readonly T[],
  handlers: CollectionHandlers,
): void {
  const beforeByName = new Map(before.map((item) => [item.name, item]));
  const afterByName = new Map(after.map((item) => [item.name, item]));
  for (const [name, beforeItem] of beforeByName) {
    const afterItem = afterByName.get(name);
    if (afterItem === undefined) {
      const outcome = handlers.onRemove();
      changes.push(
        change({
          path: `${basePath}[${name}]`,
          category,
          operation: "remove",
          before: beforeItem,
          severity: outcome.severity,
          breaking: outcome.breaking ?? false,
          reason: outcome.reason,
          affectedCapabilities: [name],
        }),
      );
    } else if (!sameJson(beforeItem, afterItem)) {
      const outcome = handlers.onReplace();
      changes.push(
        change({
          path: `${basePath}[${name}]`,
          category,
          operation: "replace",
          before: beforeItem,
          after: afterItem,
          severity: outcome.severity,
          breaking: outcome.breaking ?? false,
          reason: outcome.reason,
          affectedCapabilities: [name],
        }),
      );
    }
  }
  for (const [name, afterItem] of afterByName) {
    if (!beforeByName.has(name)) {
      const outcome = handlers.onAdd();
      changes.push(
        change({
          path: `${basePath}[${name}]`,
          category,
          operation: "add",
          after: afterItem,
          severity: outcome.severity,
          breaking: outcome.breaking ?? false,
          reason: outcome.reason,
          affectedCapabilities: [name],
        }),
      );
    }
  }
}

function diffFunctions(
  changes: SemanticChange[],
  before: readonly FunctionDefinition[],
  after: readonly FunctionDefinition[],
): void {
  const beforeByName = new Map(before.map((item) => [item.name, item]));
  const afterByName = new Map(after.map((item) => [item.name, item]));

  for (const [name, beforeFn] of beforeByName) {
    const afterFn = afterByName.get(name);
    const path = `spec.functions[${name}]`;
    if (afterFn === undefined) {
      changes.push(
        change({
          path,
          category: "function",
          operation: "remove",
          before: beforeFn,
          severity: "medium",
          breaking: true,
          reason: "Function removed; the agent loses this capability.",
          affectedCapabilities: [name],
        }),
      );
      continue;
    }
    if (sameJson(beforeFn, afterFn)) {
      continue;
    }

    if (isInputSchemaBroadened(beforeFn.inputSchema, afterFn.inputSchema)) {
      changes.push(
        change({
          path: `${path}.inputSchema`,
          category: "function",
          operation: "replace",
          severity: "high",
          breaking: true,
          reason:
            "Function input schema broadened; the function accepts more input (high-risk rule).",
          affectedCapabilities: [name],
        }),
      );
    } else if (isInputSchemaIncompatible(beforeFn.inputSchema, afterFn.inputSchema)) {
      changes.push(
        change({
          path: `${path}.inputSchema`,
          category: "function",
          operation: "replace",
          severity: "high",
          breaking: true,
          reason:
            "Function input schema is incompatible with previously accepted input (high-risk rule).",
          affectedCapabilities: [name],
        }),
      );
    } else if (!sameJson(beforeFn.inputSchema, afterFn.inputSchema)) {
      changes.push(
        change({
          path: `${path}.inputSchema`,
          category: "function",
          operation: "replace",
          severity: "medium",
          reason: "Function input schema changed.",
          affectedCapabilities: [name],
        }),
      );
    }

    if (beforeFn.requiresConfirmation === true && afterFn.requiresConfirmation !== true) {
      changes.push(
        change({
          path: `${path}.requiresConfirmation`,
          category: "function",
          operation: "replace",
          before: true,
          after: afterFn.requiresConfirmation ?? false,
          severity: "high",
          breaking: true,
          reason: "Confirmation requirement weakened (never below high per lifecycle framework).",
          affectedCapabilities: [name],
        }),
      );
    }

    if (!sameJson(beforeFn.handler, afterFn.handler)) {
      changes.push(
        change({
          path: `${path}.handler`,
          category: "function",
          operation: "replace",
          severity: "high",
          reason:
            "Function handler changed; external action authority may differ (high-risk rule).",
          affectedCapabilities: [name],
        }),
      );
    }

    const residual = { ...afterFn } as Record<string, unknown>;
    const residualBefore = { ...beforeFn } as Record<string, unknown>;
    for (const key of ["inputSchema", "handler", "requiresConfirmation"]) {
      delete residual[key];
      delete residualBefore[key];
    }
    if (!sameJson(residualBefore, residual)) {
      changes.push(
        change({
          path,
          category: "function",
          operation: "replace",
          severity: "medium",
          reason: "Function definition changed.",
          affectedCapabilities: [name],
        }),
      );
    }
  }

  for (const [name, afterFn] of afterByName) {
    if (!beforeByName.has(name)) {
      changes.push(
        change({
          path: `spec.functions[${name}]`,
          category: "function",
          operation: "add",
          after: afterFn,
          severity: "high",
          reason: "New function grants the agent a new action capability.",
          affectedCapabilities: [name],
        }),
      );
    }
  }
}

function diffEscalation(
  changes: SemanticChange[],
  b: RaiaAgentManifest,
  a: RaiaAgentManifest,
): void {
  const before = b.spec.escalation;
  const after = a.spec.escalation;
  if (sameJson(before ?? null, after ?? null)) {
    return;
  }
  const removed =
    (before?.enabled === true && (after === undefined || after.enabled === false)) ||
    (before !== undefined && after === undefined);
  if (removed) {
    changes.push(
      change({
        path: "spec.escalation",
        category: "escalation",
        operation: after === undefined ? "remove" : "replace",
        severity: "high",
        breaking: true,
        reason: "Escalation removed or disabled (never below high per lifecycle framework).",
      }),
    );
    return;
  }
  const conditionsShrunk =
    (before?.conditions?.length ?? 0) > (after?.conditions?.length ?? 0) ||
    (before?.destinations?.length ?? 0) > (after?.destinations?.length ?? 0);
  changes.push(
    change({
      path: "spec.escalation",
      category: "escalation",
      operation: before === undefined ? "add" : "replace",
      severity: conditionsShrunk ? "high" : "medium",
      breaking: conditionsShrunk,
      reason: conditionsShrunk
        ? "Escalation conditions or destinations narrowed (high-risk rule)."
        : "Escalation configuration changed.",
    }),
  );
}

function diffGuardrails(
  changes: SemanticChange[],
  b: RaiaAgentManifest,
  a: RaiaAgentManifest,
): void {
  const before = b.spec.guardrails;
  const after = a.spec.guardrails;
  if (sameJson(before ?? null, after ?? null)) {
    return;
  }
  if (before !== undefined && after === undefined) {
    changes.push(
      change({
        path: "spec.guardrails",
        category: "guardrail",
        operation: "remove",
        severity: "high",
        breaking: true,
        reason: "Guardrails removed (never below high per lifecycle framework).",
      }),
    );
    return;
  }
  const weakened =
    (before?.policyPacks?.length ?? 0) > (after?.policyPacks?.length ?? 0) ||
    (before?.blockedTopics?.length ?? 0) > (after?.blockedTopics?.length ?? 0) ||
    (GUARDRAIL_PII_ORDER[before?.piiHandling ?? "allow-by-policy"] ?? 0) >
      (GUARDRAIL_PII_ORDER[after?.piiHandling ?? "allow-by-policy"] ?? 0) ||
    (before?.promptInjectionDefense === "strict" && after?.promptInjectionDefense !== "strict");
  changes.push(
    change({
      path: "spec.guardrails",
      category: "guardrail",
      operation: before === undefined ? "add" : "replace",
      severity: weakened ? "high" : "medium",
      breaking: weakened,
      reason: weakened
        ? "Guardrail protection weakened (high-risk rule)."
        : "Guardrail configuration changed.",
    }),
  );
}
