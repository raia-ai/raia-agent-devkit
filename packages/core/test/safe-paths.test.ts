import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeFileSystem, resolveProjectPath, type FileSystem } from "../src/index.js";
import { DevkitError } from "../src/errors.js";

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "raia-safe-paths-"));
  root = path.join(base, "project");
  outside = path.join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "inside.txt"), "inside");
  await writeFile(path.join(outside, "secret.txt"), "TOP-SECRET-CONTENT");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A FileSystem that records reads so tests can prove nothing was read. */
function readTrackingFs(): { fs: FileSystem; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    fs: {
      async readFile(absolutePath) {
        reads.push(absolutePath);
        return nodeFileSystem.readFile(absolutePath);
      },
      realpath: nodeFileSystem.realpath,
      exists: nodeFileSystem.exists,
    },
  };
}

describe("resolveProjectPath", () => {
  it("resolves a normal in-root file", async () => {
    const resolved = await resolveProjectPath(root, "inside.txt", nodeFileSystem);
    expect(resolved.posixRelative).toBe("inside.txt");
  });

  it("rejects ../ traversal before reading the target", async () => {
    const { fs, reads } = readTrackingFs();
    await expect(resolveProjectPath(root, "../outside/secret.txt", fs)).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });
    expect(reads).toHaveLength(0);
  });

  it("rejects absolute paths", async () => {
    await expect(
      resolveProjectPath(root, path.join(outside, "secret.txt"), nodeFileSystem),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
  });

  it("rejects null bytes", async () => {
    await expect(resolveProjectPath(root, "a\0b", nodeFileSystem)).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });
  });

  it("rejects a symlink that escapes the project root, without reading it", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(root, "sneaky.txt"));
    const { fs, reads } = readTrackingFs();
    await expect(resolveProjectPath(root, "sneaky.txt", fs)).rejects.toMatchObject({
      code: "PATH_ESCAPE",
    });
    expect(reads).toHaveLength(0);
  });

  it("rejects a symlinked directory that escapes the root", async () => {
    await symlink(outside, path.join(root, "linkdir"));
    await expect(
      resolveProjectPath(root, "linkdir/secret.txt", nodeFileSystem),
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
  });

  it("reports missing files as REFERENCE_INVALID", async () => {
    await expect(resolveProjectPath(root, "missing.txt", nodeFileSystem)).rejects.toMatchObject({
      code: "REFERENCE_INVALID",
    });
  });

  it("never places the escape target's content in the error", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(root, "sneaky.txt"));
    try {
      await resolveProjectPath(root, "sneaky.txt", nodeFileSystem);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DevkitError);
      expect(JSON.stringify(error)).not.toContain("TOP-SECRET-CONTENT");
    }
  });
});
