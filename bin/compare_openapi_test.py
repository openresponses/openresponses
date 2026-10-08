import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest
from compare_openapi import compare_documents, normalize


@pytest.fixture
def documents():
    baseline = json.loads(
        (
            Path(__file__).resolve().parents[1]
            / "public/openapi/2026-04-24/openapi.json"
        ).read_text()
    )
    return baseline, copy.deepcopy(baseline)


def test_complete_archived_document_matches_without_mutation(documents):
    baseline, generated = documents
    original = copy.deepcopy(generated)
    assert compare_documents(baseline, generated) == ([], [])
    assert generated == original


@pytest.mark.parametrize(
    ("name", "path", "value"),
    [
        ("FunctionToolParam", ("required",), ["name"]),
        ("FunctionToolParam", ("properties", "description"), {"type": "string"}),
        ("FunctionToolParam", ("properties", "type", "default"), "wrong"),
        ("FunctionCallItemParam", ("properties", "name", "maxLength"), 65),
        (
            "ResponseOutputTextDeltaStreamingEvent",
            ("properties", "sequence_number", "format"),
            "int64",
        ),
        ("EmptyModelParam", ("additionalProperties",), False),
        ("Annotation", ("discriminator", "propertyName"), "wrong"),
        (
            "AssistantMessageItemParam",
            ("properties", "phase", "x-openresponses-added-in"),
            "wrong",
        ),
        (
            "FunctionCall",
            ("properties", "status", "allOf"),
            [{"$ref": "#/components/schemas/FunctionCallOutputStatusEnum"}],
        ),
    ],
)
def test_contract_mutations_fail(documents, name, path, value):
    baseline, generated = documents
    target = generated["components"]["schemas"][name]
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    contract, _ = compare_documents(baseline, generated)
    assert contract


@pytest.mark.parametrize("mutation", ["missing", "extra", "dangling"])
def test_component_graph_changes_fail(documents, mutation):
    baseline, generated = documents
    schemas = generated["components"]["schemas"]
    if mutation == "missing":
        del schemas["InputVideoContent"]
    elif mutation == "extra":
        schemas["UnusedHelper"] = {"type": "string"}
    else:
        schemas["FunctionToolParam"]["properties"]["parameters"] = {
            "$ref": "#/components/schemas/Missing"
        }
    if mutation == "extra":
        assert compare_documents(baseline, generated)[0]
    else:
        with pytest.raises(ValueError):
            compare_documents(baseline, generated)


def test_documentation_moves_are_reported_without_contract_drift(documents):
    baseline, generated = documents
    status = generated["components"]["schemas"]["FunctionCall"]["properties"]["status"]
    reference, description = status.pop("allOf")
    status.update(reference | description)
    contract, docs = compare_documents(baseline, generated)
    assert not contract
    assert docs


def test_documentation_only_allof_preserves_contract(documents):
    baseline, generated = documents
    strict = generated["components"]["schemas"]["FunctionToolParam"]["properties"][
        "strict"
    ]
    strict["allOf"] = [{"description": "Strict mode."}]
    contract, docs = compare_documents(baseline, generated)
    assert not contract
    assert docs


@pytest.mark.parametrize("key", ["default", "x-settings"])
def test_conflicting_boolean_and_numeric_metadata_are_preserved(key):
    combined = {
        "allOf": [{"type": "object", key: {"values": [True]}}],
        key: {"values": [1]},
    }
    flattened = {"type": "object", key: {"values": [1]}}
    assert normalize(combined) != normalize(flattened)


def test_supported_representation_changes_preserve_contract(documents):
    baseline, generated = documents
    schemas = generated["components"]["schemas"]
    tool = schemas["FunctionToolParam"]
    tool["required"].reverse()
    discriminator = tool["properties"]["type"]
    discriminator["const"] = discriminator.pop("enum")[0]
    tool["properties"]["description"] = {"type": ["null", "string"]}
    schemas["EmptyModelParam"].pop("required")
    schemas["EmptyModelParam"].pop("properties")
    annotations = schemas["OutputTextContentParam"]["properties"]["annotations"]
    annotations.update(annotations.pop("oneOf")[0])
    assert not compare_documents(baseline, generated)[0]


