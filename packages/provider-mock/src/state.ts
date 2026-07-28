/**
 * Atomic JSON state store for the mock provider (build spec section 17).
 * All writes go to a sibling temporary file and are renamed into place.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBundle, AgentSummary, Workspace } from "@raia/contracts";

export interface StoredAgent {
  summary: AgentSummary;
  versions: Record<string, AgentBundle>;
}

export interface MockState {
  stateVersion: 1;
  counters: Record<string, number>;
  workspaces: Workspace[];
  agents: Record<string, StoredAgent>;
}

export function emptyState(): MockState {
  return { stateVersion: 1, counters: {}, workspaces: [], agents: {} };
}

export class StateStore {
  readonly #file: string;

  constructor(rootDir: string) {
    this.#file = path.join(rootDir, "state.json");
  }

  get file(): string {
    return this.#file;
  }

  async read(): Promise<MockState> {
    try {
      const raw = await readFile(this.#file, "utf8");
      return JSON.parse(raw) as MockState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  async write(state: MockState): Promise<void> {
    const dir = path.dirname(this.#file);
    await mkdir(dir, { recursive: true });
    const temp = path.join(dir, `.state.json.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
    await rename(temp, this.#file);
  }

  async update<T>(mutate: (state: MockState) => T | Promise<T>): Promise<T> {
    const state = await this.read();
    const result = await mutate(state);
    await this.write(state);
    return result;
  }
}
