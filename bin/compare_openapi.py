"""Compare complete OpenAPI contracts, reporting documentation changes separately."""

import argparse
import json
from pathlib import Path
from urllib.parse import unquote

DOCUMENTATION = {"description", "title", "example", "examples"}
SCHEMA_MAPS = {"properties", "patternProperties", "$defs", "dependentSchemas"}
SCHEMA_ARRAYS = {"allOf", "anyOf", "oneOf", "prefixItems"}
SCHEMA_VALUES = {
    "items",
    "additionalProperties",
    "unevaluatedProperties",
    "propertyNames",
    "not",
    "contains",
    "if",
    "then",
    "else",
    "unevaluatedItems",
    "contentSchema",
}
TYPE_CONSTRAINTS = {
    "string": {"minLength", "maxLength", "pattern", "format"},
    "integer": {
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
    },
    "number": {
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
    },
    "array": {
        "items",
        "prefixItems",
        "minItems",
        "maxItems",
        "uniqueItems",
        "contains",
        "minContains",
        "maxContains",
        "unevaluatedItems",
    },
    "object": {
        "properties",
        "patternProperties",
        "required",
        "additionalProperties",
        "unevaluatedProperties",
        "propertyNames",
        "minProperties",
        "maxProperties",
        "dependentRequired",
        "dependentSchemas",
    },
}


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def metadata_only(schema):
    return all(
        key in {"default", "discriminator", "readOnly", "writeOnly", "deprecated"}
        or key.startswith("x-")
        for key in schema
    )


def normalize(schema):
    if schema is True:
        return {}
    if not isinstance(schema, dict):
        return schema
    result = {}
    for key, value in schema.items():
        if key in DOCUMENTATION:
            continue
        if key in SCHEMA_MAPS:
            value = {name: normalize(child) for name, child in value.items()}
        elif key in SCHEMA_ARRAYS:
            value = [normalize(child) for child in value]
        elif key in SCHEMA_VALUES:
            value = normalize(value)
        result[key] = value

    if result.get("required") == []:
        del result["required"]
    if result.get("properties") == {}:
        del result["properties"]
    if "const" in result and "enum" not in result:
        result["enum"] = [result.pop("const")]
    for key in ("required", "enum", "type"):
        if isinstance(result.get(key), list):
            result[key] = sorted(result[key], key=canonical_json)

    for key in ("allOf", "anyOf", "oneOf"):
        if key not in result:
            continue
        branches = result[key]
        if key == "allOf":
            branches = [
                branch for branch in branches if branch != {} and branch is not True
            ]
            if not branches and result[key]:
                del result[key]
                continue
        result[key] = sorted(branches, key=canonical_json)
        outer = {name: value for name, value in result.items() if name != key}
        if (
            len(branches) == 1
            and isinstance(branches[0], dict)
            and metadata_only(outer)
        ):
            inner = branches[0]
            if all(
                name not in inner
                or canonical_json(inner[name]) == canonical_json(value)
                for name, value in outer.items()
            ):
                return normalize({**inner, **outer})

    # A nullable primitive with type-specific constraints is also expressible
    # as a type array. Keep oneOf distinct, even for disjoint alternatives.
    branches = result.get("anyOf", [])
    non_null = [branch for branch in branches if branch != {"type": "null"}]
    if len(branches) == 2 and len(non_null) == 1:
        inner = non_null[0]
        if isinstance(inner, dict) and isinstance(inner.get("type"), str):
            kind = inner["type"]
            if (
                kind in TYPE_CONSTRAINTS
                and set(inner) <= {"type"} | TYPE_CONSTRAINTS[kind]
            ):
                outer = {key: value for key, value in result.items() if key != "anyOf"}
                if metadata_only(outer) and not set(inner) & set(outer):
                    return normalize({**outer, **inner, "type": [kind, "null"]})
    return result