def test_oneof_exclusivity_and_metadata_survive_normalization():
    branches = [{"type": "number"}, {"type": "integer"}]
    assert normalize({"oneOf": branches}) != normalize({"anyOf": branches})
    assert normalize({"oneOf": branches * 2}) != normalize({"oneOf": branches})
    assert normalize(
        {
            "allOf": [{"properties": {"x": {"type": "string"}}}],
            "additionalProperties": False,
        }
    ) != normalize(
        {"properties": {"x": {"type": "string"}}, "additionalProperties": False}
    )
    schema = {
        "properties": {"description": {"type": "string"}},
        "default": {"description": "kept"},
        "x-data": {"description": "kept"},
    }
    assert normalize(schema) == schema


def test_nullable_constraints_are_not_weakened():
    union = {"anyOf": [{"type": "string", "maxLength": 3}, {"type": "null"}]}
    assert normalize(union) == normalize({"type": ["string", "null"], "maxLength": 3})
    assert normalize(union) != normalize({"type": ["string", "null"]})
    nullable_object = {
        "anyOf": [
            {"type": "object", "properties": {"x": {"type": "string"}}},
            {"type": "null"},
        ],
        "additionalProperties": False,
    }
    flattened_object = {
        "type": ["object", "null"],
        "properties": {"x": {"type": "string"}},
        "additionalProperties": False,
    }
    assert normalize(nullable_object) != normalize(flattened_object)


@pytest.mark.parametrize("as_property", [False, True])
def test_true_and_empty_schemas_are_equivalent_but_false_is_not(documents, as_property):
    baseline, generated = documents
    expected = {"type": "object", "additionalProperties": True} if as_property else True
    actual = {"type": "object", "additionalProperties": {}} if as_property else {}
    baseline["components"]["schemas"]["Permissive"] = expected
    generated["components"]["schemas"]["Permissive"] = actual
    assert compare_documents(baseline, generated) == ([], [])
    if as_property:
        actual["additionalProperties"] = False
    else:
        generated["components"]["schemas"]["Permissive"] = False
    assert compare_documents(baseline, generated)[0]
    assert normalize({"default": True, "x-value": True}) != normalize(
        {"default": {}, "x-value": {}}
    )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("openapi",), "3.0.3"),
        (("info", "version"), "2026-01-01"),
        (("servers", 0, "url"), "https://different.example.com"),
        (("components", "securitySchemes", "ApiKeyAuth", "scheme"), "basic"),
        (("security",), [{"ApiKeyAuth": []}]),
        (("paths", "/responses", "post", "operationId"), "otherOperation"),
        (("paths", "/responses", "post", "security"), [{"ApiKeyAuth": []}]),
        (("paths", "/responses", "post", "requestBody", "required"), True),
        (
            (
                "paths",
                "/responses",
                "post",
                "responses",
                "200",
                "content",
                "text/event-stream",
                "schema",
                "oneOf",
            ),
            [],
        ),
        (
            ("paths", "/responses", "post", "responses", "400"),
            {"description": "Bad request"},
        ),
        (("paths", "/responses", "get"), {"responses": {"200": {"description": "OK"}}}),
        (("paths", "/extra"), {}),
        (
            ("paths", "/responses/compact", "post", "x-openresponses-added-in"),
            "2026-01-01",
        ),
        (
            ("paths", "/responses", "x-openresponses-websocket", "description"),
            "Different extension payload",
        ),
    ],
)
def test_document_and_operation_contract_changes_fail(documents, path, value):
    baseline, generated = documents
    target = generated
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    assert compare_documents(baseline, generated)[0]


