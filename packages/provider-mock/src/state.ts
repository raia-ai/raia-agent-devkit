/**
 * Atomic JSON state store for the mock provider (build spec section 17).
 * All writes go to a sibling temporary file and are renamed into place.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentBundle,
  AgentSummary,
  Deployment,
  DeploymentState,
  Draft,
  ReleaseCandidate,
  Trace,
  Workspace,
} from "@raia/contracts";

export interface StoredAgent {
  summary: AgentSummary;
  versions: Record<string, AgentBundle>;
}

export interface StoredDeployment {
  deployment: Deployment;
  /** Deterministic progression; each poll advances one step. */
  plan: DeploymentState[];
  planIndex: number;
}

export interface IdempotencyRecord {
  operation: string;
  requestSha256: string;
  response: unknown;
}

export interface MockState {
  stateVersion: 1;
  counters: Record<string, number>;
  workspaces: Workspace[];
  agents: Record<string, StoredAgent>;
  drafts: Record<string, Draft>;
  releases: Record<string, ReleaseCandidate>;
  deployments: Record<string, StoredDeployment>;
  idempotency: Record<string, IdempotencyRecord>;
  /** Raw traces as the platform stored them; redaction happens on read. */
  traces: Record<string, Trace>;
}

export function emptyState(): MockState {
  return {
    stateVersion: 1,
    counters: {},
    workspaces: [],
    agents: {},
    drafts: {},
    releases: {},
    deployments: {},
    idempotency: {},
    traces: {},
  };
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
      const parsed = JSON.parse(raw) as Partial<MockState>;
      // Older state files may predate the mutation stores; default them.
      return { ...emptyState(), ...parsed };
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
