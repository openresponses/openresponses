// Minimal discriminated union for streaming events.
// Only the fields the state machine needs are included.
// Events from sse-parser.ts are assignable to these types by structural compatibility.

export type ViolationRule =
  | "INVALID_RESPONSE_TRANSITION"
  | "INVALID_ITEM_TRANSITION"
  | "INVALID_CONTENT_PART_TRANSITION"
  | "NON_MONOTONIC_SEQUENCE"
  | "UNKNOWN_ITEM"
  | "UNKNOWN_CONTENT_PART"
  | "DUPLICATE_ITEM"
  | "DUPLICATE_CONTENT_PART"
  | "RESPONSE_NOT_TERMINATED"
  | "ITEM_NOT_TERMINATED"
  | "CONTENT_PART_NOT_TERMINATED";

export interface Violation {
  rule: ViolationRule;
  event: StreamingEvent;
  currentState: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

// Base event fields present on every streaming event
interface BaseEvent {
  type: string;
  sequence_number: number;
}

// Response lifecycle events
interface ResponseCreatedEvent extends BaseEvent {
  type: "response.created";
}
interface ResponseQueuedEvent extends BaseEvent {
  type: "response.queued";
}
interface ResponseInProgressEvent extends BaseEvent {
  type: "response.in_progress";
}
interface ResponseCompletedEvent extends BaseEvent {
  type: "response.completed";
}
interface ResponseFailedEvent extends BaseEvent {
  type: "response.failed";
}
interface ResponseIncompleteEvent extends BaseEvent {
  type: "response.incomplete";
}

// Item lifecycle events
interface ResponseOutputItemAddedEvent extends BaseEvent {
  type: "response.output_item.added";
  output_index: number;
  item: { id: string } | null;
}
interface ResponseOutputItemDoneEvent extends BaseEvent {
  type: "response.output_item.done";
  output_index: number;
  item: { id: string; status?: string } | null;
}

// Content part lifecycle events
interface ResponseContentPartAddedEvent extends BaseEvent {
  type: "response.content_part.added";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseContentPartDoneEvent extends BaseEvent {
  type: "response.content_part.done";
  item_id: string;
  output_index: number;
  content_index: number;
}

// Output text events
interface ResponseOutputTextDeltaEvent extends BaseEvent {
  type: "response.output_text.delta";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseOutputTextDoneEvent extends BaseEvent {
  type: "response.output_text.done";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseOutputTextAnnotationAddedEvent extends BaseEvent {
  type: "response.output_text.annotation.added";
  item_id: string;
  output_index: number;
  content_index: number;
}

// Refusal events
interface ResponseRefusalDeltaEvent extends BaseEvent {
  type: "response.refusal.delta";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseRefusalDoneEvent extends BaseEvent {
  type: "response.refusal.done";
  item_id: string;
  output_index: number;
  content_index: number;
}

// Function call events (no content_index)
interface ResponseFunctionCallArgumentsDeltaEvent extends BaseEvent {
  type: "response.function_call_arguments.delta";
  item_id: string;
  output_index: number;
}
interface ResponseFunctionCallArgumentsDoneEvent extends BaseEvent {
  type: "response.function_call_arguments.done";
  item_id: string;
  output_index: number;
}

// Reasoning events (with content_index)
interface ResponseReasoningDeltaEvent extends BaseEvent {
  type: "response.reasoning.delta";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseReasoningDoneEvent extends BaseEvent {
  type: "response.reasoning.done";
  item_id: string;
  output_index: number;
  content_index: number;
}

// Reasoning summary events (with content_index)
interface ResponseReasoningSummaryPartAddedEvent extends BaseEvent {
  type: "response.reasoning_summary_part.added";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseReasoningSummaryPartDoneEvent extends BaseEvent {
  type: "response.reasoning_summary_part.done";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseReasoningSummaryDeltaEvent extends BaseEvent {
  type: "response.reasoning_summary.delta";
  item_id: string;
  output_index: number;
  content_index: number;
}
interface ResponseReasoningSummaryDoneEvent extends BaseEvent {
  type: "response.reasoning_summary.done";
  item_id: string;
  output_index: number;
  content_index: number;
}

// Error event (pass-through, no state transition)
interface ErrorEvent extends BaseEvent {
  type: "error";
}

export type StreamingEvent =
  | ResponseCreatedEvent
  | ResponseQueuedEvent
  | ResponseInProgressEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
  | ResponseIncompleteEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseOutputTextAnnotationAddedEvent
  | ResponseRefusalDeltaEvent
  | ResponseRefusalDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseReasoningDeltaEvent
  | ResponseReasoningDoneEvent
  | ResponseReasoningSummaryPartAddedEvent
  | ResponseReasoningSummaryPartDoneEvent
  | ResponseReasoningSummaryDeltaEvent
  | ResponseReasoningSummaryDoneEvent
  | ErrorEvent;
