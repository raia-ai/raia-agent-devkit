/**
 * Injectable filesystem boundary (build spec section 16: inject filesystem;
 * no process globals inside core logic).
 */
import { lstat, readFile, realpath } from "node:fs/promises";

export interface FileSystem {
  /** UTF-8 file read. */
  readFile(absolutePath: string): Promise<string>;
  /** Resolves symlinks to the real absolute path. */
  realpath(absolutePath: string): Promise<string>;
  /** True when the path exists (without following a final symlink). */
  exists(absolutePath: string): Promise<boolean>;
}

export const nodeFileSystem: FileSystem = {
  async readFile(absolutePath: string): Promise<string> {
    return readFile(absolutePath, "utf8");
  },
  async realpath(absolutePath: string): Promise<string> {
    return realpath(absolutePath);
  },
  async exists(absolutePath: string): Promise<boolean> {
    try {
      await lstat(absolutePath);
      return true;
    } catch {
      return false;
    }
  },
};
