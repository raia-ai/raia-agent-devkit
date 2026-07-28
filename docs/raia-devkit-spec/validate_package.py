from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from openapi_spec_validator import validate_spec

ROOT = Path(__file__).resolve().parent
ERRORS: list[str] = []


def fail(message: str) -> None:
    ERRORS.append(message)


def load_json(relative: str):
    path = ROOT / relative
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{relative}: invalid JSON: {exc}")
        return None


def load_yaml(relative: str):
    path = ROOT / relative
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"{relative}: invalid YAML: {exc}")
        return None


def check_schema(relative: str):
    schema = load_json(relative)
    if schema is None:
        return None
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:
        fail(f"{relative}: invalid JSON Schema: {exc}")
    return schema


def validate(instance, schema, relative: str) -> None:
    if instance is None or schema is None:
        return
    validator = Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)
    for error in sorted(validator.iter_errors(instance), key=lambda item: list(item.absolute_path)):
        location = ".".join(str(part) for part in error.absolute_path) or "<root>"
        fail(f"{relative}:{location}: {error.message}")


def main() -> int:
    schemas = {
        "manifest": check_schema("contracts/agent-manifest.schema.json"),
        "lock": check_schema("contracts/agent-lock.schema.json"),
        "eval": check_schema("contracts/eval-suite.schema.json"),
        "policy": check_schema("contracts/release-policy.schema.json"),
        "workflow": check_schema("contracts/workflow-state.schema.json"),
    }

    valid_hash = "sha256:" + ("a" * 64)
    lock_example = {
        "lockVersion": 1,
        "manifestApiVersion": "devkit.raia.ai/v1alpha1",
        "manifestSha256": valid_hash,
        "generatedAt": "2026-07-27T12:00:00Z",
        "generatedBy": {
            "cliVersion": "0.1.0",
        },
        "remote": {
            "workspaceId": "ws_mock_acme",
            "agentId": "agent_mock_helpdesk",
            "baseVersionId": "version_mock_1",
            "etag": "etag_mock_1",
            "region": "us",
        },
        "resolved": {
            "model": {
                "name": "provider/model-current",
                "version": "2026-07-01",
                "checksum": valid_hash,
            },
            "skills": [],
            "functions": [],
            "knowledge": [],
            "integrations": [],
            "policyPacks": [],
            "evaluators": [],
        },
    }
    validate(lock_example, schemas["lock"], "<synthetic-valid-lock>")

    workflow_example = {
        "stateVersion": 1,
        "agentId": "agent_mock_helpdesk",
        "workspaceId": "ws_mock_acme",
        "stage": "DRAFT",
        "candidate": {
            "baseVersionId": "version_mock_1",
            "expectedEtag": "etag_mock_1",
            "manifestSha256": valid_hash,
            "lockSha256": valid_hash,
            "candidateSha256": valid_hash,
            "coreVersion": "0.1.0",
        },
        "evidence": [],
        "history": [
            {
                "from": None,
                "to": "DRAFT",
                "candidateSha256": valid_hash,
                "evidenceIds": [],
                "occurredAt": "2026-07-27T12:00:00Z",
            }
        ],
        "updatedAt": "2026-07-27T12:00:00Z",
    }
    validate(workflow_example, schemas["workflow"], "<synthetic-valid-workflow-state>")

    manifest_path = "examples/helpdesk-agent/raia.agent.yaml"
    manifest = load_yaml(manifest_path)
    validate(manifest, schemas["manifest"], manifest_path)

    for relative in (
        "examples/helpdesk-agent/evals/smoke.eval.yaml",
        "examples/helpdesk-agent/evals/regression.eval.yaml",
    ):
        validate(load_yaml(relative), schemas["eval"], relative)

    policy_path = "examples/helpdesk-agent/policies/default.release-policy.yaml"
    validate(load_yaml(policy_path), schemas["policy"], policy_path)

    for relative in (
        "contracts/mcp-tool-catalog.json",
        "contracts/claude-plugin/.claude-plugin/plugin.json",
        "contracts/claude-plugin/.mcp.json",
        "contracts/claude-plugin/hooks/hooks.json",
    ):
        load_json(relative)

    openapi = load_yaml("contracts/raia-management.openapi.yaml")
    if openapi is not None:
        try:
            validate_spec(openapi)
        except Exception as exc:
            fail(f"OpenAPI standards validation failed: {exc}")
        if openapi.get("openapi") != "3.1.0":
            fail("OpenAPI contract must use version 3.1.0")
        if not openapi.get("paths"):
            fail("OpenAPI contract has no paths")
        for path, item in openapi.get("paths", {}).items():
            for method, operation in item.items():
                if method.lower() not in {"get", "post", "put", "patch", "delete"}:
                    continue
                if not operation.get("operationId"):
                    fail(f"OpenAPI {method.upper()} {path} has no operationId")
        component_schemas = openapi.get("components", {}).get("schemas", {})
        for schema_name in ("AgentBundle", "ArtifactFile", "EvaluationRunRequest", "ReleaseCandidateRequest"):
            if schema_name not in component_schemas:
                fail(f"OpenAPI contract lacks required schema {schema_name}")
        release_required = set(component_schemas.get("ReleaseCandidateRequest", {}).get("required", []))
        if "candidateSha256" not in release_required:
            fail("OpenAPI release request does not require candidateSha256")
        evaluation_required = set(component_schemas.get("EvaluationRunRequest", {}).get("required", []))
        if "suitePaths" not in evaluation_required:
            fail("OpenAPI evaluation request does not require suitePaths")
        management_servers = [server.get("url", "") for server in openapi.get("servers", [])]
        if not management_servers or any("/agent-devkit/v1" not in url for url in management_servers):
            fail("Proposed management API servers must use the explicit /agent-devkit/v1 namespace")
        if any("/api/management/v1" in url for url in management_servers):
            fail("Legacy ambiguous /api/management/v1 namespace remains in proposed management API")

    runtime_openapi = load_json("contracts/vendor/raia-external-api.openapi.json")
    if runtime_openapi is not None:
        try:
            validate_spec(runtime_openapi)
        except Exception as exc:
            fail(f"Pinned runtime OpenAPI standards validation failed: {exc}")
        runtime_paths = runtime_openapi.get("paths", {})
        for required_path in (
            "/external/conversations",
            "/external/conversations/start",
            "/external/conversations/{id}/messages",
        ):
            if required_path not in runtime_paths:
                fail(f"Pinned runtime OpenAPI lacks required path {required_path}")
        if any(path.startswith("/api/v1/") for path in runtime_paths):
            fail("Pinned external runtime contract unexpectedly includes /api/v1 routes")
        if any(not path.startswith("/external/conversations") for path in runtime_paths):
            fail("Pinned runtime projection contains a route outside /external/conversations...")
        security_schemes = runtime_openapi.get("components", {}).get("securitySchemes", {})
        if "Agent-Secret-Key" not in security_schemes:
            fail("Pinned external runtime contract lacks Agent-Secret-Key security scheme")

    raw_runtime_path = ROOT / "contracts/vendor/raia-external-api.raw.openapi.json"
    normalized_runtime_path = ROOT / "contracts/vendor/raia-external-api.openapi.json"
    normalization = load_json("contracts/vendor/raia-external-api.normalization.json")
    if normalization is not None and raw_runtime_path.is_file() and normalized_runtime_path.is_file():
        raw_sha = hashlib.sha256(raw_runtime_path.read_bytes()).hexdigest()
        normalized_sha = hashlib.sha256(normalized_runtime_path.read_bytes()).hexdigest()
        if normalization.get("rawSha256") != raw_sha:
            fail("Vendor raw OpenAPI hash does not match normalization audit log")
        if normalization.get("normalizedSha256") != normalized_sha:
            fail("Vendor normalized OpenAPI hash does not match normalization audit log")
        if normalization.get("sourceUrl") != "https://api.raia2.com/api/external/docs/openapi.json":
            fail("Vendor OpenAPI audit log has an unexpected source URL")
        if normalization.get("profile") != "external-openapi-v1":
            fail("Vendor OpenAPI audit log has an unexpected runtime profile")
        if normalization.get("selectedPaths") != sorted(runtime_openapi.get("paths", {})):
            fail("Vendor OpenAPI selected-path audit does not match normalized contract")
        if not normalization.get("changes"):
            fail("Vendor OpenAPI audit log does not record normalization changes")

    provider_path = ROOT / "contracts/provider-contract.ts"
    provider_text = provider_path.read_text(encoding="utf-8") if provider_path.is_file() else ""
    for token in ("AgentBundle", "candidateSha256: Sha256", "suitePaths: string[]"):
        if token not in provider_text:
            fail(f"Provider contract lacks required token: {token}")

    catalog = load_json("contracts/mcp-tool-catalog.json")
    if catalog is not None:
        names = [tool.get("name") for tool in catalog.get("tools", [])]
        if len(names) != len(set(names)):
            fail("MCP tool names are not unique")
        required_tools = {
            "raia_context_get",
            "raia_project_init",
            "raia_project_pull",
            "raia_agent_validate",
            "raia_agent_diff",
            "raia_evaluation_run",
            "raia_release_create",
            "raia_deployment_staging_create",
            "raia_deployment_get",
            "raia_trace_list",
            "raia_trace_get",
            "raia_trace_to_eval_candidate",
        }
        missing_tools = sorted(required_tools.difference(names))
        if missing_tools:
            fail(f"MCP catalog lacks required workflow tools: {', '.join(missing_tools)}")
        for tool in catalog.get("tools", []):
            tool_schema = tool.get("inputSchema")
            if tool_schema is None:
                fail(f"MCP tool {tool.get('name')} has no input schema")
            else:
                try:
                    Draft202012Validator.check_schema(tool_schema)
                except Exception as exc:
                    fail(f"MCP tool {tool.get('name')} has invalid input schema: {exc}")
        forbidden_fragments = ("production", "shell", "sql", "fetch_url", "secret_get")
        for name in names:
            if any(fragment in name for fragment in forbidden_fragments):
                fail(f"Forbidden MCP capability exposed: {name}")
        staging = next((tool for tool in catalog.get("tools", []) if tool.get("name") == "raia_deployment_staging_create"), None)
        if staging is None:
            fail("MCP catalog lacks staging deployment tool")
        else:
            environment = staging.get("inputSchema", {}).get("properties", {}).get("environment", {})
            if environment.get("const") != "staging":
                fail("MCP deployment environment is not constrained to staging")
        release_tool = next((tool for tool in catalog.get("tools", []) if tool.get("name") == "raia_release_create"), None)
        release_required = set((release_tool or {}).get("inputSchema", {}).get("required", []))
        if "candidateSha256" not in release_required:
            fail("MCP release tool does not require candidateSha256")

    if manifest is not None:
        project = ROOT / "examples/helpdesk-agent"
        artifact_paths: list[str] = []
        spec = manifest.get("spec", {})
        for candidate in (
            spec.get("instructions"),
            spec.get("persona", {}).get("brandVoice"),
        ):
            if isinstance(candidate, dict) and "file" in candidate:
                artifact_paths.append(candidate["file"])
        artifact_paths.extend(spec.get("evaluations", {}).get("suites", []))
        release_policy = spec.get("deployment", {}).get("releasePolicy")
        if release_policy:
            artifact_paths.append(release_policy)
        for relative in artifact_paths:
            path = (project / relative).resolve()
            try:
                path.relative_to(project.resolve())
            except ValueError:
                fail(f"Example reference escapes project root: {relative}")
                continue
            if not path.is_file():
                fail(f"Missing referenced example file: {relative}")

    regression = load_yaml("examples/helpdesk-agent/evals/regression.eval.yaml")
    smoke = load_yaml("examples/helpdesk-agent/evals/smoke.eval.yaml")
    for suite_name, suite in (("smoke", smoke), ("regression", regression)):
        if suite is None:
            continue
        for case in suite.get("spec", {}).get("cases", []):
            for turn in case.get("conversation", {}).get("turns", []):
                fixture_ref = turn.get("fixtureRef")
                if fixture_ref:
                    fixture_path = ROOT / "examples/helpdesk-agent" / fixture_ref
                    if not fixture_path.is_file():
                        fail(f"{suite_name}: missing fixture {fixture_ref}")
                    else:
                        load_json(str(fixture_path.relative_to(ROOT)))

    required_files = (
        "README.md",
        "RAIA_AGENT_DEVKIT_BUILD_SPEC.md",
        "AGENT_LIFECYCLE_FRAMEWORK.md",
        "CLAUDE_CODE_START_PROMPT.md",
        "ACCEPTANCE_CHECKLIST.md",
        "DECISIONS_REQUIRED.md",
        "preflight.mjs",
        "validation-requirements.txt",
        "contracts/provider-contract.ts",
        "contracts/vendor/README.md",
        "contracts/vendor/normalize_vendor_openapi.py",
        "contracts/vendor/raia-external-api.raw.openapi.json",
        "contracts/vendor/raia-external-api.openapi.json",
        "contracts/vendor/raia-external-api.normalization.json",
    )
    for relative in required_files:
        if not (ROOT / relative).is_file():
            fail(f"Missing required package file: {relative}")

    if ERRORS:
        print("Package validation failed:")
        for error in ERRORS:
            print(f"- {error}")
        return 1

    print("Package validation passed.")
    print("Validated 5 JSON Schemas, 4 YAML examples, plugin contracts, MCP catalog, proposed OpenAPI 3.1, pinned runtime OpenAPI 3.0, TypeScript-adjacent references, preflight artifacts, and all local references.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
