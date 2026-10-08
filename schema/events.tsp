using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

@summary("Response created event")
@doc("A streaming event that indicated the response was created.")
model ResponseCreatedStreamingEvent {
  @doc("The type of the event, always `response.created`.")
  type: "response.created" = "response.created";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The response snapshot that was emitted with the event.")
  response: ResponseResource;
}

@summary("Response queued event")
@doc("A streaming event that indicated the response was queued.")
model ResponseQueuedStreamingEvent {
  @doc("The type of the event, always `response.queued`.")
  type: "response.queued" = "response.queued";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The response snapshot that was emitted with the event.")
  response: ResponseResource;
}

@summary("Response in progress event")
@doc("A streaming event that indicated the response was in progress.")
model ResponseInProgressStreamingEvent {
  @doc("The type of the event, always `response.in_progress`.")
  type: "response.in_progress" = "response.in_progress";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The response snapshot that was emitted with the event.")
  response: ResponseResource;
}

@summary("Response completed event")
@doc("A streaming event that indicated the response was completed.")
model ResponseCompletedStreamingEvent {
  @doc("The type of the event, always `response.completed`.")
  type: "response.completed" = "response.completed";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The response snapshot that was emitted with the event.")
  response: ResponseResource;
}

@summary("Response failed event")
@doc("A streaming event that indicated the response had failed.")
model ResponseFailedStreamingEvent {
  @doc("The type of the event, always `response.failed`.")
  type: "response.failed" = "response.failed";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The response snapshot that was emitted with the event.")
  response: ResponseResource;
}

@summary("Response incomplete event")
@doc("A streaming event that indicated the response was incomplete.")
model ResponseIncompleteStreamingEvent {
  @doc("The type of the event, always `response.incomplete`.")
  type: "response.incomplete" = "response.incomplete";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The response snapshot that was emitted with the event.")
  response: ResponseResource;
}

@summary("Response output item added event")
@doc("A streaming event that indicated an output item was added to the response.")
model ResponseOutputItemAddedStreamingEvent {
  @doc("The type of the event, always `response.output_item.added`.")
  type: "response.output_item.added" = "response.output_item.added";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The index of the output item that was added.")
  output_index: integer;

  @refDoc("An item representing a message, tool call, tool output, reasoning, or other response element.")
  item: ItemField | null;
}

@summary("Response output item done event")
@doc("A streaming event that indicated an output item was completed.")
model ResponseOutputItemDoneStreamingEvent {
  @doc("The type of the event, always `response.output_item.done`.")
  type: "response.output_item.done" = "response.output_item.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The index of the output item that was completed.")
  output_index: integer;

  @refDoc("An item representing a message, tool call, tool output, reasoning, or other response element.")
  item: ItemField | null;
}

