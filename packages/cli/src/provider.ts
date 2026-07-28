/**
 * Provider construction for the CLI. WP2 supports the mock provider only;
 * the HTTP management provider arrives in WP6 behind the same boundary.
 */
import { randomUUID } from "node:crypto";
import type { ManagementProvider, OperationContext } from "@raia/contracts";
import { MockManagementProvider } from "@raia/provider-mock";
import { UsageError } from "./exit-codes.js";
import { mockStateDir, type ProjectBinding } from "./project-files.js";

export function operationContext(): OperationContext {
  return { requestId: `req_${randomUUID()}` };
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
  return new MockManagementProvider({ stateDir: mockStateDir(projectRoot) });
}

export function providerForBinding(
  projectRoot: string,
  binding: ProjectBinding,
): ManagementProvider & MockManagementProvider {
  return createProvider(projectRoot, binding.provider);
}
