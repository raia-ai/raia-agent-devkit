#!/usr/bin/env node
/**
 * Stdio entry point. Approved roots default to the invocation directory; the
 * Claude plugin launches this with `--plugin-mode` (accepted, currently
 * equivalent to defaults).
 */
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRaiaMcpServer } from "./server.js";

const args = process.argv.slice(2);
const roots: string[] = [];
let projectRoot = process.cwd();
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--approved-root" && args[index + 1] !== undefined) {
    roots.push(args[index + 1]!);
    index += 1;
  } else if (args[index] === "--project-root" && args[index + 1] !== undefined) {
    projectRoot = args[index + 1]!;
    index += 1;
  }
  // --plugin-mode is accepted without additional behavior in this work package.
}
if (roots.length === 0) {
  roots.push(projectRoot);
}

const server = createRaiaMcpServer({ approvedRoots: roots, defaultProjectRoot: projectRoot });
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("raia MCP server listening on stdio\n");
