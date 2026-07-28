---
name: raia-deploy-staging
description: Preview and deploy an approved, immutable raia release candidate to the staging environment only. Use after a successful release when the user wants the candidate running in staging. Production deployment is impossible from Claude Code by design.
---

# /raia:deploy-staging — staging deployment

1. Call `raia_context_get`; require stage RELEASED with a release candidate id
   bound to the current candidate hash. Anything else → stop with the missing
   step.
2. Preview: release id, candidate hash, environment (always and only staging).
3. On confirmation, call `raia_deployment_staging_create` with the exact
   `releaseCandidateId`, an idempotency key, and `confirmed: true`.
4. Poll `raia_deployment_get` until HEALTHY or FAILED and report the actual
   progression, deployment id, and rollback target. An asynchronous deployment
   is not "done" until the provider says HEALTHY.
5. On FAILED: report the rollback target and diagnostics; rollback is an
   explicit user decision.

Production does not exist here: no tool, no CLI path, and the PreToolUse hook
blocks attempts. Do not try to route around that boundary.
