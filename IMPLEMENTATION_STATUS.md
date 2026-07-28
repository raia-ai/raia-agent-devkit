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

## WP3 — Evaluation vertical slice

| Gate                                                                | Status      | Evidence                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixture-mode smoke and regression suites execute deterministically  | ✅ complete | `packages/eval-engine/test/engine.test.ts`: pristine helpdesk suites pass 5/5; two runs produce identical results and identical JSON reports                                                                                                                   |
| All deterministic evaluator types implemented and tested            | ✅ complete | `exact`, `contains`, `regex` (length/quantifier/backreference limits), `json-schema` (separate Ajv, size caps), `tool-call`, `tool-not-called`, `latency`, `cost`, `conversation-state`, plus implicit critical `tool-policy` and `expected-states` assertions |
| Rubric disabled without an explicit evaluator provider              | ✅ complete | Rubric assertion → `skipped` with reason when no provider; injected fake provider scores and passes — proving pluggability                                                                                                                                     |
| JSON, JUnit XML, and Markdown reports emitted                       | ✅ complete | `raia test` writes `reports/latest/evaluation.{json,junit.xml,md}`; JUnit carries per-assertion `<failure>` with `type="critical"`; CLI test verifies byte-stability across runs apart from `startedAt`/`completedAt`                                          |
| Baseline comparison labels regressions/improvements/unchanged/flaky | ✅ complete | `compareRuns` + `raia test --baseline`; regression fixture labeled in `comparison.regressions`; reversed comparison labels the improvement; flaky via repetition-variant executor test                                                                         |
| Critical deterministic failure exits `6` regardless of pass rate    | ✅ complete | Spec scenario 6: corrupt `password-refusal.json` → gate fails with pass rate still 80% → `raia test` exits `6`                                                                                                                                                 |
| Live mode requires explicit selection, never default                | ✅ complete | Default mode is fixture; `--mode live` refused with typed `UNAVAILABLE` naming remote-conversation/model-cost implications (runtime arrives in WP6)                                                                                                            |
| `raia review` aggregates diff/validation/evaluation/risk/policy     | ✅ complete | Clean project + current evidence → READY, exit 0; missing evidence, stale candidate binding, and drift each produce named blockers and exit 3; review evidence hash stable across identical states                                                             |

Core gained the pure `policy` module (`evaluateReleasePolicy`, 8 tests) reused by
review and, in WP4, by release. Full suite after WP3: **141 tests across 16 files**;
typecheck 5/5 packages; lint 0; format clean; build 10/10 bundles. Built-binary golden
path now extends to `init → validate → test (5/5 PASS) → review (READY, risk low)`.
Decisions in `docs/adr/0003-wp3-evaluation-choices.md`.

## WP3 known limitations

- Live evaluation and hosted evaluation runs remain provider-gated (WP6); the mock's
  `createEvaluationRun` still fails closed with `UNAVAILABLE` — local fixture
  execution is authoritative per the build spec.
- Approval requirements above zero fail closed until approval records exist (WP4).
- Simulator-based conversations are recorded as skipped in fixture mode.

## WP4 — Release and staging

| Gate                                                                              | Status      | Evidence                                                                                                                                                                                          |
| --------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle transitions pure, exhaustive, deny invalid                              | ✅ complete | `packages/core/test/lifecycle.test.ts` checks every (from, to) pair of both state machines against the spec's transition lists; invalid transitions throw `INVALID_TRANSITION` and modify nothing |
| `.raia/workflow-state.json` schema-valid and atomic                               | ✅ complete | Save validates against the normative schema (invalid state refused), temp-file + rename writes; round-trip test                                                                                   |
| Candidate change invalidates prior evidence                                       | ✅ complete | `reconcileCandidate` unit tests + end-to-end: released project → prompt edit → stage DRAFT, evidence cleared, release blocked until fresh evidence; deploy refuses with "invalidated"             |
| Release policy checks exact candidate and evidence hashes                         | ✅ complete | Shared `aggregateReadiness` path (review = gate); evidence bound to a different candidate is a named blocker; `applyTransition` rejects mismatched evidence (`EVIDENCE_MISMATCH`)                 |
| Releases immutable                                                                | ✅ complete | No mutation API exists; reused key with altered hashes → `IDEMPOTENCY_MISMATCH` (scenario 7)                                                                                                      |
| Idempotent replay returns original result (scenario 8)                            | ✅ complete | Provider test: same key+payload → identical candidate; CLI: re-running `release create` returns the same `rc_1` with `alreadyReleased: true`                                                      |
| Changed payload + reused key → `IDEMPOTENCY_MISMATCH` (scenario 9)                | ✅ complete | Provider mutation test                                                                                                                                                                            |
| Stale base/ETag fails without state change, exit `5` (scenario 10)                | ✅ complete | Provider: baseVersionId and ETag mismatches → `STALE_BASE`; CLI test relaxes `requireNoDrift` to prove the provider-level guard exits `5` (readiness normally catches drift first at exit `3`)    |
| Staging deployment `QUEUED → DEPLOYING → HEALTHY` + rollback target (scenario 11) | ✅ complete | Deterministic one-step-per-poll progression; second deployment records the first as rollback target and supersedes it; failure fixture → `FAILED` → rollback → `ROLLED_BACK`                      |
| Missing scope exits `4` (scenario 13)                                             | ✅ complete | `.raia/mock/config.json` scope fixtures: release without `release:create` and deploy without `deployment:promote` both exit `4`                                                                   |
| No production deployment command exists                                           | ✅ complete | CLI accepts only `staging` (production names a refusal message, exit `2`); mock rejects production with `PERMISSION_DENIED`; policy schema restricts `claudeCodeAllowed`                          |

