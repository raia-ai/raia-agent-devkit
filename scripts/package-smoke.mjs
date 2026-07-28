// WP7 clean-install smoke test (build spec section 27): verify the packed
// artifacts against SHA256SUMS, install the CLI tarball into a fresh
// temporary project with npm (workspace deps satisfied from the local
// tarballs via overrides — the registry has no @raia packages), then run the
// installed `raia` binary and the standalone plugin bundle end to end
// against a freshly initialized mock project.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "dist-artifacts");
const fixtureDir = path.join(repoRoot, "docs", "raia-devkit-spec", "examples", "helpdesk-agent");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
  if (result.status !== 0 && !options.allowFailure) {
    console.error(`${command} ${args.join(" ")} failed (${result.status}):`);
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    process.exit(1);
  }
  return result;
}

// 1. Checksum verification: recompute every artifact digest.
const sums = (await readFile(path.join(artifactDir, "SHA256SUMS"), "utf8")).trim().split("\n");
for (const line of sums) {
  const [expected, name] = line.split(/\s+/);
  const actual = createHash("sha256")
    .update(await readFile(path.join(artifactDir, name)))
    .digest("hex");
  if (actual !== expected) {
    console.error(`Checksum mismatch for ${name}`);
    process.exit(1);
  }
}
console.log(`checksums verified for ${sums.length} artifacts`);

const tarballs = (await readdir(artifactDir)).filter(
  (name) => name.startsWith("raia-") && name.endsWith(".tgz"),
);
const byPackage = {};
for (const name of tarballs) {
  const match = /^raia-([a-z-]+)-\d+\.\d+\.\d+\.tgz$/.exec(name);
  if (match !== null && match[1] !== "claude-code-plugin") {
    byPackage[`@raia/${match[1]}`] = name;
  }
}

const workDir = await mkdtemp(path.join(tmpdir(), "raia-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
try {
  // 2. Clean temporary project: install the CLI tarball; every @raia
  // dependency resolves to its local tarball through overrides.
  const overrides = Object.fromEntries(
    Object.entries(byPackage)
      // The CLI itself is the direct dependency; overriding it too is an
      // npm EOVERRIDE conflict.
      .filter(([pkg]) => pkg !== "@raia/cli")
      .map(([pkg, file]) => [pkg, `file:${path.join(artifactDir, file)}`]),
  );
  await writeFile(
    path.join(workDir, "package.json"),
    JSON.stringify({ name: "raia-smoke", private: true, overrides }, null, 2),
  );
  run(npm, ["install", "--no-audit", "--no-fund", path.join(artifactDir, byPackage["@raia/cli"])], {
    cwd: workDir,
  });
  console.log("npm clean install ok");

  // 3. Run the installed binary through the golden path start.
  const binName = process.platform === "win32" ? "raia.cmd" : "raia";
  const raia = path.join(workDir, "node_modules", ".bin", binName);
  const projectDir = path.join(workDir, "agent-project");
  await mkdir(projectDir, { recursive: true });
  const runCli = (args) =>
    run(raia, ["--json", ...args], { cwd: projectDir, shell: process.platform === "win32" });
  const init = JSON.parse(runCli(["init", "--fixture", fixtureDir, "--yes"]).stdout);
  if (init.ok !== true) {
    console.error("init failed", init);
    process.exit(1);
  }
  const validate = JSON.parse(runCli(["validate"]).stdout);
  const test = JSON.parse(runCli(["test"]).stdout);
  if (validate.ok !== true || test.ok !== true) {
    console.error("validate/test failed", { validate: validate.ok, test: test.ok });
    process.exit(1);
  }
  console.log("installed CLI golden-path start ok (init → validate → test)");

  // 4. Standalone plugin artifact: extract and exercise both bundles.
  const pluginTgz = tarballs.find((name) => name.startsWith("raia-claude-code-plugin-"));
  const pluginDir = path.join(workDir, "plugin");
  await mkdir(pluginDir, { recursive: true });
  run("tar", ["-xzf", path.join(artifactDir, pluginTgz), "-C", pluginDir]);
  const bundledCli = path.join(pluginDir, "claude-code", "dist", "cli.js");
  const doctor = run(process.execPath, [bundledCli, "--json", "doctor"], {
    cwd: projectDir,
    allowFailure: true,
  });
  JSON.parse(doctor.stdout); // must be valid JSON regardless of check results
  console.log("standalone plugin bundle runs from the extracted artifact");
} finally {
  await rm(workDir, { recursive: true, force: true });
}
console.log("package smoke test passed");
