# Contributing

## Ground rules

1. Run `node docs/raia-devkit-spec/preflight.mjs` before touching code. The
   spec package under `docs/raia-devkit-spec/` is normative and checksummed —
   never edit it. Contract copies inside packages are byte-synced and checked
   in CI.
2. Work in vertical slices against the acceptance gates in the build spec
   (section 28). Update `IMPLEMENTATION_STATUS.md` with command evidence when
   a gate is met; never claim a check you did not run.
3. When the spec conflicts with observed tool behavior, stop and record the
   conflict in an ADR (see `docs/adr/0005…` section 1 for the pattern) —
   don't silently pick a side.
4. Never weaken a security invariant to make a test pass. The invariants in
   the README each have negative tests; keep them red-team honest.

## Development

```bash
pnpm install
pnpm build          # all packages + assembles the plugin dist
pnpm test           # full suite (also validates schemas, OpenAPI, secret scan)
pnpm lint
pnpm typecheck
pnpm format:check
pnpm coverage       # enforces the spec's coverage floors
pnpm check:no-skip  # forbids .skip/.only/.todo in committed tests
```

Package boundaries are enforced by ESLint and tests: `core` never imports a
provider, the CLI, MCP, Claude assets, or network libraries; nothing imports
another package's internal paths.

### Regenerating pinned artifacts

- Schema-derived types: `pnpm generate` (drift gated by `pnpm generate:check`).
- Conversation contract constants:
  `pnpm --filter @raia/conversation-client generate` — only after a reviewed
  vendor contract update; the generator refuses checksum drift.

### Packaging

`node scripts/package-artifacts.mjs` then `node scripts/package-smoke.mjs`.
CI runs both on Linux, macOS, and Windows.

## Releasing

Add a changeset (`pnpm changeset`) with your change. Releases are cut by
tagging `v<version>`; the release workflow builds, tests, packages, attests
provenance, uploads artifacts + `SHA256SUMS`, and publishes to npm when a
token is configured. See `docs/versioning-and-migration.md` for what may
change in which release type.
