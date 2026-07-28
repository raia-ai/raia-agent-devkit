# Implementation Status

Updated at the end of every work package per the build specification (§28).
A gate is complete only with a recorded command and result.

All commands below were run from a clean checkout on Linux, Node.js 22, pnpm 10.33.0,
on 2026-07-28. CI (`.github/workflows/ci.yml`) repeats them on Node 20.x and 22.x.

## WP0 — Foundation

| Gate                                                       | Status      | Evidence                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight verifies packaged checksums                      | ✅ complete | `pnpm preflight` → "Specification package preflight passed: 36 files verified."                                                                                                                    |
| Fresh checkout installs with pnpm on Node 20+              | ✅ complete | `pnpm install` → "Done"; engines `>=20`, `packageManager pnpm@10.33.0`                                                                                                                             |
| Format, lint, type check, build, test from root scripts    | ✅ complete | `pnpm format:check` → all files pass; `pnpm lint` → 0 problems; `pnpm typecheck` → both packages Done; `pnpm build` → ESM+DTS success ×2; `pnpm test` → 88/88 passed                               |
| Package boundaries prohibit internal cross-package imports | ✅ complete | ESLint `no-restricted-imports` + `packages/core/test/boundaries.test.ts` (import-scan allowlist; forbids `@raia/*/src/*`, network modules, provider/CLI/MCP imports)                               |
| CI runs on Linux (no skipped core tests)                   | ✅ complete | `.github/workflows/ci.yml`: preflight, install, contracts sync, generated drift, format, lint, typecheck, build, test on Node 20.x/22.x; macOS/Windows deferred to WP7 by comment, nothing skipped |
| Changesets and release-package infrastructure exist        | ✅ complete | `.changeset/config.json`; `.github/workflows/release.yml` builds and `pnpm pack`s both packages                                                                                                    |

## WP1 — Contracts and core

| Gate                                                                      | Status      | Evidence                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All supplied JSON Schemas pass metaschema validation                      | ✅ complete | `packages/contracts/test/schemas.test.ts` (Ajv 2020-12 `validateSchema` + compile, 5 schemas) — part of `pnpm test` 88/88                                                                                                                                                     |
| Types generated from schemas; CI detects drift                            | ✅ complete | `pnpm generate` writes `packages/contracts/src/generated/`; `pnpm generate:check` → "Generated types match the schemas."; wired into CI                                                                                                                                       |
| Helpdesk manifest and every referenced file load                          | ✅ complete | `packages/core/test/manifest.test.ts` — loads example, resolves `prompts/system.md` and `prompts/brand-voice.md`; suites/fixtures/policy load in `validation.test.ts`                                                                                                         |
| Canonical serialization and SHA-256 hashes deterministic                  | ✅ complete | `hash.test.ts` — sorted keys, array order preserved, LF normalization, `sha256:<64hex>`, key-order independence; YAML key-reorder keeps manifest hash stable (`manifest.test.ts`)                                                                                             |
| Candidate identity includes prompt, eval, fixture, policy, lock content   | ✅ complete | `lock-and-candidate.test.ts` — prompt, suite, fixture, policy, lock, and core-version changes each change `candidateSha256`                                                                                                                                                   |
| Duplicate named resources fail validation                                 | ✅ complete | `manifest.test.ts` (unit) + `validation.test.ts` (`DUPLICATE_NAME` finding, `ok: false`)                                                                                                                                                                                      |
| `../` traversal and symlink escape fail before reading target             | ✅ complete | `safe-paths.test.ts` — read-tracking FileSystem proves zero reads on `PATH_ESCAPE`; symlinked file and directory escapes; `validation.test.ts` covers both via manifest references                                                                                            |
| Raw secrets fail and are redacted everywhere                              | ✅ complete | `redaction.test.ts` (7 rule classes, allowlist for `env://`/`vault://`/`raia-secret://` + placeholders, findings carry no value, `DevkitError` self-redacts) + `validation.test.ts` (token in manifest and in prompt file → `SECRET_DETECTED`, result JSON contains no token) |
| Semantic diffs typed, risk-classified, stable, name-matched               | ✅ complete | `diff.test.ts` — typed `SemanticChange`, deterministic `(category, path, operation)` ordering, name-based matching (array reorder → no changes), instructions change classified `instructions`/`medium`                                                                       |
| Removed escalation/guardrails/knowledge, broadened function access ≥ high | ✅ complete | `diff.test.ts` — escalation disable, guardrail removal and weakening, knowledge removal, broadened input schema, weakened confirmation, new integration, model identity, deployment-policy change all `high` and risk-aggregated                                              |

