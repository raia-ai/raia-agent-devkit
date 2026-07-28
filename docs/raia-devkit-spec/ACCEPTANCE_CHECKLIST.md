# raia Agent DevKit Acceptance Checklist

A box may be checked only when the corresponding automated test passes and its command/result is recorded in `IMPLEMENTATION_STATUS.md`. “Implemented” without test evidence is not complete.

## WP0 — Foundation

- [ ] `node docs/raia-devkit-spec/preflight.mjs` verifies every packaged checksum before installation and fails with `SPEC_PACKAGE_INCOMPLETE` if a normative file is missing or changed.
- [ ] A fresh checkout installs with `pnpm` on Node.js 20+.
- [ ] Formatting, linting, strict type checking, builds, and tests run from root scripts.
- [ ] Package boundaries prohibit internal cross-package imports.
- [ ] CI runs on Linux and has placeholders only for later macOS/Windows expansion, not skipped core tests.
- [ ] Changesets and release-package smoke-test infrastructure exist.

## WP1 — Contracts and core

- [ ] All supplied JSON Schemas pass metaschema validation.
- [ ] TypeScript types are generated from schemas, and CI detects generated-file drift.
- [ ] The helpdesk manifest and every referenced file load successfully.
- [ ] Canonical serialization and SHA-256 hashes are deterministic.
- [ ] Candidate identity includes referenced prompt, evaluation, fixture, policy, and lock content.
- [ ] Duplicate named resources fail validation.
- [ ] `../` traversal and symlink escape fail before reading the target.
- [ ] Raw secret patterns fail and are redacted in errors, logs, snapshots, and reports.
- [ ] Semantic diffs are typed, risk-classified, stable, and match named resources by name.
- [ ] Removed escalation, guardrails, or knowledge and broadened function access receive high or critical risk.

## WP2 — Mock provider and CLI spine

- [ ] The filesystem-backed provider implements discovery, export, versioning, ETags, pagination, and typed errors.
- [ ] `doctor`, `init`, `validate`, `diff`, and `status` work in human and JSON modes.
- [ ] CLI exit codes exactly match the specification.
- [ ] Local writes are atomic and never overwrite modified files silently.
- [ ] Golden-path initialization and diff work without credentials or a network.

## WP3 — Evaluation vertical slice

- [ ] Fixture-mode smoke and regression suites execute deterministically.
- [ ] All deterministic evaluator types are implemented and tested.
- [ ] Rubric evaluation is disabled without an explicit evaluator provider.
- [ ] JSON, JUnit XML, and Markdown reports are emitted.
- [ ] Baseline comparison identifies regressions, improvements, unchanged failures, and flakes.
- [ ] A critical deterministic failure exits `6` regardless of aggregate pass rate.
- [ ] Live mode requires explicit selection and never becomes the default.

## WP4 — Release and staging

- [ ] Lifecycle transitions are pure, exhaustive, and deny invalid transitions.
- [ ] `.raia/workflow-state.json` validates against its schema and is written atomically.
- [ ] Changing the candidate hash invalidates evidence from the prior candidate.
- [ ] Release policy checks exact candidate and evidence hashes.
- [ ] Releases are immutable.
- [ ] Exact idempotent replay returns the original result.
- [ ] Changed payload with a reused key fails as `IDEMPOTENCY_MISMATCH`.
- [ ] Stale base/ETag fails without changing state and exits `5`.
- [ ] Staging deployment follows `QUEUED → DEPLOYING → HEALTHY` and captures a rollback target.
- [ ] No production deployment command exists.

## WP5 — MCP and Claude Code plugin

- [ ] MCP tools exactly match `contracts/mcp-tool-catalog.json`.
- [ ] MCP validates all inputs/outputs and restricts paths to approved roots.
- [ ] Trace content is redacted, capped, and labeled as untrusted data.
- [ ] The plugin bundles the MCP server and requires no global CLI.
- [ ] The plugin’s Skills and agents call deterministic core operations rather than duplicating them.
- [ ] Cross-platform hooks perform only fast checks and production-deployment denial.
- [ ] `claude plugin validate plugins/claude-code --strict` passes.
- [ ] No production deploy, shell, SQL, secret-read, raw HTTP, or unrestricted URL-fetch tool exists.

## WP6 — HTTP and conversation providers

- [ ] Every proposed management operation has success and typed-failure contract tests against a local server.
- [ ] Mutations send idempotency keys and required ETags/base versions.
- [ ] Retries honor `Retry-After`, use bounded backoff with jitter, and occur only for safe/idempotent requests.
- [ ] Request IDs propagate to errors and audit events.
- [ ] Authentication and request bodies are redacted from logs.
- [ ] US and EU server identifiers are supported without permitting an arbitrary runtime URL from normal CLI or MCP inputs.
- [ ] `external-openapi-v1` is generated and contract-tested from the pinned normalized OpenAPI; its raw source, normalization log, and checksums remain auditable.
- [ ] `developer-v1` fails with `CAPABILITY_UNAVAILABLE` until an independently versioned authoritative OpenAPI contract is supplied.
- [ ] A runtime contract checksum change fails CI until generated types and contract tests are intentionally updated.
- [ ] The conversation runtime client remains separate from management authentication.
- [ ] An Agent Secret Key cannot construct or authorize `ManagementProvider`.

## WP7 — Hardening and distribution

- [ ] All required checks pass on Linux, macOS, and Windows.
- [ ] Coverage floors are met, with explicit tests for every security and lifecycle invariant.
- [ ] Published-package smoke tests pass in a clean temporary project.
- [ ] Plugin and npm artifacts include semantic versions and SHA-256 checksums.
- [ ] Release provenance is generated where supported.
- [ ] Documentation reproduces the golden path from a clean machine.
- [ ] No required test is skipped or quarantined.

## Final release gate

- [ ] Every required end-to-end scenario in Section 29 of the build specification passes.
- [ ] `DECISIONS_REQUIRED.md` clearly separates unresolved live-platform decisions from completed local behavior.
- [ ] The implementation does not claim a live raia management integration without a conforming service test.
- [ ] Security review confirms that production deployment is absent from the Claude plugin and MCP catalog.
