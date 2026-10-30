import { z } from "zod";
import { errorStreamingEventSchema } from "../generated/kubb/zod/errorStreamingEventSchema";
import { responseCompletedStreamingEventSchema } from "../generated/kubb/zod/responseCompletedStreamingEventSchema";
import { responseContentPartAddedStreamingEventSchema } from "../generated/kubb/zod/responseContentPartAddedStreamingEventSchema";
import { responseContentPartDoneStreamingEventSchema } from "../generated/kubb/zod/responseContentPartDoneStreamingEventSchema";
import { responseCreatedStreamingEventSchema } from "../generated/kubb/zod/responseCreatedStreamingEventSchema";
import { responseFailedStreamingEventSchema } from "../generated/kubb/zod/responseFailedStreamingEventSchema";
import { responseFunctionCallArgumentsDeltaStreamingEventSchema } from "../generated/kubb/zod/responseFunctionCallArgumentsDeltaStreamingEventSchema";
import { responseFunctionCallArgumentsDoneStreamingEventSchema } from "../generated/kubb/zod/responseFunctionCallArgumentsDoneStreamingEventSchema";
import { responseIncompleteStreamingEventSchema } from "../generated/kubb/zod/responseIncompleteStreamingEventSchema";
import { responseInProgressStreamingEventSchema } from "../generated/kubb/zod/responseInProgressStreamingEventSchema";
import { responseOutputItemAddedStreamingEventSchema } from "../generated/kubb/zod/responseOutputItemAddedStreamingEventSchema";
import { responseOutputItemDoneStreamingEventSchema } from "../generated/kubb/zod/responseOutputItemDoneStreamingEventSchema";
import { responseOutputTextAnnotationAddedStreamingEventSchema } from "../generated/kubb/zod/responseOutputTextAnnotationAddedStreamingEventSchema";
import { responseOutputTextDeltaStreamingEventSchema } from "../generated/kubb/zod/responseOutputTextDeltaStreamingEventSchema";
import { responseOutputTextDoneStreamingEventSchema } from "../generated/kubb/zod/responseOutputTextDoneStreamingEventSchema";
import { responseQueuedStreamingEventSchema } from "../generated/kubb/zod/responseQueuedStreamingEventSchema";
import { responseReasoningDeltaStreamingEventSchema } from "../generated/kubb/zod/responseReasoningDeltaStreamingEventSchema";
import { responseReasoningDoneStreamingEventSchema } from "../generated/kubb/zod/responseReasoningDoneStreamingEventSchema";
import { responseReasoningSummaryDeltaStreamingEventSchema } from "../generated/kubb/zod/responseReasoningSummaryDeltaStreamingEventSchema";
import { responseReasoningSummaryDoneStreamingEventSchema } from "../generated/kubb/zod/responseReasoningSummaryDoneStreamingEventSchema";
import { responseReasoningSummaryPartAddedStreamingEventSchema } from "../generated/kubb/zod/responseReasoningSummaryPartAddedStreamingEventSchema";
import { responseReasoningSummaryPartDoneStreamingEventSchema } from "../generated/kubb/zod/responseReasoningSummaryPartDoneStreamingEventSchema";
import { responseRefusalDeltaStreamingEventSchema } from "../generated/kubb/zod/responseRefusalDeltaStreamingEventSchema";
import { responseRefusalDoneStreamingEventSchema } from "../generated/kubb/zod/responseRefusalDoneStreamingEventSchema";
import type { responseResourceSchema } from "../generated/kubb/zod/responseResourceSchema";
import { webSocketErrorEventSchema } from "../generated/kubb/zod/webSocketErrorEventSchema";
import { webSocketResponseSteerAcceptedEventSchema } from "../generated/kubb/zod/webSocketResponseSteerAcceptedEventSchema";
import { webSocketResponseSteerFailedEventSchema } from "../generated/kubb/zod/webSocketResponseSteerFailedEventSchema";
import { webSocketResponseSteerPendingEventSchema } from "../generated/kubb/zod/webSocketResponseSteerPendingEventSchema";

