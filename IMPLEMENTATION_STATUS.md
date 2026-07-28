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

## WP6 — HTTP and conversation providers

| Gate                                                             | Status      | Evidence                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract tests pass against mock HTTP servers                    | ✅ complete | `apps/mock-management-api` serves the exact `/agent-devkit/v1` wire contract over real sockets; `packages/provider-http/test/contract.test.ts` round-trips every operation: export+ETag, draft (If-Match, replay, mismatch, stale), release→staging→HEALTHY→rollback |
| Retries honor Retry-After, bounded/jittered, never unsafe codes  | ✅ complete | `retry-and-credentials.test.ts`: Retry-After 2 s honored exactly; 503 backoff `[188, 375]` ms with injected jitter then typed surface; parameterized never-retry table (401/403/409×3/422 → exactly 1 attempt); elapsed-time cap stops at attempt 2                  |
| Agent secret cannot construct management provider                | ✅ complete | Type-level (`@ts-expect-error` in tests) plus runtime guard: `kind: "agent-secret-key"` → typed `AUTHENTICATION_REQUIRED`; env reader never reads `RAIA_AGENT_SECRET_KEY`; CLI factory test repeats the refusal; token material proven absent from log entries       |
| Runtime-profile drift fails closed                               | ✅ complete | Generator verifies recorded checksums (`fabbd26b…` raw, `a76a1b2a…` projected) against actual bytes before emitting; `check-contract-sync.mjs` fails on any divergence (exercised in-test by tampering the generated file); unknown profiles are typed failures      |
| Pinned `external-openapi-v1` client; `developer-v1` fails closed | ✅ complete | Client dispatches only through generated `operationId → {method, path}` constants (all `/external/...`); auth via `Agent-Secret-Key` header, never a bearer; `developer-v1` and `custom-openapi` → `CapabilityUnavailableError`; loopback-only base-URL overrides    |
| Live evaluation wired behind explicit selection                  | ✅ complete | `raia test --mode live` (cost notice on stderr) runs real conversations through the runtime against the loopback contract server; run + reports record `mode: "live"`, `provider: "external-openapi-v1"`; exit 4 without credential, exit 1 for disabled profiles    |
| Doctor reports profile/checksum/server/auth without secrets      | ✅ complete | `raia doctor --json` emits the runtime block (profile, projected sha256, pinned server, auth scheme, credential presence); secret value proven absent; unknown profile flips the check to FAIL                                                                       |

New packages: `@raia/provider-http` (transport, problem+json mapping, bounded
retry, credential boundary, `HttpManagementProvider`), `@raia/conversation-client`
(pinned generated constants, `ExternalConversationClient`, profile registry,
live case executor, loopback mock conversation server), and the
`apps/mock-management-api` conforming server. Operations the pinned vendor
contract cannot express fail closed as RECORDED gaps (ADR 0006 §5). Full suite
after WP6: **248 tests across 26 files**; typecheck 9/9 projects; lint 0; format
clean; build green including plugin assembly; both contract-sync gates green;
`claude plugin validate --strict` still passing. Decisions in
`docs/adr/0006-wp6-http-and-conversation-providers.md`.

## WP6 known limitations

- The proposed management API has no live deployment; the HTTP client is
  verified only against the conforming local server (which is exactly what the
  acceptance checklist permits claiming — no live raia integration is claimed).
- `ConversationProvider.deleteConversation` and channel-scoped creation cannot
  be expressed by the pinned external contract and fail closed
  (`CAPABILITY_UNAVAILABLE`) — a recorded platform decision, not an omission.
- Live mode observes only assistant text (no tool calls or state transitions
  over the conversation surface); tool-policy/state assertions evaluate against
  empty observations rather than fabricated ones.
- OS-credential-manager storage and the OAuth device flow remain WP7+ scope;
  `RAIA_ACCESS_TOKEN` (CI fallback) and `RAIA_AGENT_SECRET_KEY` are the
  supported sources today.

## WP7 — Hardening and distribution

