using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

/** A streaming event that indicated the response was created. */
@summary("Response created event")
model ResponseCreatedStreamingEvent {
  /** The type of the event, always `response.created`. */
  type: "response.created" = "response.created";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  @refDoc
  response: ResponseResource;
}

/** A streaming event that indicated the response was queued. */
@summary("Response queued event")
model ResponseQueuedStreamingEvent {
  /** The type of the event, always `response.queued`. */
  type: "response.queued" = "response.queued";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  @refDoc
  response: ResponseResource;
}

/** A streaming event that indicated the response was in progress. */
@summary("Response in progress event")
model ResponseInProgressStreamingEvent {
  /** The type of the event, always `response.in_progress`. */
  type: "response.in_progress" = "response.in_progress";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  @refDoc
  response: ResponseResource;
}

/** A streaming event that indicated the response was completed. */
@summary("Response completed event")
model ResponseCompletedStreamingEvent {
  /** The type of the event, always `response.completed`. */
  type: "response.completed" = "response.completed";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  @refDoc
  response: ResponseResource;
}

/** A streaming event that indicated the response had failed. */
@summary("Response failed event")
model ResponseFailedStreamingEvent {
  /** The type of the event, always `response.failed`. */
  type: "response.failed" = "response.failed";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  @refDoc
  response: ResponseResource;
}

/** A streaming event that indicated the response was incomplete. */
@summary("Response incomplete event")
model ResponseIncompleteStreamingEvent {
  /** The type of the event, always `response.incomplete`. */
  type: "response.incomplete" = "response.incomplete";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  @refDoc
  response: ResponseResource;
}

/** A streaming event that indicated an output item was added to the response. */
@summary("Response output item added event")
model ResponseOutputItemAddedStreamingEvent {
  /** The type of the event, always `response.output_item.added`. */
  type: "response.output_item.added" = "response.output_item.added";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The index of the output item that was added. */
  output_index: integer;

  /**
   * An item representing a message, tool call, tool output, reasoning, or other
   * response element.
   */
  @refDoc
  item: ItemField | null;
}

/** A streaming event that indicated an output item was completed. */
@summary("Response output item done event")
model ResponseOutputItemDoneStreamingEvent {
  /** The type of the event, always `response.output_item.done`. */
  type: "response.output_item.done" = "response.output_item.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The index of the output item that was completed. */
  output_index: integer;

  /**
   * An item representing a message, tool call, tool output, reasoning, or other
   * response element.
   */
  @refDoc
  item: ItemField | null;
}