export const streamingEventSchema = z.union([
  responseCreatedStreamingEventSchema,
  responseQueuedStreamingEventSchema,
  responseInProgressStreamingEventSchema,
  responseCompletedStreamingEventSchema,
  responseFailedStreamingEventSchema,
  responseIncompleteStreamingEventSchema,
  responseOutputItemAddedStreamingEventSchema,
  responseOutputItemDoneStreamingEventSchema,
  responseContentPartAddedStreamingEventSchema,
  responseContentPartDoneStreamingEventSchema,
  responseOutputTextDeltaStreamingEventSchema,
  responseOutputTextDoneStreamingEventSchema,
  responseRefusalDeltaStreamingEventSchema,
  responseRefusalDoneStreamingEventSchema,
  responseFunctionCallArgumentsDeltaStreamingEventSchema,
  responseFunctionCallArgumentsDoneStreamingEventSchema,
  responseReasoningSummaryPartAddedStreamingEventSchema,
  responseReasoningSummaryPartDoneStreamingEventSchema,
  responseReasoningDeltaStreamingEventSchema,
  responseReasoningDoneStreamingEventSchema,
  responseReasoningSummaryDeltaStreamingEventSchema,
  responseReasoningSummaryDoneStreamingEventSchema,
  responseOutputTextAnnotationAddedStreamingEventSchema,
  errorStreamingEventSchema,
]);
export const webSocketStreamingEventSchema = z.union([
  streamingEventSchema,
  webSocketErrorEventSchema,
  webSocketResponseSteerAcceptedEventSchema,
  webSocketResponseSteerFailedEventSchema,
  webSocketResponseSteerPendingEventSchema,
]);

export type StreamingEvent = z.infer<typeof streamingEventSchema>;
export type WebSocketStreamingEvent = z.infer<
  typeof webSocketStreamingEventSchema
>;

interface ParseStreamingEventOptions {
  transport?: "http" | "websocket";
}

export interface ParsedEvent {
  event: string;
  data: unknown;
  validationResult: z.SafeParseReturnType<
    unknown,
    StreamingEvent | WebSocketStreamingEvent
  >;
}

export interface SSEParseResult {
  events: ParsedEvent[];
  errors: string[];
  finalResponse: z.infer<typeof responseResourceSchema> | null;
}

const getEventType = (data: unknown) => {
  if (data && typeof data === "object" && "type" in data) {
    const type = (data as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return "unknown";
};

export function parseStreamingEventData(
  data: unknown,
  eventName?: string,
  options: ParseStreamingEventOptions = {},
): ParsedEvent {
  const validationSchema =
    options.transport === "websocket"
      ? webSocketStreamingEventSchema
      : streamingEventSchema;
  const validationResult = validationSchema.safeParse(data);
  return {
    event: eventName || getEventType(data),
    data,
    validationResult,
  };
}

export function getTerminalResponse(
  data: unknown,
): z.infer<typeof responseResourceSchema> | null {
  if (!data || typeof data !== "object") return null;

  const event = data as {
    type?: unknown;
    response?: z.infer<typeof responseResourceSchema>;
  };
  if (
    event.type === "response.completed" ||
    event.type === "response.failed" ||
    event.type === "response.incomplete"
  ) {
    return event.response ?? null;
  }

  return null;
}

export async function parseSSEStream(
  response: Response,
): Promise<SSEParseResult> {
  const events: ParsedEvent[] = [];
  const errors: string[] = [];
  let finalResponse: z.infer<typeof responseResourceSchema> | null = null;

  const reader = response.body?.getReader();
  if (!reader) {
    return { events, errors: ["No response body"], finalResponse };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let finished = false;
  let skipLF = false;

  const processLine = (line: string) => {
    if (line !== "") {
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      if (field === "data") dataLines.push(value);
      return;
    }

    if (dataLines.length === 0) {
      eventName = "";
      return;
    }
    const data = dataLines.join("\n");
    const name = eventName;
    eventName = "";
    dataLines = [];
    if (data === "[DONE]") {
      finished = true;
      if (!finalResponse) {
        errors.push("Received [DONE] before a terminal response event");
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      errors.push(`Failed to parse event data: ${data}`);
      return;
    }
    const parsedEvent = parseStreamingEventData(parsed, name);
    events.push(parsedEvent);
    if (!parsedEvent.validationResult.success) {
      errors.push(
        `Event validation failed for ${parsedEvent.event}: ${JSON.stringify(parsedEvent.validationResult.error.issues)}`,
      );
    }
    finalResponse = getTerminalResponse(parsed) ?? finalResponse;
  };

  const processBuffer = () => {
    while (!finished) {
      if (skipLF && buffer.length > 0) {
        skipLF = false;
        if (buffer.startsWith("\n")) buffer = buffer.slice(1);
      }
      const end = buffer.search(/[\r\n]/);
      if (end === -1) break;
      const line = buffer.slice(0, end);
      skipLF = buffer[end] === "\r";
      buffer = buffer.slice(end + 1);
      processLine(line);
    }
  };

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      processBuffer();
      if (done) break;
    }
    if (!finished) {
      if (buffer) processLine(buffer);
      if (dataLines.length > 0 || eventName)
        errors.push("Stream ended during an SSE event");
      if (!finalResponse)
        errors.push("Stream ended before a terminal response event");
    }
  } catch (error) {
    errors.push(
      `Failed to read event stream: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    try {
      await reader.cancel();
    } catch {
      // An errored stream may also reject cancellation.
    }
    reader.releaseLock();
  }

  return { events, errors, finalResponse };
}
