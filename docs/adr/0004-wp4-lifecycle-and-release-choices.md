# ADR 0004 — WP4 choices not fixed by the specification

Status: accepted · Scope: WP4 (lifecycle, release, staging deployment)

## 1. `release create` drives the full stage chain in one command

The change-state machine is strictly sequential (DRAFT → PLANNED → VALIDATED →
EVALUATED → APPROVED → RELEASED), but users run `validate`/`test`/`review` in any
order, producing evidence files. Rather than advancing workflow state from every
command (which would force an artificial command order), evidence-producing commands
write reports, and `release create` drives the canonical chain through the pure
engine in one run — each transition persisted atomically, each evidence reference
freshly verified against the current candidate hash. Interrupting mid-chain resumes
at the first incomplete stage on re-run (framework section 8).

## 2. Content-derived idempotency keys

The CLI derives mutation idempotency keys from content identity: `rc-<candidateSha256>`
for releases, `dep-<releaseCandidateId>-staging` for deployments. Retrying the same
logical operation therefore replays to the same result without the CLI storing a key,
and a changed candidate naturally produces a fresh key. The mock additionally proves
the mismatch path (same key, different payload → `IDEMPOTENCY_MISMATCH`).

## 3. Deterministic asynchronous deployment: one step per poll

Spec section 17 requires injectable asynchronous completion with deterministic
default fixtures. The mock stores a progression plan (`DEPLOYING → HEALTHY`, or
`→ FAILED` under the `deploymentOutcome: "failed"` fixture) and advances exactly one
step per `getDeployment` poll through the pure deployment transition function. No
timers, no wall-clock dependence; the CLI polls to a bounded limit. Reaching HEALTHY
supersedes the environment's previous HEALTHY deployment and the new deployment
records it as its rollback target.

## 4. `raia status` never polls deployments

`getDeployment` advances the mock's deterministic progression, which is a side
effect. `status` must have none (spec section 20), so it reports release and
deployment identifiers from the local workflow state only. Live deployment health
belongs to `deploy` (which polls) and later `raia trace`/observability surfaces.

## 5. Readiness is one shared code path

`review` (report) and `release create` (gate) call the same `aggregateReadiness`
function, so the review report can never disagree with the release gate. Readiness
failure exits `3`; only genuine remote conflicts (`STALE_BASE`,
`IDEMPOTENCY_MISMATCH`) exit `5`, and the readiness `requireNoDrift` check normally
catches drift first — the provider-level guard is proven by a test that relaxes the
policy.

## 6. Mock fixtures configured via `.raia/mock/config.json`

Permission fixtures (scopes) and the deployment-outcome fixture are configured
through a JSON file inside the mock state directory rather than CLI flags, keeping
fixture wiring out of the product surface while remaining fully scriptable for tests
(spec scenario 13: removing `deployment:promote` exits `4`).

## 7. Production is refused at three layers

No production path exists: the CLI accepts only the literal `staging` environment
(production names a specific refusal message), the mock rejects production
deployments with `PERMISSION_DENIED` as server policy, and the release policy schema
limits `claudeCodeAllowed` to development/staging. WP5's MCP catalog and hooks add
the fourth and fifth layers.
