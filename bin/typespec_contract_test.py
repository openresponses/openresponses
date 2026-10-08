import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


@pytest.fixture(scope="module", params=["openapi.json", "2026-04-24/openapi.json"])
def validate(request):
    path = Path(__file__).resolve().parents[1] / "public/openapi" / request.param
    components = json.loads(path.read_text())["components"]

    def check(component, instance, expected):
        validator = Draft202012Validator(
            {"$ref": f"#/components/schemas/{component}", "components": components}
        )
        errors = list(validator.iter_errors(instance))
        assert (not errors) is expected, [error.message for error in errors]

    return check


JSON_FORMAT = {
    "type": "json_schema",
    "name": "answer",
    "description": None,
    "strict": False,
}
REASONING = {"type": "reasoning", "summary": []}
FUNCTION_OUTPUT = {"type": "function_call_output", "call_id": "call", "output": "ok"}
OUTPUT_TEXT = {"type": "output_text", "text": "hello", "annotations": []}


@pytest.mark.parametrize(
    "component, instance, expected",
    [
        ("JsonSchemaResponseFormat", JSON_FORMAT | {"schema": None}, True),
        ("JsonSchemaResponseFormat", JSON_FORMAT | {"schema": {}}, False),
        ("JsonSchemaResponseFormat", JSON_FORMAT, False),
        ("ReasoningItemParam", REASONING | {"content": None}, True),
        ("ReasoningItemParam", REASONING | {"content": []}, False),
        ("ReasoningItemParam", REASONING, True),
        ("EmptyModelParam", {"extension": [None, {"nested": True}]}, True),
        ("EmptyModelParam", [], False),
    ],
)
def test_null_only_and_open_objects(validate, component, instance, expected):
    validate(component, instance, expected)


@pytest.mark.parametrize("include_type", [True, False])
def test_default_does_not_make_a_required_field_optional(validate, include_type):
    instance = dict(FUNCTION_OUTPUT)
    if not include_type:
        del instance["type"]
    validate("FunctionCallOutputItemParam", instance, include_type)


@pytest.mark.parametrize(
    "length, expected", [(0, False), (1, True), (64, True), (65, False)]
)
def test_function_output_call_id_bounds(validate, length, expected):
    instance = FUNCTION_OUTPUT | {"call_id": "x" * length}
    validate("FunctionCallOutputItemParam", instance, expected)
    validate(
        "FunctionCallOutput", instance | {"id": "fc_123", "status": "completed"}, True
    )


@pytest.mark.parametrize("content_type", ["input_text", "input_video"])
def test_function_output_content_depends_on_direction(validate, content_type):
    content = (
        {"type": "input_text", "text": "hello"}
        if content_type == "input_text"
        else {"type": "input_video", "video_url": "https://example.com/video.mp4"}
    )
    instance = FUNCTION_OUTPUT | {"output": [content]}
    validate("FunctionCallOutputItemParam", instance, True)
    validate(
        "FunctionCallOutput",
        instance | {"id": "fc_123", "status": "completed"},
        content_type == "input_text",
    )


@pytest.mark.parametrize(
    "fields, expected",
    [({}, True), ({"logprobs": []}, True), ({"logprobs": None}, False)],
)
def test_logprobs_are_optional_but_not_nullable(validate, fields, expected):
    validate("OutputTextContent", OUTPUT_TEXT | fields, expected)


@pytest.mark.parametrize(
    "count, value_length, expected",
    [(16, 512, True), (17, 512, False), (16, 513, False)],
)
def test_metadata_limits(validate, count, value_length, expected):
    instance = {str(index): "x" * value_length for index in range(count)}
    validate("MetadataParam", instance, expected)


def test_metadata_does_not_enforce_the_documented_key_length(validate):
    validate("MetadataParam", {"x" * 65: "value"}, True)


def test_websocket_accepts_a_normal_request(validate):
    validate(
        "WebSocketResponseCreateEvent",
        {"type": "response.create", "input": "hello"},
        True,
    )


@pytest.mark.parametrize(
    "field, value",
    [
        ("stream", True),
        ("stream", None),
        ("stream_options", {}),
        ("stream_options", None),
        ("background", True),
        ("background", None),
    ],
)
def test_websocket_rejects_http_only_fields(validate, field, value):
    validate(
        "WebSocketResponseCreateEvent", {"type": "response.create", field: value}, False
    )
