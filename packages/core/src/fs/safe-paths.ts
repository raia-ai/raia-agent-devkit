/**
 * Project-root path boundary (build spec sections 12.1 and 25). Every check runs
 * BEFORE the target file is read: lexical containment first, then realpath
 * containment so a symlink cannot escape the root.
 */
import path from "node:path";
import { DevkitError } from "../errors.js";
import type { FileSystem } from "./file-system.js";

export interface ResolvedProjectPath {
  /** Absolute path, safe to read. */
  absolutePath: string;
  /** Normalized POSIX-style path relative to the project root. */
  posixRelative: string;
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

export async function resolveProjectPath(
  projectRoot: string,
  reference: string,
  fs: FileSystem,
): Promise<ResolvedProjectPath> {
  if (reference.includes("\0")) {
    throw new DevkitError("PATH_ESCAPE", "Path reference contains a null byte.", {
      path: reference,
    });
  }
  if (path.isAbsolute(reference) || /^[A-Za-z]:[\\/]/.test(reference)) {
    throw new DevkitError("PATH_ESCAPE", "Absolute paths are not allowed in project references.", {
      path: reference,
    });
  }

  const normalized = path.normalize(reference);
  if (
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized.startsWith("../")
  ) {
    throw new DevkitError("PATH_ESCAPE", "Path reference escapes the project root.", {
      path: reference,
    });
  }

  const rootAbsolute = path.resolve(projectRoot);
  const candidate = path.resolve(rootAbsolute, normalized);
  const rootPrefix = rootAbsolute.endsWith(path.sep) ? rootAbsolute : rootAbsolute + path.sep;
  if (candidate !== rootAbsolute && !candidate.startsWith(rootPrefix)) {
    throw new DevkitError("PATH_ESCAPE", "Path reference escapes the project root.", {
      path: reference,
    });
  }

  if (!(await fs.exists(candidate))) {
    throw new DevkitError("REFERENCE_INVALID", "Referenced file does not exist.", {
      path: reference,
    });
  }

  // Symlink-escape protection: the real location of both the root and the file
  // must agree before any content is read.
  const realRoot = await fs.realpath(rootAbsolute);
  const realCandidate = await fs.realpath(candidate);
  const realRootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realCandidate !== realRoot && !realCandidate.startsWith(realRootPrefix)) {
    throw new DevkitError("PATH_ESCAPE", "Path reference resolves outside the project root.", {
      path: reference,
    });
  }

  return {
    absolutePath: realCandidate,
    posixRelative: toPosix(path.relative(rootAbsolute, candidate)),
  };
}
