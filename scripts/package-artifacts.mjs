// WP7 packaging (build spec section 27): produce the distributable artifact
// set — an npm tarball per public package plus the standalone Claude Code
// plugin archive — and a SHA256SUMS manifest covering every artifact.
// Requires a prior `pnpm build`. Output: dist-artifacts/.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist-artifacts");

const PUBLIC_PACKAGES = [
  "contracts",
  "core",
  "provider-mock",
  "provider-http",
  "conversation-client",
  "eval-engine",
  "cli",
  "mcp-server",
];

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    console.error(`${command} ${args.join(" ")} failed (${result.status}):`);
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    process.exit(1);
  }
  return result.stdout;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// npm package tarballs. pnpm rewrites workspace:* ranges to concrete versions
// at pack time and applies publishConfig exports (dist entry points).
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const name of PUBLIC_PACKAGES) {
  const packageDir = path.join(repoRoot, "packages", name);
  if (!existsSync(path.join(packageDir, "dist"))) {
    console.error(`packages/${name}/dist missing; run \`pnpm build\` first.`);
    process.exit(1);
  }
  run(pnpm, ["pack", "--pack-destination", outDir], packageDir);
  console.log(`packed @raia/${name}`);
}

// Standalone plugin artifact: the plugin directory including its assembled
// self-contained dist. tar ships with all supported CI operating systems
// (including Windows) and is not a Bash dependency.
const pluginVersion = JSON.parse(
  await readFile(
    path.join(repoRoot, "plugins", "claude-code", ".claude-plugin", "plugin.json"),
    "utf8",
  ),
).version;
if (!existsSync(path.join(repoRoot, "plugins", "claude-code", "dist", "mcp-server.js"))) {
  console.error("plugins/claude-code/dist missing; run `pnpm build` first.");
  process.exit(1);
}
const pluginArtifact = `raia-claude-code-plugin-${pluginVersion}.tgz`;
run(
  "tar",
  ["-czf", path.join(outDir, pluginArtifact), "-C", path.join(repoRoot, "plugins"), "claude-code"],
  repoRoot,
);
console.log(`packed ${pluginArtifact}`);

// SHA-256 checksum manifest over every artifact, sorted for determinism.
const artifacts = (await readdir(outDir)).filter((name) => name.endsWith(".tgz")).sort();
const lines = [];
for (const name of artifacts) {
  const digest = createHash("sha256")
    .update(await readFile(path.join(outDir, name)))
    .digest("hex");
  lines.push(`${digest}  ${name}`);
}
await writeFile(path.join(outDir, "SHA256SUMS"), lines.join("\n") + "\n");
console.log(`dist-artifacts: ${artifacts.length} artifacts + SHA256SUMS`);