## Architecture decisions

See `docs/adr/0001-wp0-wp1-toolchain-choices.md` (type generation tool, byte-synced
contract copies, boundary enforcement, canonical-JSON details, suite/fixture hashing,
secret ruleset, diff severity ladder, DI for node built-ins). One accommodation:
`noImplicitOverride` is off because the normative `provider-contract.ts` declares
`readonly name` without `override` and must not be edited locally.

## Known limitations

- Secret detection is deterministic pattern + entropy matching (rule set v1); it is a
  validation gate, not a guarantee. Rules are versioned for evidence.
- The lock file is parsed, hashed, and drift-checked; lock _generation_ arrives with the
  mock provider (WP2), so `validateProject` reports a missing lock as a warning.
- `policy`, `lifecycle`, and `reports` core modules are deferred to WP3/WP4 per the
  plan; no placeholder code exists for them.
- Coverage floors (90% core) are formally asserted in WP7 when the matrix lands; current
  suite is 88 tests across 10 files covering every WP1 gate including negatives.

## WP2 — Mock provider and CLI spine

| Gate                                                                                | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filesystem provider: discovery, export, versioning, ETags, pagination, typed errors | ✅ complete | `packages/provider-mock/test/mock-provider.test.ts` (9 tests): seed from fixture, complete 10-artifact bundle export, deterministic re-export, `NOT_FOUND`/`VALIDATION_FAILED`/`UNAVAILABLE` typed errors, version advance with new ETag and exportable history, opaque-cursor pagination, scope fixtures, outage simulation                                                        |
| `doctor`, `init`, `validate`, `diff`, `status` in human and JSON modes              | ✅ complete | `packages/cli/test/cli.test.ts` (14 tests) exercises every command in both modes; JSON mode emits exactly one parseable object per command and is deterministic for an unchanged project                                                                                                                                                                                            |
| CLI exit codes exactly match the specification                                      | ✅ complete | Contract tests: `0` success/help/version; `1` operational (`NOT_FOUND` provider state); `2` unknown provider/fixture/`--against`/command/flag, unbound project, preview-without-`--yes`, overwrite refusal; `3` validation failure (secret in prompt, token absent from output)                                                                                                     |
| Local writes atomic; no silent overwrites                                           | ✅ complete | `applyWrites` (temp + rename); modified `prompts/system.md` blocks re-init with exit `2` and file preserved; `--force` overwrites; unchanged re-init reports zero writes                                                                                                                                                                                                            |
| Golden path works with no credentials or network                                    | ✅ complete | In-process test `init → validate → diff → status` plus the built binary run: `node dist/bin.js init --provider mock --fixture …helpdesk-agent --yes` → 14 files; `validate` PASS with candidate hash; prompt edit → `diff` shows 1 `instructions`/medium change; `status` reports local drift YES / remote no. Manifest hash `sha256:b88c1f9b…` matches the WP1 golden test exactly |

Full-suite evidence after WP2: `pnpm test` → **112/112 across 13 files**; `pnpm typecheck`
→ 4/4 packages Done; `pnpm lint` → 0 problems; `pnpm format:check` → pass; `pnpm build`
→ 8/8 bundles; `pnpm contracts:check`, `pnpm generate:check`, `pnpm preflight` → pass.
WP2 decisions recorded in `docs/adr/0002-wp2-provider-and-cli-choices.md`.

## WP2 known limitations

- Mock lifecycle mutations (drafts, evaluations, releases, deployments, traces) fail
  closed with typed `UNAVAILABLE` until WP3/WP4 implement them.
- `raia pull`, `auth`, `plan`, `test`, `review`, `release`, `deploy`, `trace`, and
  `learn` are not yet implemented (WP3+ per the build spec).
- `--region`/`--api-base-url`/`--profile` are parsed and recorded in the binding but
  only meaningful for the HTTP provider (WP6).

## Next smallest vertical slice (WP3 — proposed, not started)

Fixture-mode evaluation engine: deterministic evaluators (`exact`, `contains`,
`regex`, `json-schema`, `tool-call`, `tool-not-called`, `latency`, `cost`,
`conversation-state`; `rubric` disabled without an evaluator provider), JSON/JUnit/
Markdown reports, baseline regression comparison, `raia test --mode fixture` and
`raia review`, with a blocking failure exiting `6`.
