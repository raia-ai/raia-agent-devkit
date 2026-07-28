# Implementation Status

Updated at the end of every work package per the build specification (§28).
A gate is complete only with a recorded command and result.

## WP0 — Foundation

| Gate | Status | Evidence |
| --- | --- | --- |
| Preflight verifies packaged checksums | ☐ incomplete | — |
| Fresh checkout installs with pnpm on Node 20+ | ☐ incomplete | — |
| Format, lint, type check, build, test from root scripts | ☐ incomplete | — |
| Package boundaries prohibit internal cross-package imports | ☐ incomplete | — |
| CI runs on Linux (no skipped core tests) | ☐ incomplete | — |
| Changesets and release-package infrastructure exist | ☐ incomplete | — |

## WP1 — Contracts and core

| Gate | Status | Evidence |
| --- | --- | --- |
| All supplied JSON Schemas pass metaschema validation | ☐ incomplete | — |
| Types generated from schemas; CI detects drift | ☐ incomplete | — |
| Helpdesk manifest and every referenced file load | ☐ incomplete | — |
| Canonical serialization and SHA-256 hashes deterministic | ☐ incomplete | — |
| Candidate identity includes prompt, eval, fixture, policy, lock content | ☐ incomplete | — |
| Duplicate named resources fail validation | ☐ incomplete | — |
| `../` traversal and symlink escape fail before reading target | ☐ incomplete | — |
| Raw secrets fail and are redacted everywhere | ☐ incomplete | — |
| Semantic diffs typed, risk-classified, stable, name-matched | ☐ incomplete | — |
| Removed escalation/guardrails/knowledge, broadened function access ≥ high | ☐ incomplete | — |

## Known limitations

- None recorded yet.

## Next smallest vertical slice

- WP0 scaffold (see `IMPLEMENTATION_PLAN.md`).
