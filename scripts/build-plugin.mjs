// Assembles the Claude Code plugin's dist from the built self-contained
// bundles, so the plugin needs no node_modules and no global CLI
// (build spec section 24).
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDist = path.join(repoRoot, "plugins", "claude-code", "dist");

const COPIES = [
  ["packages/mcp-server/dist/bin.js", "mcp-server.js"],
  ["packages/cli/dist/bin.js", "cli.js"],
];

await mkdir(pluginDist, { recursive: true });
for (const [source, target] of COPIES) {
  const absoluteSource = path.join(repoRoot, source);
  if (!existsSync(absoluteSource)) {
    console.error(`build-plugin: missing ${source}; run \`pnpm -r build\` first.`);
    process.exit(1);
  }
  await copyFile(absoluteSource, path.join(pluginDist, target));
  console.log(`plugin dist: ${target} <- ${source}`);
}