# Only traverse OpenAPI objects and Schema Objects. Defaults, enum values,
# examples, and extension payloads contain arbitrary JSON, not schema keywords.
OBJECT_FIELDS = {
    "document": {
        "info": "info",
        "components": "components",
        "externalDocs": "external_docs",
    },
    "operation": {"requestBody": "request_body", "externalDocs": "external_docs"},
    "media": {"schema": "schema"},
    "parameter": {"schema": "schema"},
    "header": {"schema": "schema"},
    "security_scheme": {"flows": "oauth_flows"},
    "oauth_flows": {
        key: "oauth_flow"
        for key in ("implicit", "password", "clientCredentials", "authorizationCode")
    },
    "link": {"server": "server"},
    "tag": {"externalDocs": "external_docs"},
    "websocket": {"clientMessage": "schema", "errorMessage": "schema"},
}
OBJECT_FIELDS["path_item"] = {
    method: "operation"
    for method in ("get", "put", "post", "delete", "options", "head", "patch", "trace")
} | {"x-openresponses-websocket": "websocket"}
MAP_FIELDS = {
    "document": {"paths": "path_item", "webhooks": "path_item"},
    "components": {
        "schemas": "schema",
        "responses": "response",
        "parameters": "parameter",
        "examples": "example",
        "requestBodies": "request_body",
        "headers": "header",
        "securitySchemes": "security_scheme",
        "links": "link",
        "callbacks": "callback",
        "pathItems": "path_item",
    },
    "operation": {"responses": "response", "callbacks": "callback"},
    "request_body": {"content": "media"},
    "response": {"headers": "header", "content": "media", "links": "link"},
    "media": {"examples": "example", "encoding": "encoding"},
    "parameter": {"examples": "example", "content": "media"},
    "header": {"examples": "example", "content": "media"},
    "encoding": {"headers": "header"},
    "server": {"variables": "server_variable"},
}
ARRAY_FIELDS = {
    "document": {"servers": "server", "tags": "tag"},
    "path_item": {"parameters": "parameter", "servers": "server"},
    "operation": {"parameters": "parameter", "servers": "server"},
}
DOCUMENTATION_FIELDS = {
    "schema": DOCUMENTATION,
    "info": {"title", "summary", "description"},
    "path_item": {"summary", "description"},
    "operation": {"summary", "description"},
    "parameter": {"description", "example"},
    "header": {"description", "example"},
    "media": {"example"},
    "example": {"summary", "description", "value"},
} | {
    kind: {"description"}
    for kind in (
        "request_body",
        "response",
        "security_scheme",
        "server",
        "server_variable",
        "tag",
        "external_docs",
        "link",
    )
}


def pointer(path, key):
    return f"{path}/{str(key).replace('~', '~0').replace('/', '~1')}"


def child_fields(node, kind):
    """Yield (key, child kind, container) for structural OpenAPI fields."""
    if kind == "schema":
        for key in node:
            if key in SCHEMA_MAPS:
                yield key, "schema", "map"
            elif key in SCHEMA_ARRAYS:
                yield key, "schema", "array"
            elif key in SCHEMA_VALUES:
                yield key, "schema", "object"
        return
    if kind == "callback":
        for key in node:
            if key != "$ref" and not key.startswith("x-"):
                yield key, "path_item", "object"
        return
    for fields, container in (
        (OBJECT_FIELDS, "object"),
        (MAP_FIELDS, "map"),
        (ARRAY_FIELDS, "array"),
    ):
        for key, child_kind in fields.get(kind, {}).items():
            if key in node:
                yield key, child_kind, container


def resolve_reference(document, ref, path):
    if not isinstance(ref, str) or not ref.startswith("#/"):
        raise ValueError(f"Unsupported reference at {path}: {ref}")
    target = document
    indexes_array = False
    try:
        for part in unquote(ref[2:]).split("/"):
            key = part.replace("~1", "/").replace("~0", "~")
            if isinstance(target, list):
                if not key.isascii() or not key.isdigit() or str(int(key)) != key:
                    raise ValueError
                target = target[int(key)]
                indexes_array = True
            else:
                target = target[key]
    except (KeyError, IndexError, TypeError, ValueError):
        raise ValueError(f"Dangling reference at {path}: {ref}") from None
    if indexes_array:
        # Sorting or flattening compositions would change these targets.
        raise ValueError(f"Unsupported array-index reference at {path}: {ref}")


