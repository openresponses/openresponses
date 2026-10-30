using TypeSpec.OpenAPI;
using OpenResponsesSchema;
namespace OpenResponses;

model ResponseEvent<EventType extends valueof string> {
  @doc("The type of the event, always `${EventType}`.")
  type: typeof EventType = EventType;

  /** The sequence number of the event that was emitted. */
  sequence_number: integer;

  /** The response snapshot that was emitted with the event. */
  response: ResponseResource;
}

/** A streaming event that indicated the response was created. */
@summary("Response created event")
model ResponseCreatedStreamingEvent is ResponseEvent<"response.created">;

/** A streaming event that indicated the response was queued. */
@summary("Response queued event")
model ResponseQueuedStreamingEvent is ResponseEvent<"response.queued">;

/** A streaming event that indicated the response was in progress. */
@summary("Response in progress event")
model ResponseInProgressStreamingEvent is ResponseEvent<"response.in_progress">;

/** A streaming event that indicated the response was completed. */
@summary("Response completed event")
model ResponseCompletedStreamingEvent is ResponseEvent<"response.completed">;

/** A streaming event that indicated the response had failed. */
@summary("Response failed event")
model ResponseFailedStreamingEvent is ResponseEvent<"response.failed">;

/** A streaming event that indicated the response was incomplete. */
@summary("Response incomplete event")
model ResponseIncompleteStreamingEvent is ResponseEvent<"response.incomplete">;

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
  part: ContentPart;
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
  part: ContentPart;
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
  part: ContentPart;
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
  part: ContentPart;
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

/** A user message queued by a WebSocket steering request. */
@summary("WebSocket steering user message")
@extension("x-openresponses-added-in", "2026-10-23")
@extension("additionalProperties", false)
model WebSocketSteeringUserMessage {
  /** The item type, when supplied. Always `message`. */
  type?: "message";

  /** The message role. Always `user`. */
  role: "user";

  /** User input, as text or an array of supported content parts. */
  @oneOf
  @oneOfItems
  content: BoundedString<10485760> | (InputTextContentParam | InputImageContentParamAutoParam | InputFileContentParam)[];
}

/**
 * Queues user input for a continuation of a response on the same WebSocket
 * connection. Only `type`, `previous_response_id`, and `input` are accepted.
 * The target response determines the WebSocket lane; do not send `stream_id`.
 * Acceptance queues the input. The successor's `response.created` event marks
 * its application to a continuation.
 */
@summary("WebSocket response steer event")
@extension("x-openresponses-added-in", "2026-10-23")
@extension("additionalProperties", false)
model WebSocketResponseSteerEvent {
  /** The client event type. Always `response.steer`. */
  type: "response.steer";

  /** The ID of the response to steer on this WebSocket connection. */
  previous_response_id: string;

  /**
   * A user message string or a nonempty array of user messages. Other roles,
   * tool outputs, item references, and additional message fields are not supported.
   */
  @oneOf
  @minItems(1)
  input: BoundedString<10485760> | WebSocketSteeringUserMessage[];
}

/** Identifies an accepted steering submission and its target response. */
@summary("WebSocket steering submission")
@extension("x-openresponses-added-in", "2026-10-23")
model WebSocketSteeringSubmission {
  /** The ID assigned to this steering submission. */
  id: string;

  /** The ID of the response being steered. */
  previous_response_id: string;
}

/**
 * A WebSocket-only event confirming that steering input is queued. It does not
 * indicate that the model has applied the input. Keep reading through the
 * continuation's terminal event. A later failure returns the same steering ID.
 */
@summary("WebSocket response steer accepted event")
@extension("x-openresponses-added-in", "2026-10-23")
model WebSocketResponseSteerAcceptedEvent {
  /** The event type. Always `response.steer.accepted`. */
  type: "response.steer.accepted";

  /** The sequence number of this event. */
  sequence_number: integer;

  /** The steering submission whose input is queued. */
  steer: WebSocketSteeringSubmission;

  /** The target response's WebSocket lane, when one was supplied. */
  stream_id?: string;
}

