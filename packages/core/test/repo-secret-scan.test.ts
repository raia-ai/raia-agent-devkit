/**
 * Deterministic secret scan over the repository's own source tree (build
 * spec section 27: CI runs secret scanning). Uses the same rule set that
 * gates agent projects, so the DevKit holds itself to its own standard.
 * Fixture files that intentionally CONSTRUCT secret-like strings at runtime
 * (e.g. via join()) pass because their source bytes contain no secret.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanForSecrets } from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCAN_ROOTS = ["packages", "apps", "plugins", "scripts", ".github"];
const SCAN_EXTENSIONS = new Set([".ts", ".mjs", ".js", ".json", ".yaml", ".yml", ".md"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "generated"]);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        yield* walk(path.join(dir, entry.name));
      }
      continue;
    }
    // The baseline file itself necessarily names the rules it reviews.
    if (
      SCAN_EXTENSIONS.has(path.extname(entry.name)) &&
      entry.name !== "repo-secret-scan.test.ts"
    ) {
      yield path.join(dir, entry.name);
    }
  }
}

/**
 * Reviewed false positives, gitleaks-baseline style: every entry has been
 * inspected and is either a TypeScript identifier the credential-assignment
 * rule cannot distinguish from a value (e.g. `credential: ManagementCredential`)
 * or a deliberate test vector proving redaction works. A finding NOT in this
 * list fails the scan; a stale entry (no longer matching) also fails, so the
 * baseline cannot rot.
 */
const REVIEWED_FALSE_POSITIVES = new Set([
  "packages/cli/src/provider.ts (credential-assignment)",
  "packages/cli/test/live-mode.test.ts (credential-assignment)",
  "packages/conversation-client/src/client.ts (credential-assignment)",
  "packages/conversation-client/src/runtime.ts (credential-assignment)",
  "packages/conversation-client/test/conversation-client.test.ts (credential-assignment)",
  "packages/conversation-client/test/live-executor.test.ts (credential-assignment)",
  "packages/core/test/error-paths.test.ts (credential-assignment)",
  "packages/core/test/error-paths.test.ts (private-key-block)",
  "packages/core/test/redaction.test.ts (credential-assignment)",
  "packages/core/test/redaction.test.ts (private-key-block)",
  "packages/provider-http/src/http-provider.ts (credential-assignment)",
]);

describe("repository secret scan", () => {
  it("finds nothing outside the reviewed false-positive baseline", async () => {
    const findings = new Set<string>();
    let scanned = 0;
    for (const root of SCAN_ROOTS) {
      for await (const file of walk(path.join(repoRoot, root))) {
        scanned += 1;
        const content = await readFile(file, "utf8");
        const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
        for (const finding of scanForSecrets(content, relative)) {
          findings.add(`${relative} (${finding.ruleId})`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    const unreviewed = [...findings].filter((key) => !REVIEWED_FALSE_POSITIVES.has(key));
    expect(unreviewed, "unreviewed secret-scan findings").toEqual([]);
    const stale = [...REVIEWED_FALSE_POSITIVES].filter((key) => !findings.has(key));
    expect(stale, "stale baseline entries").toEqual([]);
  });
});
