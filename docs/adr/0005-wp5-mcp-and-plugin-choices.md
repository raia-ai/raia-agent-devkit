# ADR 0005 — WP5 choices and one recorded contract conflict

Status: accepted · Scope: WP5 (MCP server + Claude Code plugin)

## 1. RECORDED CONFLICT: plugin template `agents` field vs strict validation

The normative template `contracts/claude-plugin/.claude-plugin/plugin.json`
declares `"agents": "./agents/"`, but `claude plugin validate --strict` — which
the build spec (§24) and acceptance checklist also mandate — rejects that shape
("agents: Invalid input"). Both a trailing-slash and a bare directory string
fail; an explicit array of agent file paths passes.

Resolution (smallest change): the shipped plugin uses the array form; every
other manifest field stays byte-identical to the template, enforced by a test
that diffs the two manifests modulo `agents`. `.mcp.json` and `hooks/hooks.json`
remain byte-identical. Upstream fix proposed: update the template to the array
form in the next spec-package revision.

## 2. Low-level MCP handlers serve the catalog verbatim

Rather than re-declaring tools through an SDK convenience API (which would
create a second source of truth), the server registers low-level list/call
handlers: `tools/list` returns the catalog entries verbatim (name, description,
inputSchema, annotations), and `tools/call` validates arguments against the
catalog schema with Ajv before dispatch. Catalog parity is then a test
(`listTools` deep-equals the spec file), and `confirmed: true` is enforced by
the schema itself (`const: true`).

## 3. Defaults are applied before validation

JSON Schema's `if/then` on a defaulted property (e.g. `against` in
`raia_agent_diff`) misfires when the property is absent, because a `const`
check on a missing property passes vacuously. The server therefore applies
top-level property defaults to the arguments first and validates the result,
so conditional requirements see effective values.

## 4. Handlers delegate to the CLI runners

MCP handlers run the same command functions as the CLI (captured in-process
with JSON output), so the deterministic core, readiness aggregation, and
release chain have exactly one implementation. Server-side independence is
preserved by pre-checks the handlers add on top: approved-root path
containment, candidate/base/etag hash re-verification for release, release-id
verification for deployment, and current-candidate checks for pull/evaluation.

## 5. MCP idempotency keys are validated, mutations stay content-keyed

The catalog requires an `idempotencyKey` on mutating tools; the server
validates it (schema) while the underlying mutations continue to use the
CLI's content-derived keys (ADR 0004 §2), which are strictly stronger: the
same logical operation replays identically regardless of the caller's key
discipline, and a changed candidate can never reuse a stale key.

## 6. `raia_trace_to_eval_candidate` writes two previewed files

The catalog fixes only the eval-suite destination; the derived fixture is
written alongside it as `fixtures/proposed-<candidateId>.json` (a suite turn
must reference a fixture file). Both writes go through the no-silent-overwrite
path: identical re-runs are no-ops, human-edited proposals are never
overwritten. The proposal is schema-validated before writing and is not added
to the manifest, so it cannot join a release gate without human action.

## 7. Plugin bundles are self-contained; `raia mcp serve` deferred

`splitting: false` plus full `noExternal` bundling makes `dist/mcp-server.js`
and `dist/cli.js` single-file artifacts, so the plugin needs no node_modules
and no global CLI. A `raia mcp serve` CLI alias would make @raia/cli depend on
@raia/mcp-server, which already depends on @raia/cli; the standalone `raia-mcp`
bin plus the plugin launch path serve the same need without the cycle. Revisit
in WP7 packaging if the alias is still wanted.

## 8. Hook contract

SessionStart prints a one-line status and always exits 0 (fast, no remote
calls). PostToolUse validates only when a lifecycle-relevant file changed,
via the bundled CLI with a 15-second timeout, and surfaces error findings with
exit 2. PreToolUse blocks production-deployment attempts by tool name or Bash
command shape — the fourth enforcement layer after the catalog, the server
policy, and the policy schema.
