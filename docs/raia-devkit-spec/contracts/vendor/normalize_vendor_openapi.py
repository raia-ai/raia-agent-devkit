from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raia-external-api.raw.openapi.json"
NORMALIZED = ROOT / "raia-external-api.openapi.json"
PATCH_LOG = ROOT / "raia-external-api.normalization.json"
SOURCE_URL = "https://api.raia2.com/api/external/docs/openapi.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def collect_refs(node: object) -> set[str]:
    refs: set[str] = set()
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str):
            refs.add(ref)
        for value in node.values():
            refs.update(collect_refs(value))
    elif isinstance(node, list):
        for value in node:
            refs.update(collect_refs(value))
    return refs


def decode_pointer(part: str) -> str:
    return part.replace("~1", "/").replace("~0", "~")


def resolve_component(document: dict[str, Any], ref: str) -> tuple[str, str, object]:
    prefix = "#/components/"
    if not ref.startswith(prefix):
        raise ValueError(f"Unsupported non-component reference in runtime projection: {ref}")
    parts = [decode_pointer(part) for part in ref[len(prefix) :].split("/")]
    if len(parts) != 2:
        raise ValueError(f"Unsupported nested component reference: {ref}")
    group, name = parts
    try:
        value = document["components"][group][name]
    except KeyError as exc:
        raise ValueError(f"Published runtime contract has dangling reference: {ref}") from exc
    return group, name, value


def project_conversation_contract(document: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    selected_paths = {
        route: deepcopy(item)
        for route, item in document.get("paths", {}).items()
        if route.startswith("/external/conversations")
    }
    required = {
        "/external/conversations",
        "/external/conversations/start",
        "/external/conversations/{id}/messages",
    }
    missing = sorted(required.difference(selected_paths))
    if missing:
        raise ValueError(f"Published runtime contract lacks required conversation paths: {missing}")

    projected: dict[str, Any] = {
        "openapi": document["openapi"],
        "info": deepcopy(document["info"]),
        "paths": selected_paths,
        "components": {},
    }
    if "servers" in document:
        projected["servers"] = deepcopy(document["servers"])

    security_schemes = document.get("components", {}).get("securitySchemes")
    if security_schemes:
        projected["components"]["securitySchemes"] = deepcopy(security_schemes)

    pending = sorted(collect_refs(selected_paths))
    seen: set[str] = set()
    while pending:
        ref = pending.pop(0)
        if ref in seen:
            continue
        seen.add(ref)
        group, name, source = resolve_component(document, ref)
        projected["components"].setdefault(group, {})[name] = deepcopy(source)
        pending.extend(sorted(collect_refs(source).difference(seen)))

    return projected, sorted(selected_paths)


def default_matches_type(value: object, declared: object) -> bool:
    declared_types = declared if isinstance(declared, list) else [declared]
    for item in declared_types:
        if item == "object" and isinstance(value, dict):
            return True
        if item == "array" and isinstance(value, list):
            return True
        if item == "string" and isinstance(value, str):
            return True
        if item == "integer" and isinstance(value, int) and not isinstance(value, bool):
            return True
        if item == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
            return True
        if item == "boolean" and isinstance(value, bool):
            return True
        if item == "null" and value is None:
            return True
    return False


def remove_invalid_defaults(node: object, path: str, changes: list[dict[str, str]]) -> None:
    if isinstance(node, dict):
        if "default" in node and "type" in node and not default_matches_type(node["default"], node["type"]):
            removed = node.pop("default")
            changes.append(
                {
                    "path": path,
                    "change": f"Removed default {removed!r} because it contradicts declared type {node['type']!r}.",
                }
            )
        for key, value in list(node.items()):
            remove_invalid_defaults(value, f"{path}.{key}" if path else key, changes)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            remove_invalid_defaults(value, f"{path}[{index}]", changes)


def repair_response_schemas(document: dict[str, Any], changes: list[dict[str, str]]) -> None:
    for route, path_item in document.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in {"get", "put", "post", "delete", "options", "head", "patch", "trace"}:
                continue
            if not isinstance(operation, dict):
                continue
            for status, response in operation.get("responses", {}).items():
                if not isinstance(response, dict) or "schema" not in response:
                    continue
                schema = response.pop("schema")
                content = response.setdefault("content", {})
                media = content.setdefault("application/json", {})
                media.setdefault("schema", schema)
                changes.append(
                    {
                        "path": f"paths.{route}.{method}.responses.{status}",
                        "change": "Moved invalid response-level schema into content.application/json.schema; preserved existing content schema when present.",
                    }
                )


def main() -> None:
    raw_bytes = RAW.read_bytes()
    source = json.loads(raw_bytes)
    normalized, selected_paths = project_conversation_contract(source)
    changes: list[dict[str, str]] = [
        {
            "path": "paths",
            "change": f"Projected {len(selected_paths)} /external/conversations... paths and their transitive component references for the external-openapi-v1 runtime profile.",
        }
    ]
    repair_response_schemas(normalized, changes)
    remove_invalid_defaults(normalized, "", changes)

    normalized_bytes = (json.dumps(normalized, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    NORMALIZED.write_bytes(normalized_bytes)
    component_counts = {
        group: len(items)
        for group, items in normalized.get("components", {}).items()
        if isinstance(items, dict)
    }
    PATCH_LOG.write_text(
        json.dumps(
            {
                "sourceUrl": SOURCE_URL,
                "retrievedAt": "2026-07-27",
                "rawSha256": sha256(raw_bytes),
                "normalizedSha256": sha256(normalized_bytes),
                "normalizer": "normalize_vendor_openapi.py",
                "profile": "external-openapi-v1",
                "selectedPaths": selected_paths,
                "includedComponentCounts": component_counts,
                "changes": changes,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Generated external-openapi-v1 with {len(selected_paths)} paths and {len(changes)} auditable change records.")


if __name__ == "__main__":
    main()
