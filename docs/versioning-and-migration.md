# Versioning and migration

## Package versions

All `@raia/*` packages version together through Changesets and semantic
versioning. Until 1.0, minor releases may contain breaking changes; they are
always called out in the changelog with migration steps.

## Contract and schema versions

| Surface                                      | Version marker                                               | Change policy                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent manifest / eval suite / release policy | `apiVersion: devkit.raia.ai/v1alpha1`                        | Additive fields allowed within a version; breaking shape changes bump the apiVersion and ship a documented migration                           |
| Workflow state (`.raia/workflow-state.json`) | `stateVersion: 1`                                            | New versions must read older state or fail with a typed error naming the migration                                                             |
| Lock file (`raia.lock.json`)                 | schema-validated                                             | Regenerated deterministically by `raia init`/pull; never hand-migrated                                                                         |
| Management wire contract                     | `contracts/raia-management.openapi.yaml` (proposed)          | Client and conforming server change together; every operation keeps success + typed-failure contract tests                                     |
| Conversation runtime                         | pinned `external-openapi-v1` (checksummed vendor projection) | Updates require a reviewed raw-contract diff, deterministic re-projection, regenerated constants, and green contract tests; drift fails closed |
| MCP tool catalog                             | `contracts/mcp-tool-catalog.json`                            | Served verbatim; any change is a contract change and versions with the spec package                                                            |
| Candidate identity                           | `coreVersion` inside the hash                                | Hash-affecting core changes bump `CORE_VERSION`, which invalidates prior evidence by construction — this is intentional                        |

## What a migration must include

1. A changeset describing the break and the migration commands.
2. Typed errors at every load point that can encounter old data
   (`SCHEMA_INVALID` / `LOCK_INVALID` name the file and the fix).
3. Tests proving both the new shape and the failure mode for the old one.
4. An ADR when the change resolves a recorded conflict or contract gap.

## Evidence compatibility

Evaluation reports embed `engineVersion` and a deterministic
`evidenceSha256`. Reports from different engine versions never compare
silently: baseline comparison operates on case identity and status only, and
release gating re-verifies evidence hashes against the exact current
candidate, so stale or foreign evidence cannot satisfy a gate.