Full suite after WP4: **177 tests across 19 files**; typecheck 5/5; lint 0; format
clean; build 10/10. Built-binary golden path now runs the complete lifecycle:
`init → test → release create (rc_1, stage RELEASED) → deploy staging
(QUEUED → DEPLOYING → HEALTHY, dep_1) → status`. Decisions in
`docs/adr/0004-wp4-lifecycle-and-release-choices.md`.

## WP4 known limitations

- Approvals above zero fail closed (authenticated approval records are a deferred
  platform decision); the staging path requires zero per the example policy.
- `raia pull` and drafts-from-CLI are not yet wired (drafts exist in the provider);
  refreshing the lock after remote drift currently reuses `init --force`.
- Traces (`raia trace`, `raia learn`) arrive with WP5 alongside the MCP surface.

## WP5 — MCP server and Claude Code plugin

| Gate                                                                      | Status      | Evidence                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP tools exactly match `contracts/mcp-tool-catalog.json`                 | ✅ complete | `mcp-server.test.ts`: `listTools` deep-equals the spec catalog (names, descriptions, input schemas); server serves the catalog verbatim from a byte-copied file                                                                           |
| Inputs/outputs validated; paths restricted to approved roots              | ✅ complete | Ajv validation against catalog schemas (with pre-applied defaults); `projectRoot: /etc` rejected before any read; outputs redacted via core redaction and capped at 1 MiB                                                                 |
| Trace content redacted, capped, labeled untrusted (scenario 14)           | ✅ complete | Provider redacts server-side (rule ids recorded, byte-capped with `truncated`); MCP re-redacts, labels `untrusted: true` with an explicit data-not-instructions notice; hostile injection text survives as data only; token never appears |
| Plugin bundles the MCP server; no global CLI required                     | ✅ complete | `splitting: false` + full `noExternal` single-file bundles; stdio smoke test drives the actual `plugins/claude-code/dist/mcp-server.js` and lists all 15 tools                                                                            |
| Skills/agents call deterministic core operations                          | ✅ complete | 8 skills instruct calling `raia_*` tools/CLI with preview-confirm-report contracts; MCP handlers delegate to the same CLI runners (single implementation); 5 read-only review agents (`tools: Read, Grep, Glob`)                          |
| Cross-platform hooks: fast checks + production denial                     | ✅ complete | Node-only hook scripts; deny hook blocks `raia deploy production` (Bash) and production tool names with exit 2, passes staging; validated by executing the real script in tests                                                           |
| `claude plugin validate plugins/claude-code --strict` passes              | ✅ complete | "√ Validation passed" — after resolving a RECORDED template conflict (ADR 0005 §1: template `"agents": "./agents/"` fails strict validation; array form used, all other fields byte-identical, test-enforced)                             |
| No production/shell/SQL/secret-read/URL-fetch tool anywhere (scenario 12) | ✅ complete | Tool-list enumeration against `forbiddenTools` + name-pattern sweep; forbidden call returns a typed error; plugin surfaces swept for forbidden capability references                                                                      |

MCP golden path reproduced end to end over the protocol: init → validate →
evaluation_run (gate passed) → release_create (rc_1) → deployment_staging_create
(HEALTHY) → context (stage RELEASED). Full suite after WP5: **197 tests across
21 files**; strict plugin validation green; all quality gates green. Decisions
and the recorded template conflict in `docs/adr/0005-wp5-mcp-and-plugin-choices.md`.

## WP5 known limitations

- The plugin `dist/` is assembled by `pnpm build` (git-ignored); packaged,
  checksummed plugin artifacts are WP7 scope.
- `raia mcp serve` as a CLI alias is deferred to avoid a package cycle
  (ADR 0005 §7); the standalone `raia-mcp` bin and the plugin launch path cover
  the spec's intent.
- Remote evaluation runs remain provider-gated (`UNAVAILABLE`) pending WP6.

## Next smallest vertical slice (WP6 — proposed, not started)

HTTP providers behind the existing boundaries: the `/agent-devkit/v1`
management client generated against `contracts/raia-management.openapi.yaml`
with contract tests against a local conforming mock server (idempotency
headers, If-Match, Retry-After, bounded backoff, request-id propagation,
redacted logging), and the pinned `external-openapi-v1` conversation client
from `contracts/vendor/` with `developer-v1` failing closed
(`CAPABILITY_UNAVAILABLE`).
