---
name: raia-learn
description: Convert one reviewed raia trace into a proposed local evaluation case and fixture. Use after /raia:debug when the user wants the observed behavior protected by a regression test.
---

# /raia:learn — trace to proposed regression case

1. Only proceed for a trace the user explicitly selected and reviewed.
2. Preview the two files that will be created (an eval suite under `evals/`
   and a fixture under `fixtures/`) and state clearly: the proposal is NOT
   committed, NOT executed, and NOT part of any release gate until a human
   reviews it and adds it to the manifest.
3. On confirmation, call `raia_trace_to_eval_candidate` with `confirmed: true`
   and a descriptive kebab-case `candidateId`.
4. Personal or secret data must not survive into the proposal — the tool
   redacts, and you must review its output and flag anything questionable
   rather than fixing it silently.
5. Report the written paths and the follow-up: human review, editing the
   assertions to capture intent (not just the literal response), and a normal
   Git commit if adopted.