@summary("Response reasoning summary part added event")
@doc("A streaming event that indicated a reasoning summary part was added.")
model ResponseReasoningSummaryPartAddedStreamingEvent {
  @doc("The type of the event, always `response.reasoning_summary_part.added`.")
  type: "response.reasoning_summary_part.added" = "response.reasoning_summary_part.added";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the summary part that was added.")
  summary_index: integer;

  @doc("A content part that makes up an input or output item.")
  @extension("discriminator", #{ propertyName: "type" })
  @oneOf
  part:
    | InputTextContent
    | OutputTextContent
    | TextContent
    | SummaryTextContent
    | ReasoningTextContent
    | RefusalContent
    | InputImageContent
    | InputFileContent;
}

@summary("Response reasoning summary part done event")
@doc("A streaming event that indicated a reasoning summary part was completed.")
model ResponseReasoningSummaryPartDoneStreamingEvent {
  @doc("The type of the event, always `response.reasoning_summary_part.done`.")
  type: "response.reasoning_summary_part.done" = "response.reasoning_summary_part.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the summary part that was completed.")
  summary_index: integer;

  @doc("A content part that makes up an input or output item.")
  @extension("discriminator", #{ propertyName: "type" })
  @oneOf
  part:
    | InputTextContent
    | OutputTextContent
    | TextContent
    | SummaryTextContent
    | ReasoningTextContent
    | RefusalContent
    | InputImageContent
    | InputFileContent;
}

@summary("Response content part added event")
@doc("A streaming event that indicated a content part was added.")
model ResponseContentPartAddedStreamingEvent {
  @doc("The type of the event, always `response.content_part.added`.")
  type: "response.content_part.added" = "response.content_part.added";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the content part that was added.")
  content_index: integer;

  @doc("A content part that makes up an input or output item.")
  @extension("discriminator", #{ propertyName: "type" })
  @oneOf
  part:
    | InputTextContent
    | OutputTextContent
    | TextContent
    | SummaryTextContent
    | ReasoningTextContent
    | RefusalContent
    | InputImageContent
    | InputFileContent;
}

@summary("Response content part done event")
@doc("A streaming event that indicated a content part was completed.")
model ResponseContentPartDoneStreamingEvent {
  @doc("The type of the event, always `response.content_part.done`.")
  type: "response.content_part.done" = "response.content_part.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the content part that was completed.")
  content_index: integer;

  @doc("A content part that makes up an input or output item.")
  @extension("discriminator", #{ propertyName: "type" })
  @oneOf
  part:
    | InputTextContent
    | OutputTextContent
    | TextContent
    | SummaryTextContent
    | ReasoningTextContent
    | RefusalContent
    | InputImageContent
    | InputFileContent;
}

@summary("Response output text delta event")
@doc("A streaming event that indicated output text was incrementally added.")
model ResponseOutputTextDeltaStreamingEvent {
  @doc("The type of the event, always `response.output_text.delta`.")
  type: "response.output_text.delta" = "response.output_text.delta";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the content part that was updated.")
  content_index: integer;

  @doc("The text delta that was appended.")
  delta: string;

  @doc("The token log probabilities that were emitted with the delta, if any.")
  logprobs?: LogProb[];

  @doc("An obfuscation string that was added to pad the event payload.")
  obfuscation?: string;
}

@summary("Response output text done event")
@doc("A streaming event that indicated output text was completed.")
model ResponseOutputTextDoneStreamingEvent {
  @doc("The type of the event, always `response.output_text.done`.")
  type: "response.output_text.done" = "response.output_text.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the content part that was completed.")
  content_index: integer;

  @doc("The final text that was emitted.")
  text: string;

  @doc("The token log probabilities that were emitted with the final text, if any.")
  logprobs?: LogProb[];
}

@summary("Response refusal delta event")
@doc("A streaming event that indicated refusal text was incrementally added.")
model ResponseRefusalDeltaStreamingEvent {
  @doc("The type of the event, always `response.refusal.delta`.")
  type: "response.refusal.delta" = "response.refusal.delta";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the refusal content that was updated.")
  content_index: integer;

  @doc("The refusal text delta that was appended.")
  delta: string;
}

@summary("Response refusal done event")
@doc("A streaming event that indicated refusal text was completed.")
model ResponseRefusalDoneStreamingEvent {
  @doc("The type of the event, always `response.refusal.done`.")
  type: "response.refusal.done" = "response.refusal.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the refusal content that was completed.")
  content_index: integer;

  @doc("The final refusal text that was emitted.")
  refusal: string;
}

@summary("Response reasoning delta event")
@doc("A streaming event that indicated reasoning text was incrementally added.")
model ResponseReasoningDeltaStreamingEvent {
  @doc("The type of the event, always `response.reasoning.delta`.")
  type: "response.reasoning.delta" = "response.reasoning.delta";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the reasoning content that was updated.")
  content_index: integer;

  @doc("The reasoning text delta that was appended.")
  delta: string;

  @doc("An obfuscation string that was added to pad the event payload.")
  obfuscation?: string;
}

@summary("Response reasoning done event")
@doc("A streaming event that indicated reasoning text was completed.")
model ResponseReasoningDoneStreamingEvent {
  @doc("The type of the event, always `response.reasoning.done`.")
  type: "response.reasoning.done" = "response.reasoning.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the reasoning content that was completed.")
  content_index: integer;

  @doc("The final reasoning text that was emitted.")
  text: string;
}

@summary("Response reasoning summary delta event")
@doc("A streaming event that indicated a reasoning summary was incrementally added.")
model ResponseReasoningSummaryDeltaStreamingEvent {
  @doc("The type of the event, always `response.reasoning_summary.delta`.")
  type: "response.reasoning_summary_text.delta" = "response.reasoning_summary_text.delta";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the summary content that was updated.")
  summary_index: integer;

  @doc("The summary text delta that was appended.")
  delta: string;

  @doc("An obfuscation string that was added to pad the event payload.")
  obfuscation?: string;
}