/** Identifies a function result needed before queued steering can be applied. */
@summary("WebSocket steering required function result")
@extension("x-openresponses-added-in", "2026-10-23")
@extension("additionalProperties", false)
model WebSocketSteeringRequiredFunctionOutput {
  /** The required input type. Always `function_call_output`. */
  type: "function_call_output";

  /** The ID of the function call awaiting its result. */
  call_id: string;

  /** The name of the function that was called. */
  name: string;
}

/**
 * Identifies a provider-specific tool result or approval decision needed before
 * queued steering can be applied. The type uses the provider's canonical slug
 * prefix, such as `acme:approval_response`; identifying fields are defined by
 * that provider. The stub does not supply a result or approval decision.
 */
@summary("WebSocket steering required extension input")
@extension("x-openresponses-added-in", "2026-10-23")
model WebSocketSteeringRequiredExtensionInput {
  /** A required input type prefixed with the provider slug and a colon. */
  @pattern("^[^:]+:.+$")
  type: string;

  ...Record<unknown>;
}

/**
 * A WebSocket-only event indicating that accepted steering remains queued after
 * the target response completes. With `waiting_for_required_input`, fill the
 * identifying stubs with saved tool results or approval decisions and send one
 * matching `response.create` per parent on the same connection and lane. Do not
 * rerun tools or resend accepted steering. The server prepends queued steering
 * in submission order, while the explicit request retains its own settings.
 * This notification is emitted at most once per steering submission.
 */
@summary("WebSocket response steer pending event")
@extension("x-openresponses-added-in", "2026-10-23")
model WebSocketResponseSteerPendingEvent {
  /** The event type. Always `response.steer.pending`. */
  type: "response.steer.pending";

  /** The sequence number of this event. */
  sequence_number: integer;

  /** The accepted steering submission that remains queued. */
  steer: WebSocketSteeringSubmission;

  /**
   * Why the input remains queued. `waiting_for_required_input` means that tool
   * results or approval decisions are needed. Clients must handle unknown reasons.
   */
  reason: string;

  /** Identifying stubs for outstanding tool results or approval decisions. */
  @oneOfItems
  required_input: (WebSocketSteeringRequiredFunctionOutput | WebSocketSteeringRequiredExtensionInput)[];

  /** The target response's WebSocket lane, when one was supplied. */
  stream_id?: string;
}

/**
 * A WebSocket-only event returning steering input that was rejected or could not
 * be applied to a continuation. The server will not apply this input later.
 * Failures after acceptance include the same steering ID; failures before ID
 * allocation omit it. A disconnect or missing acknowledgement leaves the outcome
 * unknown and does not establish that input was rejected.
 */
@summary("WebSocket response steer failed event")
@extension("x-openresponses-added-in", "2026-10-23")
model WebSocketResponseSteerFailedEvent {
  /** The event type. Always `response.steer.failed`. */
  type: "response.steer.failed";

  /** The sequence number of this event. */
  sequence_number: integer;

  /** The original steering submission that could not be applied. */
  steer: {
    /** The ID assigned at acceptance, omitted if no ID was allocated. */
    id?: string;

    /** The target response ID from the steering request. */
    previous_response_id: string;

    /** The original input, including unsupported input returned by `invalid_input`. */
    input: unknown;
  };

  /** Information about why the input could not be applied. */
  error: {
    /** The error type. Always `invalid_request_error`. */
    type: "invalid_request_error";

    /**
     * An extensible machine-readable code. Known codes include `response_not_found`,
     * `invalid_input`, `steering_not_supported`, `too_many_pending_steers`,
     * `response_already_completed`, `response_not_active`, and
     * `successor_creation_failed`.
     */
    code: string;

    /** A human-readable description of the failure. */
    message: string;
  };

  /** The target response's lane, when the target is known and a lane was supplied. */
  stream_id?: string;
}
