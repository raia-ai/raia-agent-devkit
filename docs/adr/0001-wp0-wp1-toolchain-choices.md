# ADR 0001 — WP0/WP1 choices not fixed by the specification

Status: accepted · Scope: WP0 + WP1 only

The build specification fixes runtime, language, workspace, test, schema, and
formatting tools (§9). The following narrower choices were open; each is recorded
with its rationale. None weakens a specified security invariant.

## 1. Type generation uses `json-schema-to-typescript`

§9 requires generating types from the normative JSON Schemas with no hand-maintained
duplicates. `json-schema-to-typescript` is used at build-authoring time; output is
committed under `packages/contracts/src/generated/` and CI re-generates and fails on
drift (`pnpm generate:check`). Rationale: mature, deterministic given pinned version,
no runtime dependency. Generated banner comments are stripped of timestamps so output
is reproducible.

## 2. Normative contracts are byte-synced copies, not path imports

`packages/contracts` embeds byte-identical copies of the five JSON Schemas and
`provider-contract.ts` from `docs/raia-devkit-spec/contracts/`. A sync test compares
bytes and fails on divergence in either direction. Rationale: packages must not
reach outside their boundary at runtime (§10), while the spec package remains the
single normative source; the sync test preserves precedence without runtime coupling.

## 3. Boundary enforcement: ESLint `no-restricted-imports` + an automated import-scan test

§10 forbids imports from another package's internal paths and forbids `core` from
importing providers, CLI, MCP, Claude assets, or network libraries. Enforcement is
two-layered: lint rules for developer feedback, plus a Vitest suite that parses all
import/export specifiers in `packages/core/src` and asserts the allowlist
(`@raia/contracts`, `node:` fs/path/crypto/util modules, relative in-package paths).
Rationale: the test layer is not silently disable-able per-file.

## 4. Canonical-JSON details within §13's constraints

§13 fixes: parse YAML first, sort object keys recursively, preserve array order,
LF endings, UTF-8, compact serialization, SHA-256 `sha256:<64hex>`. Open details:

- Key sort order: code-point order of UTF-16 units (JavaScript default `<`), applied
  recursively; documented and covered by tests.
- Numbers: serialized via `JSON.stringify` semantics; non-finite numbers are a
  canonicalization error (they cannot appear in JSON evidence).
- `undefined` object members are omitted; `null` is preserved.
- Strings are hashed over their UTF-8 bytes after LF normalization only when the
  value is file *content*; embedded YAML scalar strings are not line-ending-rewritten.

## 5. Required-suite hashing includes fixture content transitively

§13 requires candidate identity to cover required evaluation-suite hashes, and the
acceptance checklist requires fixture content in candidate identity. A suite hash is
the canonical hash of `{suite: <normalized suite>, fixtures: {<posix path>:
<sha256 of LF-normalized content>}}` where fixture paths are every `fixtureRef`
reachable in the suite, resolved under the project root. Rationale: a fixture edit
must change candidate identity without relying on directory listings (which would be
non-deterministic across platforms).

## 6. Secret detection ruleset

§25 requires detecting "common keys/tokens and entropy patterns" with allowlisted
placeholders. WP1 ships deterministic pattern rules (AWS access key, GitHub token,
OpenAI-style `sk-`, Slack `xox`, PEM private-key blocks, JWT triplets, generic
`(api[_-]?key|token|secret|password)` assignments with high-entropy right-hand side)
plus a Shannon-entropy check for long opaque literals in credential-adjacent fields.
Allowlist: `env://`, `vault://`, `raia-secret://` references and the placeholder
values `PLACEHOLDER`, `REDACTED`, `EXAMPLE`, `CHANGEME` (case-insensitive).
False-positive tuning is expected; rules are versioned (`ruleSetVersion`) so
validation evidence records which rules ran.

## 7. Diff severity ladder for changes the spec lists only as "high-risk"

§15 names the high-risk rules. For other changes the ladder is: metadata/labels →
`info`; persona tone/brand-voice content → `low`; instructions content, model
sampling parameters, retrieval settings → `medium`; everything in §15's high-risk
list → `high`; and `critical` is reserved for broadened external action authority
combined with removed safety controls (per framework §4, never produced silently by
wording-only changes). Deterministic ordering: `(category, path, operation)`
lexicographic.

## 8. Node built-in modules only in core

`core` uses `node:crypto` (SHA-256), `node:fs/promises`, `node:path` behind small
injected adapters (`FileSystem`, `Clock`, `IdGenerator` interfaces from §16's DI
requirement). No `fetch`, no process-global reads inside domain logic.
