import type { z } from "zod";
import type { createResponseBodySchema } from "../generated/kubb/zod/createResponseBodySchema";
import { responseResourceSchema } from "../generated/kubb/zod/responseResourceSchema";
import { parseSSEStream, type SSEParseResult } from "./sse-parser";

type ResponseResource = z.infer<typeof responseResourceSchema>;
type CreateResponseBody = z.infer<typeof createResponseBodySchema>;

export interface TestConfig {
  baseUrl: string;
  apiKey: string;
  authHeaderName: string;
  useBearerPrefix: boolean;
  model: string;
}

export interface TestResult {
  id: string;
  name: string;
  description: string;
  status: "pending" | "running" | "passed" | "failed";
  duration?: number;
  request?: unknown;
  response?: unknown;
  errors?: string[];
  streamEvents?: number;
}

interface ValidatorContext {
  streaming: boolean;
  sseResult?: SSEParseResult;
}

type ResponseValidator = (
  response: ResponseResource,
  context: ValidatorContext,
) => string[];

export interface TestTemplate {
  id: string;
  name: string;
  description: string;
  getRequest: (config: TestConfig) => CreateResponseBody;
  streaming?: boolean;
  validators: ResponseValidator[];
}

const hasOutput: ResponseValidator = (response) => {
  if (!response.output || response.output.length === 0) {
    return ["Response has no output items"];
  }
  return [];
};

const hasOutputType =
  (type: string): ResponseValidator =>
  (response) => {
    const hasType = response.output?.some((item) => item.type === type);
    if (!hasType) {
      return [`Expected output item of type "${type}" but none found`];
    }
    return [];
  };

const completedStatus: ResponseValidator = (response) => {
  if (response.status !== "completed") {
    return [`Expected status "completed" but got "${response.status}"`];
  }
  return [];
};

const streamingEvents: ResponseValidator = (_, context) => {
  if (!context.streaming) return [];
  if (!context.sseResult || context.sseResult.events.length === 0) {
    return ["No streaming events received"];
  }
  return [];
};

const streamingSchema: ResponseValidator = (_, context) => {
  if (!context.streaming || !context.sseResult) return [];
  return context.sseResult.errors;
};

