import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RaiaAgentLockFile } from "@raia/contracts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const HELPDESK_EXAMPLE = path.join(
  repoRoot,
  "docs",
  "raia-devkit-spec",
  "examples",
  "helpdesk-agent",
);

export interface ProjectFixture {
  root: string;
  cleanup: () => Promise<void>;
}

/** Copies the normative helpdesk example into a temp dir so tests can mutate it. */
export async function createHelpdeskFixture(): Promise<ProjectFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "raia-devkit-test-"));
  await cp(HELPDESK_EXAMPLE, root, { recursive: true });
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** A minimal schema-valid lock file for candidate-identity tests. */
export function buildLockFixture(manifestSha256: string): RaiaAgentLockFile {
  return {
    lockVersion: 1,
    manifestApiVersion: "devkit.raia.ai/v1alpha1",
    manifestSha256,
    generatedAt: "2026-07-28T00:00:00Z",
    generatedBy: { cliVersion: "0.1.0" },
    resolved: {
      model: {
        name: "provider/model-current",
        version: "1",
        checksum: "sha256:" + "a".repeat(64),
      },
      skills: [],
      functions: [],
      knowledge: [],
      integrations: [],
      policyPacks: [],
      evaluators: [],
    },
  } as RaiaAgentLockFile;
}
