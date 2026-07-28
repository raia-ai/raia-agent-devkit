/**
 * `raia doctor` (build spec section 20): environment and project checks with
 * no side effects. Exit 0 when every check passes, 1 otherwise.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { describeRuntime, type RuntimeDescription } from "@raia/conversation-client";
import { loadManifest, MANIFEST_FILE_NAME, parseLock } from "@raia/core";
import { managementCredentialFromEnv } from "@raia/provider-http";
import { EXIT } from "../exit-codes.js";
import { emitResult, type CliIO, type GlobalFlags } from "../io.js";
import { readBinding, readTextIfExists, MOCK_STATE_DIR } from "../project-files.js";
import { operationContext, providerForBinding } from "../provider.js";

interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
}

export async function runDoctor(io: CliIO, flags: GlobalFlags): Promise<number> {
  const projectRoot = io.cwd;
  const checks: DoctorCheck[] = [];
  const add = (id: string, ok: boolean, message: string): void => {
    checks.push({ id, ok, message });
  };

  const [major] = process.versions.node.split(".");
  const nodeOk = Number(major) >= 20;
  add("node-version", nodeOk, `Node.js ${process.versions.node} (requires >= 20)`);

  const manifestPresent = existsSync(path.join(projectRoot, MANIFEST_FILE_NAME));
  add(
    "manifest-present",
    manifestPresent,
    manifestPresent ? `${MANIFEST_FILE_NAME} found` : `${MANIFEST_FILE_NAME} not found`,
  );

  if (manifestPresent) {
    try {
      const loaded = await loadManifest(projectRoot);
      add("manifest-schema", true, `manifest valid (${loaded.manifestSha256.slice(0, 19)}…)`);
    } catch (error) {
      add("manifest-schema", false, error instanceof Error ? error.message : String(error));
    }
  }

  const lockRaw = await readTextIfExists(path.join(projectRoot, "raia.lock.json"));
  if (lockRaw === undefined) {
    add("lock-present", false, "raia.lock.json not found (run `raia init`)");
  } else {
    try {
      parseLock(lockRaw);
      add("lock-present", true, "raia.lock.json valid");
    } catch (error) {
      add("lock-present", false, error instanceof Error ? error.message : String(error));
    }
  }

  let binding;
  try {
    binding = await readBinding(projectRoot);
    add(
      "binding-present",
      binding !== undefined,
      binding !== undefined
        ? `bound to ${binding.agentId} via ${binding.provider}`
        : ".raia/project.json not found (run `raia init`)",
    );
  } catch (error) {
    add("binding-present", false, error instanceof Error ? error.message : String(error));
  }

  if (binding !== undefined) {
    try {
      const provider = providerForBinding(projectRoot, binding);
      const identity = await provider.getIdentity(operationContext());
      add(
        "provider-reachable",
        true,
        `${binding.provider} provider reachable (principal ${identity.principalId}, ${identity.scopes.length} scopes)`,
      );
    } catch (error) {
      add("provider-reachable", false, error instanceof Error ? error.message : String(error));
    }
    add(
      "credentials",
      binding.provider === "mock" || managementCredentialFromEnv(process.env) !== undefined,
      binding.provider === "mock"
        ? "mock provider requires no credentials"
        : managementCredentialFromEnv(process.env) !== undefined
          ? "management credential present (RAIA_ACCESS_TOKEN; value not shown)"
          : "http provider needs RAIA_ACCESS_TOKEN (workspace-scoped service token)",
    );
  } else {
    add(
      "provider-reachable",
      false,
      existsSync(path.join(projectRoot, MOCK_STATE_DIR))
        ? "mock state present but no binding"
        : "no provider configured",
    );
  }

  // Conversation runtime report (build spec section 16): selected profile,
  // contract checksum, server, and auth scheme — never credential material.
  // Fixture mode needs no runtime, so an unavailable runtime is informational
  // unless the profile itself is misconfigured.
  const runtime: RuntimeDescription = describeRuntime({
    env: process.env,
    region: flags.region === "eu" ? "eu" : "us",
  });
  const runtimeSummary =
    `profile ${runtime.profile}` +
    (runtime.contractSha256 !== undefined
      ? `, contract sha256:${runtime.contractSha256.slice(0, 12)}…`
      : "") +
    (runtime.server !== undefined ? `, server ${runtime.server}` : "") +
    (runtime.authScheme !== undefined ? `, auth ${runtime.authScheme}` : "") +
    (runtime.available
      ? ", live evaluation available"
      : ` — live evaluation unavailable: ${runtime.unavailableReason ?? "not configured"}`);
  add(
    "conversation-runtime",
    runtime.available || runtime.unavailableReason?.startsWith("Unknown runtime profile") !== true,
    runtimeSummary,
  );

  const ok = checks.every((check) => check.ok);
  emitResult(io, flags, { ok, checks, runtime }, [
    `doctor: ${ok ? "all checks passed" : "problems found"}`,
    ...checks.map((check) => `  [${check.ok ? "ok" : "FAIL"}] ${check.id}: ${check.message}`),
  ]);
  return ok ? EXIT.OK : EXIT.OPERATIONAL;
}