/** A streaming event that indicated a reasoning summary part was added. */
@summary("Response reasoning summary part added event")
model ResponseReasoningSummaryPartAddedStreamingEvent {
  /** The type of the event, always `response.reasoning_summary_part.added`. */
  type: "response.reasoning_summary_part.added" = "response.reasoning_summary_part.added";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the summary part that was added. */
  summary_index: integer;

  /** A content part that makes up an input or output item. */
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

/** A streaming event that indicated a reasoning summary part was completed. */
@summary("Response reasoning summary part done event")
model ResponseReasoningSummaryPartDoneStreamingEvent {
  /** The type of the event, always `response.reasoning_summary_part.done`. */
  type: "response.reasoning_summary_part.done" = "response.reasoning_summary_part.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the summary part that was completed. */
  summary_index: integer;

  /** A content part that makes up an input or output item. */
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

/** A streaming event that indicated a content part was added. */
@summary("Response content part added event")
model ResponseContentPartAddedStreamingEvent {
  /** The type of the event, always `response.content_part.added`. */
  type: "response.content_part.added" = "response.content_part.added";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the content part that was added. */
  content_index: integer;

  /** A content part that makes up an input or output item. */
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

/** A streaming event that indicated a content part was completed. */
@summary("Response content part done event")
model ResponseContentPartDoneStreamingEvent {
  /** The type of the event, always `response.content_part.done`. */
  type: "response.content_part.done" = "response.content_part.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the content part that was completed. */
  content_index: integer;

  /** A content part that makes up an input or output item. */
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

/** A streaming event that indicated output text was incrementally added. */
@summary("Response output text delta event")
model ResponseOutputTextDeltaStreamingEvent {
  /** The type of the event, always `response.output_text.delta`. */
  type: "response.output_text.delta" = "response.output_text.delta";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the content part that was updated. */
  content_index: integer;

  /** The text delta that was appended. */
  delta: string;

  /** The token log probabilities that were emitted with the delta, if any. */
  logprobs?: LogProb[];

  /** An obfuscation string that was added to pad the event payload. */
  obfuscation?: string;
}

/** A streaming event that indicated output text was completed. */
@summary("Response output text done event")
model ResponseOutputTextDoneStreamingEvent {
  /** The type of the event, always `response.output_text.done`. */
  type: "response.output_text.done" = "response.output_text.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the content part that was completed. */
  content_index: integer;

  /** The final text that was emitted. */
  text: string;

  /** The token log probabilities that were emitted with the final text, if any. */
  logprobs?: LogProb[];
}

/** A streaming event that indicated refusal text was incrementally added. */
@summary("Response refusal delta event")
model ResponseRefusalDeltaStreamingEvent {
  /** The type of the event, always `response.refusal.delta`. */
  type: "response.refusal.delta" = "response.refusal.delta";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the refusal content that was updated. */
  content_index: integer;

  /** The refusal text delta that was appended. */
  delta: string;
}

/** A streaming event that indicated refusal text was completed. */
@summary("Response refusal done event")
model ResponseRefusalDoneStreamingEvent {
  /** The type of the event, always `response.refusal.done`. */
  type: "response.refusal.done" = "response.refusal.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the refusal content that was completed. */
  content_index: integer;

  /** The final refusal text that was emitted. */
  refusal: string;
}

/** A streaming event that indicated reasoning text was incrementally added. */
@summary("Response reasoning delta event")
model ResponseReasoningDeltaStreamingEvent {
  /** The type of the event, always `response.reasoning.delta`. */
  type: "response.reasoning.delta" = "response.reasoning.delta";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the reasoning content that was updated. */
  content_index: integer;

  /** The reasoning text delta that was appended. */
  delta: string;

  /** An obfuscation string that was added to pad the event payload. */
  obfuscation?: string;
}

/** A streaming event that indicated reasoning text was completed. */
@summary("Response reasoning done event")
model ResponseReasoningDoneStreamingEvent {
  /** The type of the event, always `response.reasoning.done`. */
  type: "response.reasoning.done" = "response.reasoning.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the reasoning content that was completed. */
  content_index: integer;

  /** The final reasoning text that was emitted. */
  text: string;
}

/** A streaming event that indicated a reasoning summary was incrementally added. */
@summary("Response reasoning summary delta event")
model ResponseReasoningSummaryDeltaStreamingEvent {
  /** The type of the event, always `response.reasoning_summary.delta`. */
  type: "response.reasoning_summary_text.delta" = "response.reasoning_summary_text.delta";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the summary content that was updated. */
  summary_index: integer;

  /** The summary text delta that was appended. */
  delta: string;

  /** An obfuscation string that was added to pad the event payload. */
  obfuscation?: string;
}

/** A streaming event that indicated a reasoning summary was completed. */
@summary("Response reasoning summary done event")
model ResponseReasoningSummaryDoneStreamingEvent {
  /** The type of the event, always `response.reasoning_summary.done`. */
  type: "response.reasoning_summary_text.done" = "response.reasoning_summary_text.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the summary content that was completed. */
  summary_index: integer;

  /** The final summary text that was emitted. */
  text: string;
}

/** A streaming event that indicated an output text annotation was added. */
@summary("Response output text annotation added event")
model ResponseOutputTextAnnotationAddedStreamingEvent {
  /** The type of the event, always `response.output_text.annotation.added`. */
  type: "response.output_text.annotation.added" = "response.output_text.annotation.added";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The index of the output text content that was updated. */
  content_index: integer;

  /** The index of the annotation that was added. */
  annotation_index: integer;

  /** An annotation that applies to a span of output text. */
  @refDoc
  annotation: Annotation | null;
}

/**
 * A streaming event that indicated function call arguments were incrementally added.
 */
@summary("Response function call arguments delta event")
model ResponseFunctionCallArgumentsDeltaStreamingEvent {
  /** The type of the event, always `response.function_call_arguments.delta`. */
  type: "response.function_call_arguments.delta" = "response.function_call_arguments.delta";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the tool call item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The arguments delta that was appended. */
  delta: string;

  /** An obfuscation string that was added to pad the event payload. */
  obfuscation?: string;
}

/** A streaming event that indicated function call arguments were completed. */
@summary("Response function call arguments done event")
model ResponseFunctionCallArgumentsDoneStreamingEvent {
  /** The type of the event, always `response.function_call_arguments.done`. */
  type: "response.function_call_arguments.done" = "response.function_call_arguments.done";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The ID of the tool call item that was updated. */
  item_id: string;

  /** The index of the output item that was updated. */
  output_index: integer;

  /** The final arguments string that was emitted. */
  arguments: string;
}

/** An error payload that was emitted for a streaming error event. */
@summary("Error payload")
model ErrorPayload {
  /** The error type that was emitted. */
  type: string;

  /** The error code that was emitted, if any. */
  code: string | null;

  /** The human-readable error message that was emitted. */
  message: string;

  /** The parameter name that was associated with the error, if any. */
  param: string | null;

  /** The response headers that were emitted with the error, if any. */
  headers?: Record<string>;
}

/** A streaming event that indicated an error was emitted. */
@summary("Error event")
model ErrorStreamingEvent {
  /** The type of the event, always `error`. */
  type: "error" = "error";

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The error payload that was emitted. */
  @refDoc
  error: ErrorPayload;
}

/**
 * A client-sent WebSocket event that starts a Responses turn. It uses the normal
 * response-create body plus a required `type` field.
 */
@summary("WebSocket response create event")
@extension("x-openresponses-added-in", "2026-04-24")
@intersect(CreateResponseBody)
model WebSocketResponseCreateEvent {
  /** The client event type. Always `response.create`. */
  type: "response.create" = "response.create";

  /**
   * This HTTP streaming field MUST NOT be sent in WebSocket `response.create` messages.
   */
  @extension("x-openresponses-disallowed", true)
  @extension("minLength", 1)
  @extension("maxLength", 0)
  stream?: string;

  /**
   * This HTTP streaming options field MUST NOT be sent in WebSocket `response.create`
   * messages.
   */
  @extension("x-openresponses-disallowed", true)
  @extension("minLength", 1)
  @extension("maxLength", 0)
  stream_options?: string;

  /**
   * This HTTP background-mode field MUST NOT be sent in WebSocket `response.create`
   * messages.
   */
  @extension("x-openresponses-disallowed", true)
  @extension("minLength", 1)
  @extension("maxLength", 0)
  background?: string;
}

/** A WebSocket error envelope returned for Responses WebSocket mode failures. */
@summary("WebSocket error event")
@extension("x-openresponses-added-in", "2026-04-24")
model WebSocketErrorEvent {
  /** The event type. Always `error`. */
  type: "error" = "error";

  /** The HTTP-style status code for the WebSocket error. */
  status: integer;

  /** The WebSocket error payload. */
  error: {
    /** The error type, when supplied. */
    type?: string;

    /** A machine-readable error code. */
    code: string;

    /** A human-readable error message. */
    message: string;

    /** The request parameter associated with the error, when supplied. */
    param?: string | null;

    ...Record<unknown>;
  };
}
