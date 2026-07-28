---
name: raia-review
description: Produce release-readiness evidence for the current raia agent candidate and list unresolved blockers. Use before creating a release, or when the user asks whether the agent is ready to ship.
---

# /raia:review — release evidence

1. Run the CLI `raia review` (or aggregate via `raia_context_get`,
   `raia_agent_validate`, `raia_agent_diff`, and `raia_evaluation_get`).
2. Present the evidence table: candidate hash, risk and changes, validation
   result, evaluation gate and its binding to the current candidate, drift,
   and each release-policy requirement with its satisfied/unsatisfied status.
3. Every unsatisfied requirement is a blocker with exactly one remedy — name
   it (e.g. stale evidence → `/raia:test`; drift → `/raia:pull`).
4. If ready, the next action is `/raia:release` (raia_release_create). If not,
   stop; never suggest weakening the policy to pass it.

Evidence is hash-bound: a report for a different candidate hash is stale and
must be regenerated, not reused.
