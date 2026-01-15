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

export type StreamingEvent = z.infer<typeof streamingEventSchema>;

export interface ParsedEvent {
  event: string;
  data: unknown;
  validationResult: z.SafeParseReturnType<unknown, StreamingEvent>;
}

export interface SSEParseResult {
  events: ParsedEvent[];
  errors: string[];
  finalResponse: z.infer<typeof responseResourceSchema> | null;
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        } else if (line === "" && currentData) {
          if (currentData === "[DONE]") {
            // Skip the [DONE] sentinel - it's not a real event
          } else {
            try {
              const parsed = JSON.parse(currentData);
              const validationResult = streamingEventSchema.safeParse(parsed);

              events.push({
                event: currentEvent || parsed.type || "unknown",
                data: parsed,
                validationResult,
              });

              if (!validationResult.success) {
                errors.push(
                  `Event validation failed for ${parsed.type || "unknown"}: ${JSON.stringify(validationResult.error.issues)}`,
                );
              }

              if (
                parsed.type === "response.completed" ||
                parsed.type === "response.failed"
              ) {
                finalResponse = parsed.response;
              }
            } catch {
              errors.push(`Failed to parse event data: ${currentData}`);
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { events, errors, finalResponse };
}
