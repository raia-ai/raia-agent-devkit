# raia Agent DevKit

A harness-neutral toolkit for managing a [raia](https://www.raiaai.com) AI
agent as **versioned software**: define the agent as code, validate and diff
it deterministically, gate releases on evaluation evidence, deploy to
staging, and learn from redacted production traces — from a CLI, an MCP
server, or the bundled Claude Code plugin, all sharing one deterministic
core.

The first release operates end to end against a **deterministic local mock
provider**; it does not require live raia management APIs or any
credentials. The proposed management HTTP client and the pinned
conversation-runtime client are fully implemented and contract-tested
against local conforming servers.

## Golden path (fresh checkout, no network, no credentials)

Requires Node.js ≥ 20 and pnpm.

```bash
node docs/raia-devkit-spec/preflight.mjs   # verify the spec package
pnpm install
pnpm build
pnpm test

# Work in a scratch directory with the bundled example agent:
mkdir /tmp/helpdesk && cd /tmp/helpdesk
RAIA=$PWD/../path-to-checkout/packages/cli/dist/bin.js
node $RAIA init --provider mock --fixture <checkout>/docs/raia-devkit-spec/examples/helpdesk-agent --yes
node $RAIA validate
# edit prompts/system.md, then:
node $RAIA diff
node $RAIA test --mode fixture
node $RAIA review
node $RAIA release create --yes
node $RAIA deploy staging --yes
node $RAIA status
```

Every command supports `--json` for stable machine output. Exit codes are a
contract: `0` ok, `1` operational, `2` usage, `3` validation/secret/policy,
`4` authentication/permission, `5` conflict/stale-base/idempotency, `6`
evaluation gate failed.

## What's in the box

| Package                     | Purpose                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@raia/contracts`           | Normative JSON Schemas, generated types, provider contract (byte-synced to the spec package)                            |
| `@raia/core`                | Deterministic engine: canonical hashing, manifest/lock loading, semantic diff, validation, redaction, policy, lifecycle |
| `@raia/provider-mock`       | Filesystem-backed mock management provider (a product requirement, not test code)                                       |
| `@raia/provider-http`       | Client for the proposed `/agent-devkit/v1` management contract: typed errors, bounded retries, credential boundary      |
| `@raia/conversation-client` | Pinned `external-openapi-v1` conversation runtime client + live evaluation executor                                     |
| `@raia/eval-engine`         | Fixture/live evaluation runner, deterministic evaluators, JSON/JUnit/Markdown evidence, baseline comparison             |
| `@raia/cli`                 | The `raia` binary                                                                                                       |
| `@raia/mcp-server`          | Local stdio MCP server serving the fixed tool catalog                                                                   |
| `apps/mock-management-api`  | Conforming local HTTP server for the proposed management contract (contract-test target)                                |
| `plugins/claude-code`       | Claude Code plugin: skills, read-only review agents, hooks, bundled self-contained CLI + MCP server                     |

## Security invariants (each has negative tests)

- Coding agents are adapters: no model call performs validation, hashing,
  diffing, policy evaluation, or lifecycle decisions.
- No production deployment path exists anywhere (CLI, MCP catalog, mock
  policy, release-policy schema, and a Claude Code PreToolUse hook all
  refuse it independently).
- Secrets never appear in manifests, snapshots, logs, reports, or errors;
  redaction is deterministic and the repository scans itself with the same
  rules.
- Path traversal and symlink escapes fail before a single byte is read.
- An Agent Secret Key cannot construct the management provider — rejected at
  the type level and at runtime; conversation base-URL overrides are
  loopback-only.
- Releases are immutable and idempotency-keyed; stale bases and idempotency
  mismatches are typed failures, never silent retries.

## Documentation

- [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) — per-work-package
  acceptance gates with command evidence.
- [`docs/adr/`](docs/adr/) — architecture decision records, including
  recorded spec conflicts and contract gaps.
- [`docs/versioning-and-migration.md`](docs/versioning-and-migration.md) —
  version and migration policy.
- [`docs/raia-devkit-spec/`](docs/raia-devkit-spec/) — the normative build
  specification and contracts (checksummed; run the preflight before
  editing anything).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development workflow and gates.

## Releases

`node scripts/package-artifacts.mjs` produces `dist-artifacts/`: an npm
tarball per public package, the standalone Claude Code plugin archive, and a
`SHA256SUMS` manifest. `node scripts/package-smoke.mjs` verifies checksums
and installs the CLI into a clean temporary project. Version tags publish
GitHub releases with provenance attestations, and npm packages with npm
provenance when a token is configured.
