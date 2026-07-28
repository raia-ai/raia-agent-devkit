/**
 * Project file access: atomic writes, no silent overwrites, and the non-secret
 * project binding (build spec sections 11 and 20).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { UsageError } from "./exit-codes.js";

export const PROJECT_BINDING_PATH = ".raia/project.json";
export const MOCK_STATE_DIR = ".raia/mock";
export const VALIDATION_REPORT_PATH = "reports/latest/validation.json";

export interface ProjectBinding {
  schemaVersion: 1;
  /** "http" targets the proposed management contract and is opt-in via explicit binding edit. */
  provider: "mock" | "http";
  region: string;
  apiBaseUrl: string;
  workspaceId: string;
  agentId: string;
  defaultProfile: string;
}

export async function writeFileAtomic(absolutePath: string, content: string): Promise<void> {
  const dir = path.dirname(absolutePath);
  await mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(absolutePath)}.${process.pid}.tmp`);
  await writeFile(temp, content, "utf8");
  await rename(temp, absolutePath);
}

export async function readTextIfExists(absolutePath: string): Promise<string | undefined> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export interface PlannedWrite {
  relativePath: string;
  content: string;
}

/**
 * Applies writes atomically after checking for silent-overwrite conflicts:
 * an existing file with different content blocks the whole batch unless
 * `force` is set (and even then the caller preflights remote conflicts).
 */
export async function applyWrites(
  projectRoot: string,
  writes: PlannedWrite[],
  options: { force: boolean },
): Promise<{ written: string[]; skipped: string[] }> {
  const conflicts: string[] = [];
  const skipped: string[] = [];
  const pending: PlannedWrite[] = [];
  for (const write of writes) {
    const absolute = path.join(projectRoot, write.relativePath);
    const existing = await readTextIfExists(absolute);
    if (existing === undefined) {
      pending.push(write);
    } else if (existing === write.content) {
      skipped.push(write.relativePath);
    } else if (options.force) {
      pending.push(write);
    } else {
      conflicts.push(write.relativePath);
    }
  }
  if (conflicts.length > 0) {
    throw new UsageError(
      `Refusing to overwrite modified files: ${conflicts.join(", ")}. ` +
        "Review the differences, then re-run with --force to overwrite.",
    );
  }
  const written: string[] = [];
  for (const write of pending) {
    await writeFileAtomic(path.join(projectRoot, write.relativePath), write.content);
    written.push(write.relativePath);
  }
  return { written, skipped };
}

export async function readBinding(projectRoot: string): Promise<ProjectBinding | undefined> {
  const raw = await readTextIfExists(path.join(projectRoot, PROJECT_BINDING_PATH));
  if (raw === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as ProjectBinding;
  if (parsed.schemaVersion !== 1 || typeof parsed.agentId !== "string") {
    throw new UsageError(`${PROJECT_BINDING_PATH} is invalid; re-run \`raia init\`.`);
  }
  return parsed;
}

export function requireBindingSync(projectRoot: string): void {
  if (!existsSync(path.join(projectRoot, PROJECT_BINDING_PATH))) {
    throw new UsageError(
      "This directory is not a raia project (missing .raia/project.json). Run `raia init` first.",
    );
  }
}

export function mockStateDir(projectRoot: string): string {
  return path.join(projectRoot, MOCK_STATE_DIR);
}
