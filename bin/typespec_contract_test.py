import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


@pytest.fixture(scope="module", params=["openapi.json", "2026-04-24/openapi.json"])
def validate(request):
    path = Path(__file__).resolve().parents[1] / "public/openapi" / request.param
    return schema_validator(json.loads(path.read_text()))


def schema_validator(document):
    components = document["components"]

    def check(component, instance, expected):
        assert component in components["schemas"], f"Missing schema: {component}"
        validator = Draft202012Validator(
            {"$ref": f"#/components/schemas/{component}", "components": components}
        )
        errors = list(validator.iter_errors(instance))
        assert (not errors) is expected, [error.message for error in errors]

    return check


@pytest.fixture(scope="module")
def current_document():
    path = Path(__file__).resolve().parents[1] / "public/openapi/openapi.json"
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def validate_current(current_document):
    return schema_validator(current_document)


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


STEER = {
    "type": "response.steer",
    "previous_response_id": "resp_123",
    "input": "Focus on the database changes.",
}


@pytest.mark.parametrize(
    "input, expected",
    [
        ("Focus on the database changes.", True),
        ([{"role": "user", "content": "Keep the API unchanged."}], True),
        (
            [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "Use this example."},
                        {
                            "type": "input_image",
                            "image_url": "https://example.com/db.png",
                        },
                        {
                            "type": "input_file",
                            "file_url": "https://example.com/schema.sql",
                        },
                    ],
                }
            ],
            True,
        ),
        ([], False),
        (None, False),
        ([{"role": "assistant", "content": "hello"}], False),
        ([{"role": "system", "content": "hello"}], False),
        ([{"role": "developer", "content": "hello"}], False),
        ([FUNCTION_OUTPUT], False),
        ([{"type": "item_reference", "id": "msg_123"}], False),
        ([{"role": "user", "content": "hello", "id": "msg_123"}], False),
        ([{"role": "user", "content": "hello", "status": "completed"}], False),
        ([{"type": "other", "role": "user", "content": "hello"}], False),
        (
            [{"role": "user", "content": [{"type": "output_text", "text": "hello"}]}],
            False,
        ),
        (
            [
                {
                    "role": "user",
                    "content": [{"type": "input_video", "video_url": "video"}],
                }
            ],
            False,
        ),
    ],
)
def test_websocket_steering_only_accepts_user_input(validate_current, input, expected):
    validate_current("WebSocketResponseSteerEvent", STEER | {"input": input}, expected)


@pytest.mark.parametrize("field", ["type", "previous_response_id", "input"])
def test_websocket_steering_requires_all_request_fields(validate_current, field):
    instance = dict(STEER)
    del instance[field]
    validate_current("WebSocketResponseSteerEvent", instance, False)


@pytest.mark.parametrize(
    "extra",
    [
        {"model": "example-model"},
        {"tools": []},
        {"instructions": "new instructions"},
        {"stream": True},
        {"stream_options": {}},
        {"background": True},
        {"stream_id": "another-lane"},
    ],
)
def test_websocket_steering_rejects_request_overrides(validate_current, extra):
    validate_current("WebSocketResponseSteerEvent", STEER | extra, False)


@pytest.mark.parametrize("stream_fields", [{}, {"stream_id": "lane_123"}])
def test_websocket_steering_acceptance_identifies_queued_submission(
    validate_current, stream_fields
):
    accepted = {
        "type": "response.steer.accepted",
        "sequence_number": 1,
        "steer": {"id": "steer_123", "previous_response_id": "resp_123"},
    } | stream_fields
    validate_current("WebSocketResponseSteerAcceptedEvent", accepted, True)
    del accepted["steer"]["id"]
    validate_current("WebSocketResponseSteerAcceptedEvent", accepted, False)


@pytest.mark.parametrize("steering_id", [{}, {"id": "steer_123"}])
@pytest.mark.parametrize("input", [STEER["input"], None, [FUNCTION_OUTPUT]])
def test_websocket_steering_failure_returns_original_rejected_input(
    validate_current, steering_id, input
):
    failed = {
        "type": "response.steer.failed",
        "sequence_number": 1,
        "steer": {"previous_response_id": "resp_123", "input": input} | steering_id,
        "error": {
            "type": "invalid_request_error",
            "code": "invalid_input",
            "message": "The steering input is invalid.",
        },
    }
    validate_current("WebSocketResponseSteerFailedEvent", failed, True)
    del failed["error"]["type"]
    validate_current("WebSocketResponseSteerFailedEvent", failed, False)


@pytest.mark.parametrize(
    "required_input, expected",
    [
        (
            [
                {
                    "type": "function_call_output",
                    "call_id": "call_123",
                    "name": "read_db",
                }
            ],
            True,
        ),
        ([{"type": "function_call_output", "call_id": "call_123"}], False),
        ([{"type": "function_call_output", "name": "read_db"}], False),
        ([{"type": "vendor:approval", "approval_request_id": "approval_123"}], True),
        ([{"approval_request_id": "approval_123"}], False),
    ],
)
def test_websocket_pending_steering_identifies_required_input(
    validate_current, required_input, expected
):
    validate_current(
        "WebSocketResponseSteerPendingEvent",
        {
            "type": "response.steer.pending",
            "sequence_number": 2,
            "steer": {"id": "steer_123", "previous_response_id": "resp_123"},
            "reason": "waiting_for_required_input",
            "required_input": required_input,
            "stream_id": "lane_123",
        },
        expected,
    )


def test_websocket_advertises_the_steering_client_event(current_document):
    websocket = current_document["paths"]["/responses"]["x-openresponses-websocket"]
    validator = Draft202012Validator(
        websocket["clientMessage"] | {"components": current_document["components"]}
    )
    assert validator.is_valid(STEER)
    assert not validator.is_valid({"type": "response.steer.accepted"})


@pytest.mark.parametrize(
    "event_type, details",
    [
        ("response.steer.accepted", {}),
        (
            "response.steer.pending",
            {
                "reason": "waiting_for_required_input",
                "required_input": [
                    {
                        "type": "function_call_output",
                        "call_id": "call_123",
                        "name": "read_db",
                    }
                ],
            },
        ),
        (
            "response.steer.failed",
            {
                "steer": {"previous_response_id": "resp_123", "input": STEER["input"]},
                "error": {
                    "type": "invalid_request_error",
                    "code": "response_not_found",
                    "message": "The target response is not on this connection.",
                },
            },
        ),
    ],
)
def test_steering_notifications_are_websocket_only(
    current_document, event_type, details
):
    response_path = current_document["paths"]["/responses"]
    notification = {
        "type": event_type,
        "sequence_number": 1,
        "steer": {"id": "steer_123", "previous_response_id": "resp_123"},
    } | details
    websocket_schema = response_path["x-openresponses-websocket"]["steeringMessage"]
    sse_content = response_path["post"]["responses"]["200"]["content"]["text/event-stream"]
    sse_schema = sse_content["schema"]
    for schema, expected in [(websocket_schema, True), (sse_schema, False)]:
        validator = Draft202012Validator(
            schema | {"components": current_document["components"]}
        )
        assert validator.is_valid(notification) is expected
