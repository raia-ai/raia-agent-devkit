# ADR 0003 — WP3 choices not fixed by the specification

Status: accepted · Scope: WP3 (evaluation vertical slice)

## 1. The engine is filesystem-free

`@raia/eval-engine` consumes suites already loaded by `@raia/core` (which supplies
fixture content and hashes) and performs no I/O of its own. Determinism follows
structurally, and live mode (WP6) plugs in through the injectable `caseExecutor`
seam rather than a parallel code path.

## 2. Fixture selection: the last turn carrying `fixtureRef`

A case's simulated outcome is the fixture referenced by the last turn that carries a
`fixtureRef`. Simulator-based conversations and cases without any `fixtureRef` are
recorded as `skipped` with an explanatory message — fixture mode never fabricates an
agent response.

## 3. Tool policy and `expectedStates` are implicit critical assertions

The eval-suite schema defines `toolPolicy` and `expectedStates` on the case, not as
assertions. The engine enforces them as synthesized assertions
(`tool-policy-allowed`, `tool-policy-forbidden`, `expected-states`) marked critical:
violating a declared safety envelope must fail the gate.

## 4. Gate and exit-code semantics for `raia test`

The evaluation gate fails on a blocking-case failure or any critical assertion
failure (spec §21: aggregate pass rate cannot mask it). The `raia test` command exits
`6` when the gate fails **or** any non-informational case fails or is flaky — a test
command that reports failures must not exit 0. Informational-criticality cases never
affect the exit code and are excluded from the pass-rate denominator.

## 5. Regex and JSON-schema safety limits

Regex assertions: pattern ≤ 512 chars, ≤ 32 quantifiers, no backreferences, target
≤ 1 MiB; unsafe patterns fail the assertion (fail closed) rather than being skipped.
JSON-schema assertions: separate Ajv instance from contract validation, schema
≤ 128 KiB. Failure messages are redacted through core redaction and capped at 300
characters.

## 6. Deterministic run identity; timestamps informational

`runId` derives from candidate hash, suite hashes, seed, repetitions, and engine
version. `evidenceSha256` hashes the run result minus `startedAt`/`completedAt`,
which are injectable and informational — matching the lock file's `generatedAt`
convention. Repetitions execute sequentially (recorded `concurrency: 1`) so results
are order-stable; differing repetition outcomes mark a case `flaky`.

## 7. `raia review` exits 3 on blockers and requires candidate-bound evidence

Review is an aggregation, not an evaluation run: unmet release-policy requirements
(including missing evidence or evidence bound to a different candidate hash) exit `3`
(policy failure), reserving `6` for actual evaluation-gate failures from `raia test`.
Approval requirements > 0 fail closed until approval records exist (WP4). A missing
baseline leaves `maximumRegressionCount` unexercised (noted in the requirement text)
rather than blocking on evidence that cannot exist yet.

## 8. Core gains the `policy` module ahead of WP4

`raia review` needs deterministic policy decisions, so `evaluateReleasePolicy` lands
in core now (pure function, no network). WP4's release path will reuse exactly this
function, keeping a single source of policy truth.
