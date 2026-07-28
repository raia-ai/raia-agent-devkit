---
name: raia-pull
description: Safely import an exact raia agent version into the bound project, refusing to overwrite local modifications. Use when the remote agent advanced (remote drift), or the user asks to sync/pull the latest agent version.
---

# /raia:pull — import an exact agent version

1. Call `raia_context_get`; record `candidateSha256`, base version, and drift.
2. If local drift exists (uncommitted local changes), stop and tell the user
   pull would conflict; they decide whether to commit, discard, or --force via
   the CLI. Never discard local work yourself.
3. Preview: which version will be written and which files are affected.
4. On confirmation, call `raia_project_pull` with the current
   `expectedLocalCandidateSha256`, the target `baseVersionId`, and
   `confirmed: true`. A CONFLICT or STALE_BASE error means the state moved —
   re-read context and re-preview; do not retry blindly.
5. Report written/skipped files and the new base version, then suggest
   `raia_agent_validate`.
