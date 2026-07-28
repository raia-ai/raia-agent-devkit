# Claude Code kickoff prompt

Copy the prompt below into Claude Code after placing this specification package at `docs/raia-devkit-spec/` in the target repository.

---

You are the lead engineer implementing the **raia Agent DevKit and Claude Code harness**.

Before reading or editing implementation code, run:

```bash
node docs/raia-devkit-spec/preflight.mjs
```

If it exits nonzero, prints `SPEC_PACKAGE_INCOMPLETE`, or `PACKAGE_MANIFEST.sha256` is absent, **stop immediately** and report the missing or changed files. Do not reconstruct, infer, or invent any contract. A standalone copy of this prompt or the build specification is not a complete handoff.

After preflight passes, read these files in full before editing:

1. `docs/raia-devkit-spec/RAIA_AGENT_DEVKIT_BUILD_SPEC.md`
2. `docs/raia-devkit-spec/AGENT_LIFECYCLE_FRAMEWORK.md`
3. Every file under `docs/raia-devkit-spec/contracts/`
4. The complete reference project under `docs/raia-devkit-spec/examples/helpdesk-agent/`
5. `docs/raia-devkit-spec/DECISIONS_REQUIRED.md`

Treat the build specification as normative for behavior and security. Treat the machine-readable contracts as normative for data shape. If two requirements conflict, stop, identify the exact conflict, and propose the smallest resolution. Do not silently choose a behavior.

## Your first objective

Implement **WP0 — Foundation** and **WP1 — Contracts and core** only. Do not scaffold all later packages with placeholder code. Deliver the smallest complete vertical slice that:

- installs, builds, lints, type-checks, and tests in a `pnpm` TypeScript monorepo on Node.js 20+;
- loads and validates `examples/helpdesk-agent/raia.agent.yaml` and its referenced artifacts;
- generates TypeScript types from the supplied JSON Schemas;
- enforces project-root path boundaries, including symlink escape protection;
- detects and redacts raw secrets;
- canonicalizes the agent bundle and produces deterministic SHA-256 manifest and candidate hashes;
- creates a deterministic typed semantic diff when `prompts/system.md` changes;
- includes negative tests for duplicate names, raw secrets, `../` traversal, symlink escape, malformed schemas, and non-deterministic ordering.

## Required process

Before implementation, create:

- `IMPLEMENTATION_PLAN.md`, mapping WP0 and WP1 requirements to files and acceptance tests;
- `IMPLEMENTATION_STATUS.md`, initially showing all WP0/WP1 gates as incomplete;
- a short architecture decision record for any choice that is not already fixed by the specification.

Then work test-first where practical. After each coherent change, run the narrow tests, followed by formatting, linting, strict type checking, all tests, and the example validation. Record exact commands and results in `IMPLEMENTATION_STATUS.md`.

## Constraints you may not weaken

- Claude is an adapter; no model call may perform validation, hashing, diffing, policy enforcement, or lifecycle transitions.
- Do not require Bun, Docker, Bash, or a globally installed package.
- Do not place credentials or realistic secrets in source, snapshots, logs, fixtures, reports, or error messages.
- Do not implement production deployment, background synchronization, arbitrary MCP tools, telemetry content collection, or a second coding-agent adapter.
- Do not invent live raia management endpoints. The management OpenAPI file is a proposed contract and later HTTP work must remain behind `ManagementProvider`.
- Do not infer conversation routes or authentication from prose. WP6 must use the pinned `external-openapi-v1` contract, and the conflicting `developer-v1` profile remains disabled until an authoritative OpenAPI document is supplied.
- Do not claim completion while a required test is skipped or failing.
- Do not proceed to WP2 until every WP0/WP1 gate passes and you have summarized the evidence for review.

## Completion response

When WP0 and WP1 are complete, report:

1. the implemented repository tree;
2. key architectural decisions;
3. commands run and their results;
4. test coverage, including all negative security cases;
5. the exact golden-path example output;
6. remaining ambiguities or risks;
7. a proposed, bounded WP2 plan—without starting it.

Begin by running the package preflight. Only after it passes, read the complete specification package and write `IMPLEMENTATION_PLAN.md`. Do not edit implementation code before the plan is complete.

---