| Gate                                                      | Status      | Evidence                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coverage floors: 90 core / 85 providers+eval / 80 overall | ✅ complete | `pnpm coverage` → core 96.63/90.82, providers 93.09/86.55, eval-engine 96.78/90.87, overall 92.15/85.52 (lines/branches %); enforced by `scripts/check-coverage.mjs` using the spec's exact scopes; ~66 new tests close the gaps (evaluators, semantic-diff arms, error paths) |
| No skipped tests                                          | ✅ complete | `pnpm check:no-skip` forbids `.skip/.only/.todo` across 33+ test files; the suite reports 314 passed, 0 skipped                                                                                                                                                                |
| 3-OS CI matrix, Node 20 + active LTS                      | ✅ complete | `.github/workflows/ci.yml`: ubuntu/macos/windows × 20.x/22.x running preflight, all drift checks, format, lint, types, no-skip, build, tests, packaging, and the clean-install smoke; separate coverage and strict-plugin-validation jobs                                      |
| OpenAPI validation in CI                                  | ✅ complete | `packages/contracts/test/openapi.test.ts` validates both wire contracts (management YAML + pinned vendor projection) offline with @seriousme/openapi-schema-validator                                                                                                          |
| Secret scanning in CI                                     | ✅ complete | `packages/core/test/repo-secret-scan.test.ts` runs the DevKit's own rule set over the source tree with a reviewed false-positive baseline that fails on unreviewed findings AND on stale entries                                                                               |
| Packaged artifacts + SHA-256 checksums                    | ✅ complete | `scripts/package-artifacts.mjs` → 8 npm tarballs + standalone plugin archive + `SHA256SUMS` (9 artifacts)                                                                                                                                                                      |
| Clean artifact install passes                             | ✅ complete | `scripts/package-smoke.mjs`: checksum re-verification → npm install of the CLI tarball into a fresh temp project (workspace deps via file: overrides) → installed `raia` runs init → validate → test → extracted plugin bundle runs; step in the 3-OS matrix                   |
| Provenance where supported                                | ✅ complete | `release.yml` on version tags: build, test, package, smoke, `actions/attest-build-provenance`, GitHub release with artifacts + checksums, npm publish `--provenance` gated on a configured token                                                                               |
| Docs reproduce the golden path                            | ✅ complete | `README.md` (golden path, exit-code contract, package map, security invariants), `CONTRIBUTING.md`, `docs/versioning-and-migration.md`                                                                                                                                         |

Final suite: **314 tests across 35 files**, everything green with explicit
exit codes: preflight, contracts sync, generated-types drift, conversation
contract drift, format, lint, typecheck (9/9), no-skip, build, test,
coverage floors, packaging, clean-install smoke, and
`claude plugin validate --strict`.

## WP7 known limitations

- The npm publish step is real but dormant until an `NPM_TOKEN` secret and a
  version tag exist; artifact packaging, checksums, and the GitHub-release
  path are exercised in CI regardless.
- macOS/Windows runs execute in GitHub Actions; local verification for this
  work package was Linux (the matrix is the cross-OS gate).
- The secret-scan baseline lists reviewed TypeScript-identifier false
  positives; tuning the credential-assignment rule to ignore type
  annotations would shrink it and is a candidate refinement.
- OS-credential-manager storage and the OAuth device flow remain future
  scope (`RAIA_ACCESS_TOKEN` / `RAIA_AGENT_SECRET_KEY` env sources today).

## MVP completion

All eight work packages (WP0–WP7) are complete with recorded evidence. Per
the build spec's definition of done: every work-package gate passes, public
packages contain no internal path imports (boundary tests), the plugin
validates strictly and runs from its built artifact (smoke test), the
documentation reproduces the golden path, security invariants have negative
tests, and a fresh machine can use the mock provider with no raia
credentials. The management HTTP provider meets the spec's explicit bar:
every proposed OpenAPI operation has success and typed-failure contract
tests, timeout/retry coverage, request-ID propagation, and redaction tests
against a conforming local server. Open platform decisions (live management
API, approvals above zero, per-conversation delete in the external contract)
are recorded in `DECISIONS_REQUIRED.md` context and ADRs 0005–0006 rather
than guessed.