@pytest.mark.parametrize(
    "path",
    [
        ("paths", "/responses/compact"),
        ("paths", "/responses", "post"),
        (
            "paths",
            "/responses",
            "post",
            "requestBody",
            "content",
            "application/x-www-form-urlencoded",
        ),
        (
            "paths",
            "/responses",
            "post",
            "responses",
            "200",
            "content",
            "text/event-stream",
        ),
        ("paths", "/responses", "post", "responses", "200"),
        ("components", "securitySchemes"),
    ],
)
def test_removed_operations_and_content_fail(documents, path):
    baseline, generated = documents
    target = generated
    for key in path[:-1]:
        target = target[key]
    del target[path[-1]]
    assert compare_documents(baseline, generated)[0]


def test_operation_documentation_changes_are_separate(documents):
    baseline, generated = documents
    operation = generated["paths"]["/responses"]["post"]
    operation["description"] = "Updated operation docs"
    del operation["summary"]
    operation["requestBody"]["content"]["application/json"]["examples"] = {
        "sample": {"value": {"$ref": "not a reference", "description": "Literal data"}}
    }
    contract, docs = compare_documents(baseline, generated)
    assert not contract
    assert len(docs) == 3
    assert any("Updated operation docs" in change for change in docs)
    assert any("Create response" in change and "removed" in change for change in docs)
    assert any("Literal data" in change for change in docs)


@pytest.mark.parametrize("location", ["media", "parameter", "header"])
@pytest.mark.parametrize("metadata", ["x-settings", "externalValue"])
def test_example_metadata_is_part_of_the_contract(documents, location, metadata):
    baseline, generated = documents
    for document in (baseline, generated):
        if location == "media":
            target = document["paths"]["/responses"]["post"]["requestBody"]["content"][
                "application/json"
            ]
        else:
            document["components"][f"{location}s"] = {
                "sample": {"schema": {"type": "string"}}
            }
            target = document["components"][f"{location}s"]["sample"]
            if location == "parameter":
                target.update(name="sample", **{"in": "query"})
        target["examples"] = {
            "sample": {"description": "Example", metadata: "original"}
        }
    assert compare_documents(baseline, generated) == ([], [])
    # target belongs to generated after the loop.
    target["examples"]["sample"][metadata] = "changed"
    contract, docs = compare_documents(baseline, generated)
    assert contract and not docs
    del target["examples"]
    assert compare_documents(baseline, generated)[0]


@pytest.mark.parametrize("key", ["default", "enum", "const", "x-payload"])
def test_schema_literal_json_remains_exact(documents, key):
    baseline, generated = documents
    literal = {
        "$ref": "#/missing",
        "description": "Literal data",
        "required": ["b", "a"],
        "value": True,
    }
    value = [literal] if key == "enum" else literal
    for document in (baseline, generated):
        document["components"]["schemas"]["Literal"] = {key: copy.deepcopy(value)}
    assert compare_documents(baseline, generated) == ([], [])
    actual = generated["components"]["schemas"]["Literal"][key]
    if key == "enum":
        actual = actual[0]
    actual["value"] = 1
    assert compare_documents(baseline, generated)[0]
    actual["value"] = True
    actual["required"].reverse()
    assert compare_documents(baseline, generated)[0]
    actual["required"].reverse()
    actual["description"] = "Changed literal data"
    contract, docs = compare_documents(baseline, generated)
    assert contract and not docs


@pytest.mark.parametrize("location", ["paths", "responses"])
def test_map_extensions_remain_literal_json(documents, location):
    baseline, generated = documents
    for document in (baseline, generated):
        target = document["paths"]
        if location == "responses":
            target = target["/responses"]["post"]["responses"]
        target["x-settings"] = {"description": "literal", "$ref": "not a reference"}
    assert compare_documents(baseline, generated) == ([], [])
    target = generated["paths"]
    if location == "responses":
        target = target["/responses"]["post"]["responses"]
    target["x-settings"]["description"] = "changed"
    contract, docs = compare_documents(baseline, generated)
    assert contract and not docs