def prepare_document(document):
    """Validate references and separate annotations without editing the input."""
    docs = {}

    def visit(node, kind, path, preserve=False):
        if not isinstance(node, dict):
            return normalize(node) if kind == "schema" and not preserve else node
        preserve = preserve or kind == "websocket"
        fields = DOCUMENTATION_FIELDS.get(kind, set())
        if "$ref" in node:
            resolve_reference(document, node["$ref"], pointer(path, "$ref"))
        if kind == "schema":
            for name, ref in node.get("discriminator", {}).get("mapping", {}).items():
                if ref in document.get("components", {}).get("schemas", {}):
                    continue
                resolve_reference(document, ref, f"{path}/discriminator/mapping/{name}")
        result = dict(node)
        for key, child_kind, container in child_fields(node, kind):
            value = node[key]
            child_path = pointer(path, key)
            if container == "map":
                has_extensions = (kind, key) in {
                    ("document", "paths"),
                    ("operation", "responses"),
                }
                result[key] = {
                    name: child
                    if has_extensions and name.startswith("x-")
                    else visit(
                        child,
                        child_kind,
                        pointer(child_path, name),
                        preserve,
                    )
                    for name, child in value.items()
                }
                if key == "examples" and kind in {"media", "parameter", "header"}:
                    result[key] = {
                        name: child for name, child in result[key].items() if child
                    }
                    if not result[key]:
                        del result[key]
            elif container == "array":
                result[key] = [
                    visit(
                        child,
                        child_kind,
                        pointer(child_path, index),
                        preserve,
                    )
                    for index, child in enumerate(value)
                ]
            else:
                result[key] = visit(value, child_kind, child_path, preserve)
        # Extensions are part of the contract, including their documentation.
        if preserve:
            return node
        for key in fields & node.keys():
            docs[pointer(path, key)] = node[key]
            result.pop(key)
        if kind == "document" and result.get("tags") == []:
            result.pop("tags")
        if kind == "server" and result.get("variables") == {}:
            result.pop("variables")
        if kind == "request_body" and result.get("required") is False:
            result.pop("required")
        return normalize(result) if kind == "schema" else result

    return visit(document, "document", ""), docs


def differences(expected, actual, path=""):
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in sorted(expected.keys() | actual.keys()):
            child_path = pointer(path, key)
            if key not in actual:
                yield f"{child_path}: removed {canonical_json(expected[key])}"
            elif key not in expected:
                yield f"{child_path}: added {canonical_json(actual[key])}"
            else:
                yield from differences(expected[key], actual[key], child_path)
    elif (
        isinstance(expected, list)
        and isinstance(actual, list)
        and len(expected) == len(actual)
    ):
        for index, (before, after) in enumerate(zip(expected, actual)):
            yield from differences(before, after, pointer(path, index))
    elif canonical_json(expected) != canonical_json(actual):
        yield f"{path}: {canonical_json(expected)} -> {canonical_json(actual)}"


def documentation_differences(expected, actual):
    removed = {key: expected[key] for key in expected.keys() - actual.keys()}
    added = {key: actual[key] for key in actual.keys() - expected.keys()}
    changes = [
        f"{key}: {canonical_json(expected[key])} -> {canonical_json(actual[key])}"
        for key in expected.keys() & actual.keys()
        if canonical_json(expected[key]) != canonical_json(actual[key])
    ]

    # Only label unambiguous, identical annotations as moved.
    def identity(path, value):
        return path.rsplit("/", 1)[-1], canonical_json(value)

    for old_path, value in list(removed.items()):
        signature = identity(old_path, value)
        matches = [key for key in added if identity(key, added[key]) == signature]
        if (
            len(matches) == 1
            and sum(identity(key, removed[key]) == signature for key in removed) == 1
        ):
            new_path = matches[0]
            changes.append(f"{old_path} -> {new_path}: moved {canonical_json(value)}")
            del removed[old_path]
            del added[new_path]
    changes.extend(
        f"{key}: removed {canonical_json(value)}" for key, value in removed.items()
    )
    changes.extend(
        f"{key}: added {canonical_json(value)}" for key, value in added.items()
    )
    return sorted(changes)


def compare_documents(baseline, generated):
    expected, expected_docs = prepare_document(baseline)
    actual, actual_docs = prepare_document(generated)
    return list(differences(expected, actual)), documentation_differences(
        expected_docs, actual_docs
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--generated", type=Path, required=True)
    parser.add_argument(
        "--report", type=Path, help="Write the comparison report as JSON."
    )
    parser.add_argument(
        "--check-documentation",
        action="store_true",
        help="Also fail on documentation differences.",
    )
    args = parser.parse_args()
    try:
        baseline = json.loads(args.baseline.read_text())
        generated = json.loads(args.generated.read_text())
        contract, docs = compare_documents(baseline, generated)
        if args.report:
            args.report.write_text(
                json.dumps({"contract": contract, "documentation": docs}, indent=2)
                + "\n"
            )
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Comparison failed: {error}\n")
    print(
        f"Compared {len(baseline['components']['schemas'])} components and all OpenAPI operations."
    )
    print(
        f"Contract: {'DIFFERENT' if contract else 'MATCH'} ({len(contract)} differences)"
    )
    for difference in contract:
        print(f"  {difference}")
    print(
        f"Documentation: {'DIFFERENT' if docs else 'MATCH'} ({len(docs)} differences; reported separately)"
    )
    for difference in docs:
        print(f"  {difference}")
    return bool(contract or (args.check_documentation and docs))


if __name__ == "__main__":
    raise SystemExit(main())
