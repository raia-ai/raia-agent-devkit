# ADR 0002 — WP2 choices not fixed by the specification

Status: accepted · Scope: WP2 (mock provider + CLI spine)

## 1. No separate `packages/provider` package yet

The repository layout in build spec §10 lists `packages/provider`, but the provider
boundary types already live in `@raia/contracts` (`provider-contract.ts`, normative).
Creating a package that would only re-export them violates the start prompt's
"no placeholder shells" rule. It will be introduced in WP6 if runtime-neutral provider
helpers (retry policy, context factories) emerge. Recorded so the deviation is explicit.

## 2. Mock operations for later work packages fail closed with typed `UNAVAILABLE`

WP2's acceptance scope for the mock is discovery, export, versioning, ETags,
pagination, and typed errors. The remaining `ManagementProvider` operations (drafts,
evaluation runs, releases, deployments, traces) throw
`ProviderError("... later work package", "UNAVAILABLE")` instead of returning fake
successes. This honors §7 "fail closed" and keeps the interface complete without
placeholder logic scattered in domain code (§31).

## 3. Local overwrite refusal exits `2`

§20 requires `pull`/`init` to refuse overwriting modified files; §20.1 reserves exit
`5` for remote conflicts (stale base, ETag, idempotency). A local dirty-file refusal is
resolved by the user reviewing and passing `--force`, which is usage guidance, so it
maps to exit `2`. Remote-drift conflicts keep exit `5` (WP4).

## 4. `init` preview requires `--yes` instead of an interactive prompt

Mutating commands need preview + confirmation (§20). WP2 ships no TTY prompt
machinery; `init` prints the exact write plan and stops with exit `2` until `--yes`
is passed (`--non-interactive` implies the same contract in CI). Interactive prompts
can be layered on in WP5+ without changing the flag contract.

## 5. Re-running `init` is a no-op despite the lock's `generatedAt`

`generatedAt` is informational and excluded from deterministic lock hashing (§12.2).
`init` keeps the existing lock file when the freshly generated lock has an identical
deterministic hash, so an unchanged project reports zero writes instead of a
timestamp-only conflict.

## 6. The CLI binary bundles its workspace dependencies

Workspace packages use development `exports` pointing at TypeScript sources (fast
tests, no build step), with `publishConfig` switching to `dist` on publish. A runnable
`dist/bin.js` cannot rely on either at runtime, so tsup bundles `@raia/*`, `ajv`,
`ajv-formats`, and `yaml` into the CLI output (with a `createRequire` banner for CJS
interop). `commander` remains a normal dependency. The library entry (`src/index.ts`)
is unaffected for consumers.

## 7. Mock state lives at `.raia/mock/` inside the project

The mock provider needs a caller-supplied root (§17). The CLI places it under
`.raia/mock/` so a project is fully self-contained and network-free, and `init` adds
it to a generated `.gitignore` (only when no `.gitignore` exists — an existing file is
never silently modified). `raia diff --against lock` re-exports the lock's base
version from this state.

## 8. Fixture resolution for `raia init --fixture`

`--fixture <value>` resolves in order: literal path, `examples/<value>`,
`docs/raia-devkit-spec/examples/<value>` — all relative to the invocation directory,
accepting the first candidate containing `raia.agent.yaml`. This makes the golden path
work from a spec-package checkout without inventing a fixture registry.
