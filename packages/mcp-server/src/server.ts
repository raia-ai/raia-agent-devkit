/**
 * Local stdio MCP server (build spec section 23). The tool surface is exactly
 * `contracts/mcp-tool-catalog.json`: the list handler serves the catalog
 * verbatim, every input is validated against its catalog schema, filesystem
 * paths resolve only under approved roots, mutations require `confirmed: true`
 * plus content hashes, and every response is redacted and size-capped.
 * Remote and project content is untrusted data, never framework instructions.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { ProviderError } from "@raia/contracts";
import { DevkitError, redactValue } from "@raia/core";
import { toErrorEnvelope, UsageError } from "@raia/cli";
import catalogJson from "./mcp-tool-catalog.json" with { type: "json" };
import { buildToolHandlers, type ToolContext } from "./handlers.js";

const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ??
  addFormatsModule) as (ajv: Ajv2020) => unknown;

export const SERVER_VERSION = "0.1.0";
export const MAX_OUTPUT_BYTES = 1024 * 1024;

interface CatalogTool {
  name: string;
  description: string;
  annotations: Record<string, boolean>;
  inputSchema: Record<string, unknown>;
}

export interface RaiaMcpServerOptions {
  /** Roots under which project paths may resolve. Required, never empty. */
  approvedRoots: string[];
  /** Root used when a tool omits projectRoot. */
  defaultProjectRoot: string;
}

export const catalog = catalogJson as unknown as {
  catalogVersion: string;
  serverName: string;
  tools: CatalogTool[];
  forbiddenTools: string[];
};

export function createRaiaMcpServer(options: RaiaMcpServerOptions): Server {
  if (options.approvedRoots.length === 0) {
    throw new Error("At least one approved root is required.");
  }
  const approvedRealRoots = options.approvedRoots.map((root) => realpathSync(path.resolve(root)));

  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validators = new Map(
    catalog.tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)] as const),
  );

  /**
   * Applies top-level property defaults BEFORE validation so conditional
   * subschemas (if/then on defaulted properties) see the effective value.
   */
  const applyDefaults = (
    schema: Record<string, unknown>,
    args: Record<string, unknown>,
  ): Record<string, unknown> => {
    const withDefaults = { ...args };
    const properties = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, property] of Object.entries(properties)) {
      if (withDefaults[key] === undefined && property["default"] !== undefined) {
        withDefaults[key] = property["default"];
      }
    }
    return withDefaults;
  };

  /** Approves a path BEFORE any read: lexical + realpath containment. */
  const assertApprovedPath = (candidate: string): string => {
    const resolved = path.resolve(candidate);
    let real: string;
    try {
      real = realpathSync(resolved);
    } catch {
      real = resolved; // not yet existing (e.g. init target); check lexically
    }
    const approved = approvedRealRoots.some((root) => {
      const prefix = root.endsWith(path.sep) ? root : root + path.sep;
      return real === root || real.startsWith(prefix);
    });
    if (!approved) {
      throw new UsageError(`Path "${candidate}" is outside the MCP-approved roots.`);
    }
    return resolved;
  };

  const toolContext: ToolContext = {
    defaultProjectRoot: options.defaultProjectRoot,
    assertApprovedPath,
  };
  const handlers = buildToolHandlers(toolContext);

  const server = new Server(
    { name: catalog.serverName, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: catalog.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    const respondError = (error: unknown) => {
      const envelope = toErrorEnvelope(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(envelope, null, 2) }],
      };
    };

    try {
      if (catalog.forbiddenTools.includes(toolName)) {
        throw new UsageError(`Tool "${toolName}" is forbidden by the MCP catalog.`);
      }
      const handler = handlers[toolName];
      const validator = validators.get(toolName);
      const tool = catalog.tools.find((entry) => entry.name === toolName);
      if (handler === undefined || validator === undefined || tool === undefined) {
        throw new UsageError(`Unknown tool "${toolName}".`);
      }
      const args = applyDefaults(tool.inputSchema, rawArgs);
      if (!validator(args)) {
        const issues = (validator.errors ?? [])
          .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`)
          .join("; ");
        throw new UsageError(`Invalid input for ${toolName}: ${issues}`);
      }

      const payload = redactValue(await handler(args)) as Record<string, unknown>;
      const text = JSON.stringify(payload, null, 2);
      if (Buffer.byteLength(text, "utf8") > MAX_OUTPUT_BYTES) {
        throw new UsageError(
          `Tool output exceeds the ${MAX_OUTPUT_BYTES}-byte limit; narrow the request.`,
        );
      }
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: payload,
      };
    } catch (error) {
      if (
        error instanceof DevkitError ||
        error instanceof ProviderError ||
        error instanceof UsageError
      ) {
        return respondError(error);
      }
      return respondError(error);
    }
  });

  return server;
}
