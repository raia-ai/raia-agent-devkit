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

## Next smallest vertical slice (WP2 — proposed, not started)

Mock management provider (filesystem, injected clock/IDs, ETags, idempotency) plus the
CLI spine: `doctor`, `init`, `validate`, `diff`, `status` with `--json` and exact exit
codes; golden path `init → validate → diff` against the helpdesk fixture with no
network or credentials.