@summary("Response reasoning summary done event")
@doc("A streaming event that indicated a reasoning summary was completed.")
model ResponseReasoningSummaryDoneStreamingEvent {
  @doc("The type of the event, always `response.reasoning_summary.done`.")
  type: "response.reasoning_summary_text.done" = "response.reasoning_summary_text.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the summary content that was completed.")
  summary_index: integer;

  @doc("The final summary text that was emitted.")
  text: string;
}

@summary("Response output text annotation added event")
@doc("A streaming event that indicated an output text annotation was added.")
model ResponseOutputTextAnnotationAddedStreamingEvent {
  @doc("The type of the event, always `response.output_text.annotation.added`.")
  type: "response.output_text.annotation.added" = "response.output_text.annotation.added";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The index of the output text content that was updated.")
  content_index: integer;

  @doc("The index of the annotation that was added.")
  annotation_index: integer;

  @refDoc("An annotation that applies to a span of output text.")
  annotation: Annotation | null;
}

@summary("Response function call arguments delta event")
@doc("A streaming event that indicated function call arguments were incrementally added.")
model ResponseFunctionCallArgumentsDeltaStreamingEvent {
  @doc("The type of the event, always `response.function_call_arguments.delta`.")
  type: "response.function_call_arguments.delta" = "response.function_call_arguments.delta";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the tool call item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The arguments delta that was appended.")
  delta: string;

  @doc("An obfuscation string that was added to pad the event payload.")
  obfuscation?: string;
}

@summary("Response function call arguments done event")
@doc("A streaming event that indicated function call arguments were completed.")
model ResponseFunctionCallArgumentsDoneStreamingEvent {
  @doc("The type of the event, always `response.function_call_arguments.done`.")
  type: "response.function_call_arguments.done" = "response.function_call_arguments.done";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @doc("The ID of the tool call item that was updated.")
  item_id: string;

  @doc("The index of the output item that was updated.")
  output_index: integer;

  @doc("The final arguments string that was emitted.")
  arguments: string;
}

@summary("Error payload")
@doc("An error payload that was emitted for a streaming error event.")
model ErrorPayload {
  @doc("The error type that was emitted.")
  type: string;

  code: DescribedString<"The error code that was emitted, if any."> | null;

  @doc("The human-readable error message that was emitted.")
  message: string;

  param: DescribedString<"The parameter name that was associated with the error, if any."> | null;

  @doc("The response headers that were emitted with the error, if any.")
  headers?: Record<DescribedString<"The header value that was emitted.">>;
}

@summary("Error event")
@doc("A streaming event that indicated an error was emitted.")
model ErrorStreamingEvent {
  @doc("The type of the event, always `error`.")
  type: "error" = "error";

  @doc("The sequence number of the event that was emitted.")
  sequence_number: integer;

  @refDoc("The error payload that was emitted.")
  error: ErrorPayload;
}

@summary("WebSocket response create event")
@doc("A client-sent WebSocket event that starts a Responses turn. It uses the normal response-create body plus a required `type` field.")
@extension("x-openresponses-added-in", "2026-04-24")
@intersect(CreateResponseBody)
model WebSocketResponseCreateEvent {
  @doc("The client event type. Always `response.create`.")
  type: "response.create" = "response.create";

  @doc("This HTTP streaming field MUST NOT be sent in WebSocket `response.create` messages.")
  @extension("x-openresponses-disallowed", true)
  @extension("minLength", 1)
  @extension("maxLength", 0)
  stream?: string;

  @doc("This HTTP streaming options field MUST NOT be sent in WebSocket `response.create` messages.")
  @extension("x-openresponses-disallowed", true)
  @extension("minLength", 1)
  @extension("maxLength", 0)
  stream_options?: string;

  @doc("This HTTP background-mode field MUST NOT be sent in WebSocket `response.create` messages.")
  @extension("x-openresponses-disallowed", true)
  @extension("minLength", 1)
  @extension("maxLength", 0)
  background?: string;
}

@summary("WebSocket error event")
@doc("A WebSocket error envelope returned for Responses WebSocket mode failures.")
@extension("x-openresponses-added-in", "2026-04-24")
model WebSocketErrorEvent {
  @doc("The event type. Always `error`.")
  type: "error" = "error";

  @doc("The HTTP-style status code for the WebSocket error.")
  status: integer;

  @doc("The WebSocket error payload.")
  error: {
    @doc("The error type, when supplied.")
    type?: string;

    @doc("A machine-readable error code.")
    code: string;

    @doc("A human-readable error message.")
    message: string;

    param?: DescribedString<"The request parameter associated with the error, when supplied."> | null;
    ...Record<unknown>;
  };
}
