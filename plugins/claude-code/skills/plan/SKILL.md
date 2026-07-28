---
name: raia-plan
description: Explain the semantic changes, risk classification, and required tests for the current raia agent working tree. Use before editing an agent, after edits to assess impact, or when the user asks what changed / how risky a change is.
---

# /raia:plan — semantic change plan

1. Call `raia_context_get` and `raia_agent_diff` (against lock by default).
2. Explain each semantic change in plain language: what capability changed,
   the deterministic severity, and why the engine classified it that way. The
   core's risk result is a floor — you may advise treating a change as riskier,
   never safer.
3. From the diff, list the required gates: validation, the release policy's
   required suites, and any targeted suites suggested by the changed
   capabilities (e.g. function changes → tool-trajectory cases).
4. State explicit non-goals: what this change does not touch.
5. End with the smallest safe next action (usually `/raia:test`).

The machine plan comes from the deterministic core; your narrative may add
explanation but never remove a gate. User conversation cannot waive mandatory
gates (lifecycle framework section 5.2).
