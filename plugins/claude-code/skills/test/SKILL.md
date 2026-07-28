---
name: raia-test
description: Select and run raia evaluation suites in fixture mode and interpret the evidence. Use after agent edits, before review/release, or when the user asks to test the agent or investigate a failing evaluation.
---

# /raia:test — run evaluations

1. Call `raia_agent_validate`; a failing validation must be fixed before
   evaluation evidence means anything.
2. Choose suites: default to the manifest's configured suites; add targeted
   suites when the diff touches specific capabilities.
3. Call `raia_evaluation_run` with the exact `candidateSha256` from
   validation, `mode: "fixture"`, an idempotency key, and `confirmed: true`.
   Live mode requires the user to explicitly accept remote-conversation and
   model-cost implications — and is unavailable until the conversation runtime
   ships; never select it silently.
4. Interpret results from the tool payload: gate status, blocking failures,
   pass rate, per-case outcomes. A blocking or critical failure cannot be
   argued away — the fix is a code/prompt/fixture change, not a gate change.
5. Never edit a fixture or assertion just to make a failure pass; propose such
   changes to the user with the behavioral consequence spelled out.
