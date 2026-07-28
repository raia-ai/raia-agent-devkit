# raia Agent DevKit Specification Package

This package is designed to be copied **as a complete directory** into a target repository and given directly to Claude Code. It contains a product and technical specification, machine-readable contracts, pinned runtime contract, complete example agent, phased acceptance checklist, dependency-free completeness preflight, and copy-ready kickoff prompt. The build specification and kickoff prompt are not sufficient by themselves.

## Start here

| File | Purpose |
| --- | --- |
| `RAIA_AGENT_DEVKIT_BUILD_SPEC.md` | The complete product, architecture, security, CLI, MCP, plugin, implementation, and acceptance specification |
| `AGENT_LIFECYCLE_FRAMEWORK.md` | Harness-neutral lifecycle rules for planning, validation, evaluation, approval, release, staging, resume, observation, and learning |
| `CLAUDE_CODE_START_PROMPT.md` | A prompt to paste into Claude Code after copying this package into the target repository |
| `ACCEPTANCE_CHECKLIST.md` | Evidence-based work-package completion checklist |
| `DECISIONS_REQUIRED.md` | Product and backend decisions that must be resolved before a live raia management integration ships |
| `preflight.mjs` and `PACKAGE_MANIFEST.sha256` | Dependency-free completeness and checksum gate; Claude must stop if this fails |
| `contracts/` | Normative manifest, lock, evaluation, policy, and workflow-state schemas; provider interface; proposed management OpenAPI contract; pinned external runtime OpenAPI; MCP catalog; and Claude plugin templates |
| `examples/helpdesk-agent/` | A realistic source-controlled agent, evaluation suites, release policy, prompts, and deterministic fixtures |

## Recommended use

Extract the supplied ZIP and copy the entire `raia-agent-devkit-spec/` directory to `docs/raia-devkit-spec/` in a new or existing repository. Do **not** upload or forward only the individually readable Markdown files. From the repository root, first run `node docs/raia-devkit-spec/preflight.mjs`; then open Claude Code and paste the contents of `CLAUDE_CODE_START_PROMPT.md`. The prompt intentionally limits the first implementation session to the foundation and deterministic core. Subsequent work packages should begin only after the prior package’s automated gates pass.

The first executable milestone does **not** require a live raia lifecycle API. It uses a filesystem-backed mock provider and treats `contracts/raia-management.openapi.yaml` as a proposed service contract. This keeps implementation moving while preventing the harness from inventing or coupling itself to undocumented endpoints.

## Contract precedence

Machine-readable contracts govern field and interface shapes. The build specification governs behavior, security, and scope. If an implementation finds a conflict, it should stop, identify the exact conflict, and record an explicit decision rather than silently changing behavior.

## Validate the package

Before implementation, verify that the handoff is complete and unmodified:

```bash
node docs/raia-devkit-spec/preflight.mjs
```

After changing a contract, regenerate the package manifest, install the lightweight validation dependencies, and run the semantic package checks:

```bash
python3 -m pip install -r docs/raia-devkit-spec/validation-requirements.txt
python3 docs/raia-devkit-spec/validate_package.py
```

The validator checks all JSON Schemas, the example manifest and suites, local references and fixtures, the OpenAPI 3.1 contract, the Claude plugin templates, the MCP allowlist and staging-only boundary, and cross-contract candidate identity requirements.