@pytest.mark.parametrize(
    "location", ["schema", "operation", "websocket", "discriminator"]
)
def test_dangling_references_fail_in_every_contract_surface(documents, location):
    baseline, generated = documents
    schemas = generated["components"]["schemas"]
    ref = {"$ref": "#/components/schemas/Missing"}
    if location == "schema":
        schemas["Unreferenced"] = ref
    elif location == "operation":
        generated["paths"]["/responses"]["post"]["responses"]["200"] = ref
    elif location == "websocket":
        generated["paths"]["/responses"]["x-openresponses-websocket"][
            "clientMessage"
        ] = ref
    else:
        schemas["Annotation"]["discriminator"]["mapping"] = {"missing": ref["$ref"]}
    with pytest.raises(ValueError, match="Dangling reference"):
        compare_documents(baseline, generated)


def test_references_resolve_escaped_paths_and_response_components(documents):
    baseline, generated = documents
    for document in (baseline, generated):
        document["components"]["schemas"]["a/b~c"] = {"type": "string"}
        document["components"]["responses"] = {
            "shared": {
                "description": "Shared response",
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/a~1b~0c"}
                    }
                },
            }
        }
        document["paths"]["/responses"]["post"]["responses"]["400"] = {
            "$ref": "#/components/responses/shared"
        }
    assert compare_documents(baseline, generated) == ([], [])
    del generated["components"]["schemas"]["a/b~c"]
    with pytest.raises(ValueError, match="Dangling reference"):
        compare_documents(baseline, generated)


@pytest.mark.parametrize("index", ["-1", "00", "99"])
def test_invalid_array_reference_indices_fail(documents, index):
    baseline, generated = documents
    generated["components"]["schemas"]["InvalidReference"] = {
        "$ref": f"#/components/schemas/Annotation/oneOf/{index}"
    }
    with pytest.raises(ValueError, match="Dangling reference"):
        compare_documents(baseline, generated)


@pytest.mark.parametrize("composition", ["allOf", "anyOf", "oneOf"])
def test_array_references_cannot_hide_retargeted_compositions(documents, composition):
    baseline, generated = documents
    for document in (baseline, generated):
        document["components"]["schemas"]["Branches"] = {
            composition: [{"type": "string"}, {"type": "number"}]
        }
        document["components"]["schemas"]["SelectedBranch"] = {
            "$ref": f"#/components/schemas/Branches/{composition}/0"
        }
    generated["components"]["schemas"]["Branches"][composition].reverse()
    with pytest.raises(ValueError, match="Unsupported array-index reference"):
        compare_documents(baseline, generated)


def test_cli_reports_docs_and_fails_on_contract_drift(documents, tmp_path):
    baseline, generated = documents
    expected = tmp_path / "baseline.json"
    actual = tmp_path / "generated.json"
    report = tmp_path / "report.json"
    expected.write_text(json.dumps(baseline))
    generated["paths"]["/responses"]["post"]["description"] = "Updated docs"
    command = [
        sys.executable,
        str(Path(__file__).with_name("compare_openapi.py")),
        "--baseline",
        str(expected),
        "--generated",
        str(actual),
        "--report",
        str(report),
    ]
    actual.write_text(json.dumps(generated))
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert not json.loads(report.read_text())["contract"]
    assert json.loads(report.read_text())["documentation"]
    result = subprocess.run(
        command + ["--check-documentation"], capture_output=True, text=True, check=False
    )
    assert result.returncode == 1
    actual.write_text(json.dumps(baseline))
    result = subprocess.run(
        command + ["--check-documentation"], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    generated["info"]["version"] = "other-version"
    actual.write_text(json.dumps(generated))
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 1
    assert json.loads(report.read_text())["contract"]
