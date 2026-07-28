/**
 * Provider construction for the CLI. WP2 supports the mock provider only;
 * the HTTP management provider arrives in WP6 behind the same boundary.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ManagementProvider, OperationContext } from "@raia/contracts";
import { MockManagementProvider } from "@raia/provider-mock";
import { UsageError } from "./exit-codes.js";
import { mockStateDir, type ProjectBinding } from "./project-files.js";

export function operationContext(): OperationContext {
  return { requestId: `req_${randomUUID()}` };
}

interface MockConfig {
  scopes?: string[];
  deploymentOutcome?: "healthy" | "failed";
}

/** Optional mock fixture configuration (permission and deployment fixtures). */
function readMockConfig(stateDir: string): MockConfig {
  const configPath = path.join(stateDir, "config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as MockConfig;
}

export function createProvider(
  projectRoot: string,
  providerName: string,
): ManagementProvider & MockManagementProvider {
  if (providerName !== "mock") {
    throw new UsageError(
      `Unsupported provider "${providerName}". The MVP work package supports: mock.`,
    );
  }
  const stateDir = mockStateDir(projectRoot);
  const config = readMockConfig(stateDir);
  return new MockManagementProvider({
    stateDir,
    ...(config.scopes !== undefined ? { scopes: config.scopes } : {}),
    ...(config.deploymentOutcome !== undefined
      ? { deploymentOutcome: config.deploymentOutcome }
      : {}),
  });
}

export function providerForBinding(
  projectRoot: string,
  binding: ProjectBinding,
): ManagementProvider & MockManagementProvider {
  return createProvider(projectRoot, binding.provider);
}
