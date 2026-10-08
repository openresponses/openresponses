import "@typespec/http";
import "@typespec/openapi";
import "@typespec/openapi3";

using TypeSpec.Http;
using TypeSpec.OpenAPI;
using OpenResponsesSchema;

@service(#{ title: "Open Responses" })
@info(#{ version: "2026-04-24" })
@server("https://api.openai.com/v1", "")
@extension(
  "x-openresponses-security-schemes",
  #{ ApiKeyAuth: #{ type: "http", scheme: "bearer", in: "header" } }
)
namespace OpenResponses;

alias StreamingEvent =
  | ResponseCreatedStreamingEvent
  | ResponseQueuedStreamingEvent
  | ResponseInProgressStreamingEvent
  | ResponseCompletedStreamingEvent
  | ResponseFailedStreamingEvent
  | ResponseIncompleteStreamingEvent
  | ResponseOutputItemAddedStreamingEvent
  | ResponseOutputItemDoneStreamingEvent
  | ResponseReasoningSummaryPartAddedStreamingEvent
  | ResponseReasoningSummaryPartDoneStreamingEvent
  | ResponseContentPartAddedStreamingEvent
  | ResponseContentPartDoneStreamingEvent
  | ResponseOutputTextDeltaStreamingEvent
  | ResponseOutputTextDoneStreamingEvent
  | ResponseRefusalDeltaStreamingEvent
  | ResponseRefusalDoneStreamingEvent
  | ResponseReasoningDeltaStreamingEvent
  | ResponseReasoningDoneStreamingEvent
  | ResponseReasoningSummaryDeltaStreamingEvent
  | ResponseReasoningSummaryDoneStreamingEvent
  | ResponseOutputTextAnnotationAddedStreamingEvent
  | ResponseFunctionCallArgumentsDeltaStreamingEvent
  | ResponseFunctionCallArgumentsDoneStreamingEvent
  | ErrorStreamingEvent;

/** Success */
model SuccessfulResponse<
  Body,
  ContentType extends string = "application/json"
> {
  @statusCode statusCode: 200;
  @header contentType: ContentType;

  @body
  @oneOfBody("type")
  body: Body;
}

/** Creates a response. */
@route("/responses")
@post
@summary("Create response")
@operationId("createResponse")
@extension(
  "x-openresponses-websocket",
  #{
    description: "Open a WebSocket connection to `/v1/responses`. Send client events using the WebSocketResponseCreateEvent schema. Server progress messages use the same streaming event schemas as `text/event-stream` responses. WebSocket failures use the WebSocketErrorEvent schema.",
    clientMessage: #{
      $ref: "#/components/schemas/WebSocketResponseCreateEvent",
    },
    errorMessage: #{ $ref: "#/components/schemas/WebSocketErrorEvent" },
    `x-openresponses-added-in`: "2026-04-24",
  }
)
op createResponse(
  @header contentType: "application/json" | "application/x-www-form-urlencoded",
  @body body?: CreateResponseBody,
): SuccessfulResponse<ResponseResource> | SuccessfulResponse<
  StreamingEvent,
  "text/event-stream"
>;

/** Compact a conversation. Returns a compacted response object. */
@route("/responses/compact")
@post
@summary("Compact a response")
@operationId("compactResponse")
@extension("x-openresponses-added-in", "2026-04-24")
op compactResponse(
  @body body?: CompactResponseMethodPublicBody,
): SuccessfulResponse<CompactResource>;
