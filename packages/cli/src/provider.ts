/**
 * Provider construction for the CLI, behind one boundary (build spec
 * section 16): the filesystem mock for local-first work, and the HTTP client
 * for the proposed management contract. The HTTP provider only ever targets
 * the two pinned regional endpoints or an apiBaseUrl recorded explicitly in
 * the project binding — and its credential comes from RAIA_ACCESS_TOKEN,
 * never an Agent Secret Key.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ProviderError, type ManagementProvider, type OperationContext } from "@raia/contracts";
import { MockManagementProvider } from "@raia/provider-mock";
import { HttpManagementProvider, managementCredentialFromEnv } from "@raia/provider-http";
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
      `Unsupported provider "${providerName}". \`raia init\` supports: mock. ` +
        "(The http provider is selected via the project binding once a management endpoint exists.)",
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

export function createHttpProvider(
  binding: Pick<ProjectBinding, "region" | "apiBaseUrl">,
  env: Record<string, string | undefined> = process.env,
): HttpManagementProvider {
  const credential = managementCredentialFromEnv(env);
  if (credential === undefined) {
    throw new ProviderError(
      "The http provider requires a management credential: set RAIA_ACCESS_TOKEN " +
        "(a workspace-scoped service token — never an Agent Secret Key).",
      "AUTHENTICATION_REQUIRED",
    );
  }
  const region = binding.region === "eu" ? "eu" : "us";
  return new HttpManagementProvider({
    credential,
    region,
    // The binding's apiBaseUrl is explicit operator configuration recorded in
    // .raia/project.json; an empty value uses the pinned regional endpoint.
    ...(binding.apiBaseUrl !== "" ? { baseUrl: binding.apiBaseUrl } : {}),
  });
}

export function providerForBinding(
  projectRoot: string,
  binding: ProjectBinding,
): ManagementProvider {
  if (binding.provider === "http") {
    return createHttpProvider(binding);
  }
  return createProvider(projectRoot, binding.provider);
}