export const testTemplates: TestTemplate[] = [
  {
    id: "basic-response",
    name: "Basic Text Response",
    description: "Simple user message, validates ResponseResource schema",
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "user",
          content: "Say hello in exactly 3 words.",
        },
      ],
    }),
    validators: [hasOutput, completedStatus],
  },

  {
    id: "streaming-response",
    name: "Streaming Response",
    description: "Validates SSE streaming events and final response",
    streaming: true,
    getRequest: (config) => ({
      model: config.model,
      input: [{ type: "message", role: "user", content: "Count from 1 to 5." }],
    }),
    validators: [streamingEvents, streamingSchema, completedStatus],
  },

  {
    id: "system-prompt",
    name: "System Prompt",
    description: "Include system role message in input",
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "system",
          content: "You are a pirate. Always respond in pirate speak.",
        },
        { type: "message", role: "user", content: "Say hello." },
      ],
    }),
    validators: [hasOutput, completedStatus],
  },

  {
    id: "tool-calling",
    name: "Tool Calling",
    description: "Define a function tool and verify function_call output",
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "user",
          content: "What's the weather like in San Francisco?",
        },
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get the current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city and state, e.g. San Francisco, CA",
              },
            },
            required: ["location"],
          },
        },
      ],
    }),
    validators: [hasOutput, hasOutputType("function_call")],
  },

  {
    id: "tool-calling-streaming",
    name: "Tool Calling (Streaming)",
    description:
      "Streaming tool call: validates function_call SSE events including arguments delta/done",
    streaming: true,
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "user",
          content: "What's the weather like in San Francisco?",
        },
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get the current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city and state, e.g. San Francisco, CA",
              },
            },
            required: ["location"],
          },
        },
      ],
    }),
    validators: [
      streamingEvents,
      streamingSchema,
      // Validate function_call streaming events are present
      (_, context) => {
        if (!context.streaming || !context.sseResult) return [];
        const errors: string[] = [];
        const eventTypes = context.sseResult.events.map(
          (e) => (e.data as any)?.type,
        );

        // Must have output_item.added with function_call type
        const hasAddedFunctionCall = context.sseResult.events.some(
          (e) =>
            (e.data as any)?.type === "response.output_item.added" &&
            (e.data as any)?.item?.type === "function_call",
        );
        if (!hasAddedFunctionCall) {
          errors.push(
            "Missing response.output_item.added event with function_call item",
          );
        }

        // Must have function_call_arguments.delta
        if (!eventTypes.includes("response.function_call_arguments.delta")) {
          errors.push("Missing response.function_call_arguments.delta event");
        }

        // Must have function_call_arguments.done
        if (!eventTypes.includes("response.function_call_arguments.done")) {
          errors.push("Missing response.function_call_arguments.done event");
        }

        // Must have output_item.done with function_call type
        const hasDoneFunctionCall = context.sseResult.events.some(
          (e) =>
            (e.data as any)?.type === "response.output_item.done" &&
            (e.data as any)?.item?.type === "function_call",
        );
        if (!hasDoneFunctionCall) {
          errors.push(
            "Missing response.output_item.done event with function_call item",
          );
        }

        return errors;
      },
    ],
  },

  {
    id: "image-input",
    name: "Image Input",
    description: "Send image URL in user content",
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "What do you see in this image? Answer in one sentence.",
            },
            {
              type: "input_image",
              image_url:
                // a red heart icon on a white background
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAABmklEQVR42tyWAaTyUBzFew/eG4AHz+MBSAHKBiJRGFKwIgQQJKLUIioBIhCAiCAAEizAQIAECaASqFFJq84nudjnaqvuPnxzgP9xfrq5938csPn7PwHTKSoViCIEAYEAMhmoKsU2mUCWEQqB5xEMIp/HaGQG2G6RSuH9HQ7H34rFrtPbdz4jl6PbwmEsl3QA1mt4vcRKk8dz9eg6IpF7tt9fzGY0gCgafFRFo5Blc5vLhf3eCOj1yNhM5GRMVK0aATxPZoz09YXjkQDmczJgquGQAPp9WwCNBgG027YACgUC6HRsAZRKBDAY2AJoNv/ZnwzA6WScznG3p4UAymXGAEkyXrTFAh8fLAGqagQAyGaZpYsi7bHTNPz8MEj//LxuFPo+UBS8vb0KaLXubrRa7aX0RMLCykwmn0z3+XA4WACcTpCkh9MFAZpmuVXo+mO/w+/HZvNgbblcUCxaSo/Hyck80Yu6XXDcvfVZr79cvMZjuN2U9O9vKAqjZrfbIZ0mV4TUi9Xqz6jddNy//7+e3n8Fhf/Llo2kxi8AQyGRoDkmAhAAAAAASUVORK5CYII=",
            },
          ],
        },
      ],
    }),
    validators: [hasOutput, completedStatus],
  },

  {
    id: "multi-turn",
    name: "Multi-turn Conversation",
    description: "Send assistant + user messages as conversation history",
    getRequest: (config) => ({
      model: config.model,
      input: [
        { type: "message", role: "user", content: "My name is Alice." },
        {
          type: "message",
          role: "assistant",
          content: "Hello Alice! Nice to meet you. How can I help you today?",
        },
        { type: "message", role: "user", content: "What is my name?" },
      ],
    }),
    validators: [hasOutput, completedStatus],
  },
];

async function makeRequest(
  config: TestConfig,
  body: CreateResponseBody,
  streaming = false,
): Promise<Response> {
  const authValue = config.useBearerPrefix
    ? `Bearer ${config.apiKey}`
    : config.apiKey;

  return fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [config.authHeaderName]: authValue,
    },
    body: JSON.stringify({ ...body, stream: streaming }),
  });
}

async function runTest(
  template: TestTemplate,
  config: TestConfig,
): Promise<TestResult> {
  const startTime = Date.now();
  const requestBody = template.getRequest(config);
  const streaming = template.streaming ?? false;

  try {
    const response = await makeRequest(config, requestBody, streaming);
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration,
        request: requestBody,
        response: errorText,
        errors: [`HTTP ${response.status}: ${errorText}`],
      };
    }

    let rawData: unknown;
    let sseResult: SSEParseResult | undefined;

    if (streaming) {
      sseResult = await parseSSEStream(response);
      rawData = sseResult.finalResponse;
    } else {
      rawData = await response.json();
    }

    // Parse with Zod first - schema validation
    const parseResult = responseResourceSchema.safeParse(rawData);
    if (!parseResult.success) {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration,
        request: streaming ? { ...requestBody, stream: true } : requestBody,
        response: rawData,
        errors: parseResult.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
        streamEvents: sseResult?.events.length,
      };
    }

    // Run semantic validators on typed data
    const context: ValidatorContext = { streaming, sseResult };
    const errors = template.validators.flatMap((v) =>
      v(parseResult.data, context),
    );

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: errors.length === 0 ? "passed" : "failed",
      duration,
      request: streaming ? { ...requestBody, stream: true } : requestBody,
      response: parseResult.data,
      errors,
      streamEvents: sseResult?.events.length,
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: requestBody,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function runAllTests(
  config: TestConfig,
  onProgress: (result: TestResult) => void,
): Promise<TestResult[]> {
  const promises = testTemplates.map(async (template) => {
    onProgress({
      id: template.id,
      name: template.name,
      description: template.description,
      status: "running",
    });

    const result = await runTest(template, config);
    onProgress(result);
    return result;
  });

  return Promise.all(promises);
}
