import type { z } from "zod";
import { compactResourceSchema } from "../generated/kubb/zod/compactResourceSchema";
import type { createResponseBodySchema } from "../generated/kubb/zod/createResponseBodySchema";
import { responseResourceSchema } from "../generated/kubb/zod/responseResourceSchema";
import { webSocketResponseCreateEventSchema } from "../generated/kubb/zod/webSocketResponseCreateEventSchema";
import {
  getTerminalResponse,
  parseSSEStream,
  parseStreamingEventData,
  type SSEParseResult,
} from "./sse-parser";

type ResponseResource = z.infer<typeof responseResourceSchema>;
type CompactResource = z.infer<typeof compactResourceSchema>;
type CreateResponseBody = z.infer<typeof createResponseBodySchema>;
type ParsedResponse = ResponseResource | CompactResource;
type ResponseSchema = z.ZodTypeAny;
type TestRequestBody = Partial<CreateResponseBody> & Record<string, unknown>;
type TestTransport = "http" | "websocket";
type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped";
type WebSocketTurnResult = SSEParseResult & {
  errorCode?: string | null;
  errorEvent?: unknown;
  rawMessages: unknown[];
  request?: TestRequestBody;
};
type WebSocketRequestStep =
  | TestRequestBody
  | ((previousTurns: WebSocketTurnResult[]) => TestRequestBody);
interface WebSocketSessionOptions {
  validateRequests?: boolean;
}

export interface TestConfig {
  baseUrl: string;
  apiKey: string;
  authHeaderName: string;
  useBearerPrefix: boolean;
  model: string;
  runtime?: "browser" | "server";
  timeoutMs?: number;
}

export interface TestResult {
  id: string;
  name: string;
  description: string;
  status: TestStatus;
  duration?: number;
  request?: unknown;
  response?: unknown;
  errors?: string[];
  streamEvents?: number;
}

interface ValidatorContext {
  streaming: boolean;
  sseResult?: SSEParseResult;
  transport: TestTransport;
}

type ResponseValidator = (
  response: ParsedResponse,
  context: ValidatorContext,
) => string[];

export interface TestTemplate {
  id: string;
  name: string;
  description: string;
  transport?: TestTransport;
  endpoint?: string;
  expectedStatuses?: number[];
  responseSchema?: ResponseSchema | null;
  getRequest: (config: TestConfig) => TestRequestBody;
  getMockResponse?: (config: TestConfig) => unknown;
  streaming?: boolean;
  validators?: ResponseValidator[];
  unsupportedReason?: (config: TestConfig) => string | null;
  run?: (config: TestConfig, template: TestTemplate) => Promise<TestResult>;
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

const hasAssistantMessagePhase =
  (phase: "commentary" | "final_answer"): ResponseValidator =>
  (response) => {
    const hasPhase = response.output?.some(
      (item) =>
        item.type === "message" &&
        "role" in item &&
        item.role === "assistant" &&
        "phase" in item &&
        item.phase === phase,
    );

    if (!hasPhase) {
      return [
        `Expected assistant output message with phase "${phase}" but none found`,
      ];
    }

    return [];
  };

const completedStatus: ResponseValidator = (response) => {
  if (!("status" in response)) {
    return ['Expected a standard response object with a "status" field'];
  }
  if (response.status !== "completed") {
    return [`Expected status "completed" but got "${response.status}"`];
  }
  return [];
};

const cachedTokensGreaterThanZero: ResponseValidator = (response) => {
  const cachedTokens =
    "usage" in response
      ? response.usage?.input_tokens_details?.cached_tokens
      : undefined;
  return typeof cachedTokens === "number" && cachedTokens > 0
    ? []
    : [
        `Expected usage.input_tokens_details.cached_tokens > 0 but got ${cachedTokens ?? "missing"}. Check that the provider/model supports prompt caching and the shared prefix meets its minimum cacheable length.`,
      ];
};

const compactObject: ResponseValidator = (response) => {
  if (response.object !== "response.compaction") {
    return [
      `Expected object "response.compaction" but got "${response.object}"`,
    ];
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

const webSocketBrowserUnsupported = (config: TestConfig) => {
  if (config.runtime === "browser") {
    return "WebSocket compliance tests require a server-side runtime because browsers cannot set the required authorization header.";
  }
  return null;
};

const formatZodIssues = (prefix: string, error: z.ZodError) =>
  error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${prefix}${path}: ${issue.message}`;
  });

const validateWebSocketCreateEvent = (body: TestRequestBody) => {
  const parseResult = webSocketResponseCreateEventSchema.safeParse(body);
  if (parseResult.success) return [];
  return formatZodIssues("WebSocket request ", parseResult.error);
};

const getStreamingErrorCode = (data: unknown) => {
  if (!data || typeof data !== "object") return null;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

const getResponseErrorCode = (response: unknown) => {
  if (!response || typeof response !== "object") return null;
  const error = (response as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};

const getTurnErrorCode = (turn: WebSocketTurnResult | undefined) =>
  turn?.errorCode ?? getResponseErrorCode(turn?.finalResponse);

const isFailedTurn = (turn: WebSocketTurnResult | undefined) =>
  Boolean(turn?.errorEvent) ||
  Boolean(getTurnErrorCode(turn)) ||
  turn?.finalResponse?.status === "failed";

function createResponseResult(
  template: TestTemplate,
  requestBody: unknown,
  rawData: unknown,
  sseResult: SSEParseResult | undefined,
  startTime: number,
  context: ValidatorContext,
): TestResult {
  const duration = Date.now() - startTime;
  const parseResult = responseResourceSchema.safeParse(rawData);
  if (!parseResult.success) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration,
      request: requestBody,
      response: rawData,
      errors: [
        ...(sseResult?.errors ?? []),
        ...formatZodIssues("", parseResult.error),
      ],
      streamEvents: sseResult?.events.length,
    };
  }

  const errors = (template.validators ?? []).flatMap((v) =>
    v(parseResult.data, context),
  );

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: errors.length === 0 ? "passed" : "failed",
    duration,
    request: requestBody,
    response: parseResult.data,
    errors,
    streamEvents: sseResult?.events.length,
  };
}

function hasResponseId(response: unknown) {
  const parseResult = responseResourceSchema.safeParse(response);
  if (!parseResult.success) {
    return formatZodIssues("", parseResult.error);
  }
  return parseResult.data.id ? [] : ["Warmup response did not include an id"];
}

function midConversationCacheTemplate(
  role: "developer" | "system",
  streaming: boolean,
): TestTemplate {
  return {
    id: `mid-conversation-${role}-cache${streaming ? "-streaming" : ""}`,
    name: `Mid-conversation ${role} Prompt Cache${streaming ? " (Streaming)" : ""}`,
    description: `Primes a long conversation, then appends a ${role} message and requires cached input tokens on the second response. Sends two requests; requires a cache-capable provider/model.`,
    streaming,
    getRequest: (config) => {
      const nonce = crypto.randomUUID();
      return {
        model: config.model,
        store: false,
        truncation: "disabled",
        prompt_cache_key: `openresponses-cache-${nonce}`,
        input: [
          {
            type: "message",
            role: "system",
            // A long system prefix could still hit the cache after a bad hoist.
            content: `Run ${nonce}. Answer the latest user request briefly.`,
          },
          {
            type: "message",
            role: "user",
            content: Array.from(
              { length: 512 },
              (_, index) =>
                `Reference record ${index + 1}: A careful observer records the river level and checks the weather before each crossing.`,
            ).join("\n"),
          },
          {
            type: "message",
            role: "assistant",
            content: "I have read the reference records.",
          },
          // End on a user turn, avoiding assistant-prefill requirements.
          { type: "message", role: "user", content: "Reply with OK." },
        ],
      };
    },
    validators: [
      hasOutput,
      completedStatus,
      streamingEvents,
      cachedTokensGreaterThanZero,
    ],
    run: (config, template) =>
      runMidConversationCacheTest(config, template, role),
  };
}

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
    id: "assistant-phase",
    name: "Assistant Message Phase",
    description:
      "Sends assistant history with phase labels and validates contract acceptance",
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "assistant",
          phase: "commentary",
          content: "I should answer with the saved number.",
        },
        {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: "The number is four.",
        },
        {
          type: "message",
          role: "user",
          content: "Repeat only the number.",
        },
      ],
    }),
    validators: [hasOutput, completedStatus],
  },

  {
    id: "response-output-phase-schema",
    name: "Response Output Phase Schema",
    description:
      "Validates ResponseResource schema support for assistant output phase labels",
    getRequest: (config) => ({
      model: config.model,
      note: "Local schema fixture; no HTTP request is sent.",
    }),
    getMockResponse: (config) => ({
      id: "resp_phase_schema",
      object: "response",
      created_at: 1764967971,
      completed_at: 1764967972,
      status: "completed",
      incomplete_details: null,
      model: config.model,
      previous_response_id: null,
      instructions: null,
      output: [
        {
          id: "msg_phase_commentary",
          type: "message",
          status: "completed",
          role: "assistant",
          phase: "commentary",
          content: [
            {
              type: "output_text",
              text: "I am checking the answer.",
              annotations: [],
            },
          ],
        },
        {
          id: "msg_phase_final",
          type: "message",
          status: "completed",
          role: "assistant",
          phase: "final_answer",
          content: [
            {
              type: "output_text",
              text: "The answer is four.",
              annotations: [],
            },
          ],
        },
      ],
      error: null,
      tools: [],
      tool_choice: "auto",
      truncation: "disabled",
      parallel_tool_calls: true,
      text: {
        format: {
          type: "text",
        },
      },
      top_p: 1,
      presence_penalty: 0,
      frequency_penalty: 0,
      top_logprobs: 0,
      temperature: 1,
      reasoning: {
        effort: null,
        summary: null,
      },
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
        input_tokens_details: {
          cached_tokens: 0,
        },
        output_tokens_details: {
          reasoning_tokens: 0,
        },
      },
      max_output_tokens: null,
      max_tool_calls: null,
      store: true,
      background: false,
      service_tier: "default",
      metadata: {},
      safety_identifier: null,
      prompt_cache_key: null,
    }),
    validators: [
      hasOutput,
      completedStatus,
      hasAssistantMessagePhase("commentary"),
      hasAssistantMessagePhase("final_answer"),
    ],
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
    id: "websocket-response",
    name: "WebSocket Response",
    description:
      "Creates a response over WebSocket and validates returned streaming events",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      input: [{ type: "message", role: "user", content: "Count from 1 to 3." }],
    }),
    validators: [streamingEvents, streamingSchema, completedStatus],
  },

  {
    id: "websocket-sequential-responses",
    name: "WebSocket Sequential Responses",
    description:
      "Sends multiple response.create messages on one WebSocket connection and validates sequential terminal responses",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      store: false,
      input: "Reply with exactly: first",
    }),
    validators: [streamingEvents, streamingSchema, completedStatus],
    run: runWebSocketSequentialResponsesTest,
  },

  {
    id: "websocket-continuation",
    name: "WebSocket Continuation",
    description:
      "Continues a store:false response on the active WebSocket using previous_response_id and only new input",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      store: false,
      input: "Remember the code word: cobalt. Reply with OK.",
    }),
    validators: [streamingEvents, streamingSchema, completedStatus],
    run: runWebSocketContinuationTest,
  },

  {
    id: "websocket-reconnect-store-false-recovery",
    name: "WebSocket Store False Reconnect Recovery",
    description:
      "Creates a store:false response, reconnects on a new WebSocket, validates previous_response_not_found, then starts a clean recovery response",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      store: false,
      input: "Remember the code word: copper. Reply with OK.",
    }),
    validators: [],
    run: runWebSocketReconnectStoreFalseRecoveryTest,
  },

  {
    id: "websocket-previous-response-not-found",
    name: "WebSocket Missing Previous Response",
    description:
      "Verifies store:false continuation with an uncached previous_response_id returns previous_response_not_found",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      store: false,
      previous_response_id: `resp_openresponses_missing_${Date.now()}`,
      input: "This should fail because the previous response is missing.",
    }),
    validators: [],
    run: runWebSocketPreviousResponseNotFoundTest,
  },

  {
    id: "websocket-failed-continuation-evicts-cache",
    name: "WebSocket Failed Continuation Evicts Cache",
    description:
      "Fails a store:false continuation and verifies the referenced previous_response_id is evicted from connection-local state",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      store: false,
      input: "Remember the code word: ember. Reply with OK.",
    }),
    validators: [],
    run: runWebSocketFailedContinuationEvictsCacheTest,
  },

  {
    id: "websocket-compact-new-chain",
    name: "WebSocket Compact New Chain",
    description:
      "Uses /responses/compact output as the base input for a new WebSocket response without previous_response_id",
    transport: "websocket",
    streaming: true,
    unsupportedReason: webSocketBrowserUnsupported,
    getRequest: (config) => ({
      type: "response.create",
      model: config.model,
      store: false,
      input: "This seed request only validates the WebSocket schema.",
    }),
    validators: [streamingEvents, streamingSchema, completedStatus],
    run: runWebSocketCompactNewChainTest,
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

  ...(["developer", "system"] as const).flatMap((role) =>
    [false, true].map((streaming) =>
      midConversationCacheTemplate(role, streaming),
    ),
  ),

  {
    id: "compact-response",
    name: "Compaction Endpoint",
    description:
      "Compacts a short conversation with prompt_cache_key and validates the compacted response schema",
    endpoint: "/responses/compact",
    responseSchema: compactResourceSchema,
    getRequest: (config) => ({
      model: config.model,
      prompt_cache_key: "openresponses-compact-test",
      input: [
        {
          type: "message",
          role: "user",
          content: "We agreed to launch on Tuesday and notify support first.",
        },
        {
          type: "message",
          role: "assistant",
          content:
            "Understood. The launch is Tuesday, with support notified beforehand.",
        },
      ],
    }),
    validators: [hasOutput, compactObject, hasOutputType("compaction")],
  },

  {
    id: "compact-missing-model",
    name: "Compaction Missing Required Model",
    description:
      "Rejects a compact request that omits the required model field",
    endpoint: "/responses/compact",
    expectedStatuses: [400, 422],
    responseSchema: null,
    getRequest: () => ({
      input: [
        {
          type: "message",
          role: "user",
          content: "Compact this conversation.",
        },
      ],
    }),
  },
];

async function makeRequest(
  config: TestConfig,
  endpoint: string,
  body: Record<string, unknown>,
  streaming = false,
): Promise<{
  response: Response;
  rawData: unknown;
  sseResult?: SSEParseResult;
}> {
  const authValue = config.useBearerPrefix
    ? `Bearer ${config.apiKey}`
    : config.apiKey;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`HTTP request to ${endpoint} timed out`)),
    config.timeoutMs ?? 30000,
  );

  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/$/, "")}${endpoint}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [config.authHeaderName]: authValue,
        },
        body: JSON.stringify(
          streaming && body && typeof body === "object" && !Array.isArray(body)
            ? { ...body, stream: true }
            : body,
        ),
        signal: controller.signal,
      },
    );
    const result = await readResponseBody(response, streaming);
    controller.signal.throwIfAborted();
    return { response, ...result };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function toWebSocketUrl(baseUrl: string) {
  const responseUrl = new URL(`${baseUrl.replace(/\/$/, "")}/responses`);

  if (responseUrl.protocol === "https:") {
    responseUrl.protocol = "wss:";
  } else if (responseUrl.protocol === "http:") {
    responseUrl.protocol = "ws:";
  } else if (
    responseUrl.protocol !== "ws:" &&
    responseUrl.protocol !== "wss:"
  ) {
    throw new Error(
      `Unsupported base URL protocol for WebSocket: ${responseUrl.protocol}`,
    );
  }

  return responseUrl.toString();
}

function createEmptyWebSocketTurn(): WebSocketTurnResult {
  return {
    events: [],
    errors: [],
    finalResponse: null,
    rawMessages: [],
    errorCode: null,
  };
}

async function makeWebSocketSession(
  config: TestConfig,
  steps: WebSocketRequestStep[],
  options: WebSocketSessionOptions = {},
): Promise<WebSocketTurnResult[]> {
  const authValue = config.useBearerPrefix
    ? `Bearer ${config.apiKey}`
    : config.apiKey;

  return new Promise((resolve, reject) => {
    const turns = steps.map(() => createEmptyWebSocketTurn());
    let turnIndex = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let settled = false;

    const clearPendingTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearPendingTimeout();
      try {
        ws?.close();
      } catch {
        // Ignore close errors after a terminal event.
      }
      resolve(turns);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearPendingTimeout();
      try {
        ws?.close();
      } catch {
        // Ignore close errors while rejecting the request.
      }
      reject(error);
    };

    const currentTurn = () => turns[turnIndex];

    const armTimeout = (message: string) => {
      clearPendingTimeout();
      timeout = setTimeout(
        () => fail(new Error(message)),
        config.timeoutMs ?? 30000,
      );
    };

    const sendCurrentRequest = () => {
      if (!ws || turnIndex >= steps.length) {
        finish();
        return;
      }
      const turn = currentTurn();
      if (!turn) {
        finish();
        return;
      }
      let body: TestRequestBody;
      try {
        const step = steps[turnIndex];
        body =
          typeof step === "function" ? step(turns.slice(0, turnIndex)) : step;
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (options.validateRequests !== false) {
        const requestValidationErrors = validateWebSocketCreateEvent(body);
        if (requestValidationErrors.length > 0) {
          fail(
            new Error(
              requestValidationErrors
                .map((error) => `Request ${turnIndex + 1}: ${error}`)
                .join("\n"),
            ),
          );
          return;
        }
      }
      turn.request = body;
      armTimeout("Timed out waiting for terminal WebSocket response event");
      try {
        ws.send(JSON.stringify(body));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const completeCurrentTurn = () => {
      clearPendingTimeout();
      turnIndex += 1;
      if (turnIndex >= steps.length) {
        finish();
      } else {
        sendCurrentRequest();
      }
    };

    const messageDataToString = (data: MessageEvent["data"]) => {
      if (typeof data === "string") return data;
      if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
      if (ArrayBuffer.isView(data)) {
        return new TextDecoder().decode(data);
      }
      return String(data);
    };

    try {
      type WebSocketConstructorWithHeaders = new (
        url: string | URL,
        options?: { headers?: Record<string, string> },
      ) => WebSocket;
      // Bun supports headers for client WebSockets; browser runs skip this path.
      const WebSocketWithHeaders =
        WebSocket as unknown as WebSocketConstructorWithHeaders;

      ws = new WebSocketWithHeaders(toWebSocketUrl(config.baseUrl), {
        headers: {
          "Content-Type": "application/json",
          [config.authHeaderName]: authValue,
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    armTimeout("Timed out opening WebSocket connection");
    ws.addEventListener("open", () => {
      if (settled) return;
      sendCurrentRequest();
    });

    ws.addEventListener("message", (message) => {
      if (settled) return;
      const turn = currentTurn();
      if (!turn) return;

      const data = messageDataToString(message.data);
      if (data === "[DONE]") {
        if (!turn.finalResponse && !turn.errorCode) {
          turn.errors.push("Received [DONE] before a terminal WebSocket event");
        }
        completeCurrentTurn();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const parsedEvent = parseStreamingEventData(parsed, undefined, {
          transport: "websocket",
        });
        turn.rawMessages.push(parsed);
        turn.events.push(parsedEvent);

        if (!parsedEvent.validationResult.success) {
          turn.errors.push(
            `Event validation failed for ${parsedEvent.event}: ${JSON.stringify(parsedEvent.validationResult.error.issues)}`,
          );
        }

        const terminalResponse = getTerminalResponse(parsed);
        if (terminalResponse) {
          turn.finalResponse = terminalResponse;
          completeCurrentTurn();
          return;
        }

        const errorCode = getStreamingErrorCode(parsed);
        if (parsedEvent.event === "error" || errorCode) {
          turn.errorCode = errorCode;
          turn.errorEvent = parsed;
          if (!errorCode) {
            turn.errors.push(
              `WebSocket error event: ${JSON.stringify(parsed)}`,
            );
          }
          completeCurrentTurn();
        }
      } catch {
        turn.errors.push(`Failed to parse WebSocket event data: ${data}`);
      }
    });

    ws.addEventListener("error", () => {
      fail(new Error("WebSocket connection failed"));
    });

    ws.addEventListener("close", () => {
      const turn = currentTurn();
      if (!settled && turn && !turn.finalResponse && !turn.errorCode) {
        turn.errors.push("WebSocket closed before a terminal response event");
      }
      finish();
    });
  });
}

async function makeWebSocketRequest(
  config: TestConfig,
  body: TestRequestBody,
): Promise<SSEParseResult> {
  const [result] = await makeWebSocketSession(config, [body]);
  return result;
}

async function readResponseBody(
  response: Response,
  streaming = false,
): Promise<{ rawData: unknown; sseResult?: SSEParseResult }> {
  if (streaming) {
    const sseResult = await parseSSEStream(response);
    return { rawData: sseResult.finalResponse, sseResult };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { rawData: await response.json() };
  }

  return { rawData: await response.text() };
}

function displayRequest(
  requestBody: TestRequestBody,
  streaming: boolean,
): TestRequestBody {
  return streaming ? { ...requestBody, stream: true } : requestBody;
}

function validateResponseData(
  template: TestTemplate,
  requestBody: TestRequestBody,
  rawData: unknown,
  duration: number,
  responseSchema: ResponseSchema | null,
  context: ValidatorContext,
): TestResult {
  const request = displayRequest(requestBody, context.streaming);

  if (!responseSchema) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "passed",
      duration,
      request,
      response: rawData,
      streamEvents: context.sseResult?.events.length,
    };
  }

  const parseResult = responseSchema.safeParse(rawData);
  if (!parseResult.success) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration,
      request,
      response: rawData,
      errors: parseResult.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
      streamEvents: context.sseResult?.events.length,
    };
  }

  const errors = (template.validators ?? []).flatMap((v) =>
    v(parseResult.data as ParsedResponse, context),
  );

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: errors.length === 0 ? "passed" : "failed",
    duration,
    request,
    response: parseResult.data,
    errors,
    streamEvents: context.sseResult?.events.length,
  };
}

async function runMidConversationCacheTest(
  config: TestConfig,
  template: TestTemplate,
  role: "developer" | "system",
): Promise<TestResult> {
  const startTime = Date.now();
  const streaming = template.streaming ?? false;
  const requests: Record<string, TestRequestBody> = {};
  const responses: Record<string, unknown> = {};
  const errors: string[] = [];
  let stage: "prime" | "followup" = "prime";
  let streamEvents = 0;

  try {
    const prime = template.getRequest(config);
    if (!Array.isArray(prime.input)) {
      throw new Error("Prompt cache test requires an input array");
    }

    for (const step of ["prime", "followup"] as const) {
      stage = step;
      const body: TestRequestBody =
        stage === "prime"
          ? prime
          : {
              ...prime,
              input: [
                ...prime.input,
                {
                  type: "message",
                  role,
                  content: "For the next reply, use a brief acknowledgement.",
                },
                {
                  type: "message",
                  role: "user",
                  content: "Acknowledge this update.",
                },
              ],
            };
      requests[stage] = displayRequest(body, streaming);
      const { response, rawData, sseResult } = await makeRequest(
        config,
        "/responses",
        body,
        streaming,
      );
      responses[stage] = rawData;
      streamEvents += sseResult?.events.length ?? 0;
      const stageErrors = [...(sseResult?.errors ?? [])];

      if (sseResult) {
        let terminalType: unknown;
        for (const { data } of sseResult.events) {
          const type =
            data && typeof data === "object" && "type" in data
              ? data.type
              : undefined;
          if (getTerminalResponse(data)) terminalType = type;
          if (
            type === "error" ||
            type === "response.failed" ||
            type === "response.incomplete"
          ) {
            stageErrors.push(`Received ${type} streaming event`);
          }
        }
        if (terminalType !== "response.completed") {
          stageErrors.push(
            `Expected terminal response.completed event but got ${terminalType ?? "none"}`,
          );
        }
      }

      if (response.status !== 200) {
        stageErrors.push(`HTTP ${response.status}: ${JSON.stringify(rawData)}`);
      } else {
        const validation = validateResponseData(
          stage === "prime"
            ? {
                ...template,
                validators: [hasOutput, completedStatus, streamingEvents],
              }
            : template,
          body,
          rawData,
          Date.now() - startTime,
          responseResourceSchema,
          { streaming, sseResult, transport: "http" },
        );
        stageErrors.push(...(validation.errors ?? []));
      }

      errors.push(...stageErrors.map((error) => `${stage}: ${error}`));
      if (errors.length > 0) break;
    }
  } catch (error) {
    errors.push(
      `${stage}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: errors.length === 0 ? "passed" : "failed",
    duration: Date.now() - startTime,
    request: requests,
    response: responses,
    errors,
    streamEvents: streaming ? streamEvents : undefined,
  };
}

function getCompactedOutput(response: unknown): {
  output: unknown[];
  errors: string[];
} {
  if (!response || typeof response !== "object") {
    return { output: [], errors: ["Compaction response was not an object"] };
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return {
      output: [],
      errors: ["Compaction response did not include an output array"],
    };
  }

  return { output, errors: [] };
}

async function runWebSocketSequentialResponsesTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const requests: TestRequestBody[] = [
    {
      type: "response.create",
      model: config.model,
      store: false,
      input: "Reply with exactly: first",
    },
    {
      type: "response.create",
      model: config.model,
      store: false,
      input: "Reply with exactly: second",
    },
  ];

  try {
    const turns = await makeWebSocketSession(config, requests);
    const errors: string[] = [];
    for (const [index, turn] of turns.entries()) {
      const result = createResponseResult(
        template,
        requests[index],
        turn.finalResponse,
        turn,
        startTime,
        { streaming: true, sseResult: turn, transport: "websocket" },
      );
      if (result.errors?.length) {
        errors.push(
          ...result.errors.map((error) => `Turn ${index + 1}: ${error}`),
        );
      }
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: errors.length === 0 ? "passed" : "failed",
      duration: Date.now() - startTime,
      request: requests,
      response: turns.map((turn) => turn.finalResponse),
      errors,
      streamEvents: turns.reduce((sum, turn) => sum + turn.events.length, 0),
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: requests,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runWebSocketContinuationTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const firstRequest = template.getRequest(config);

  try {
    const [firstTurn, secondTurn] = await makeWebSocketSession(config, [
      firstRequest,
      (turns) => {
        const previousResponseId = turns[0]?.finalResponse?.id;
        if (!previousResponseId) {
          throw new Error("First WebSocket turn did not return a response id");
        }
        return {
          type: "response.create",
          model: config.model,
          store: false,
          previous_response_id: previousResponseId,
          input: "What is the code word? Reply with only the code word.",
        };
      },
    ]);
    const firstErrors = [
      ...firstTurn.errors,
      ...hasResponseId(firstTurn.finalResponse),
    ];

    if (firstErrors.length > 0 || !firstTurn.finalResponse?.id || !secondTurn) {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration: Date.now() - startTime,
        request: firstRequest,
        response: firstTurn.finalResponse,
        errors:
          firstErrors.length > 0
            ? firstErrors
            : ["Second WebSocket continuation turn did not run"],
        streamEvents: firstTurn.events.length,
      };
    }

    const secondResult = createResponseResult(
      template,
      [firstTurn.request, secondTurn.request],
      secondTurn.finalResponse,
      secondTurn,
      startTime,
      { streaming: true, sseResult: secondTurn, transport: "websocket" },
    );

    return {
      ...secondResult,
      request: [firstTurn.request, secondTurn.request],
      response: [firstTurn.finalResponse, secondTurn.finalResponse],
      streamEvents: firstTurn.events.length + secondTurn.events.length,
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: firstRequest,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runWebSocketReconnectStoreFalseRecoveryTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const firstRequest = template.getRequest(config);

  try {
    const [firstTurn] = await makeWebSocketSession(config, [firstRequest]);
    const firstErrors = [
      ...firstTurn.errors,
      ...hasResponseId(firstTurn.finalResponse),
    ];
    const previousResponseId = firstTurn.finalResponse?.id;

    if (firstErrors.length > 0 || !previousResponseId) {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration: Date.now() - startTime,
        request: firstRequest,
        response: firstTurn.finalResponse,
        errors: firstErrors,
        streamEvents: firstTurn.events.length,
      };
    }

    const reconnectRequest: TestRequestBody = {
      type: "response.create",
      model: config.model,
      store: false,
      previous_response_id: previousResponseId,
      input: "Try to continue after reconnect. Reply with exactly: reconnected",
    };
    const recoveryRequest: TestRequestBody = {
      type: "response.create",
      model: config.model,
      store: false,
      input: [
        {
          type: "message",
          role: "user",
          content:
            "The previous store:false chain could not continue after reconnect. Start a new response and reply with exactly: recovered",
        },
      ],
    };
    const [reconnectTurn, recoveryTurn] = await makeWebSocketSession(config, [
      reconnectRequest,
      recoveryRequest,
    ]);
    const reconnectErrorCode = getTurnErrorCode(reconnectTurn);
    const errors = [...reconnectTurn.errors];

    if (reconnectErrorCode !== "previous_response_not_found") {
      errors.push(
        `Expected previous_response_not_found after reconnecting a store:false chain but got ${reconnectErrorCode ?? "no error code"}`,
      );
    }
    if (!recoveryTurn) {
      errors.push("Recovery WebSocket turn did not run after reconnect miss");
    } else {
      const recoveryResult = createResponseResult(
        template,
        recoveryRequest,
        recoveryTurn.finalResponse,
        recoveryTurn,
        startTime,
        { streaming: true, sseResult: recoveryTurn, transport: "websocket" },
      );
      errors.push(...(recoveryResult.errors ?? []));
      if ("previous_response_id" in recoveryRequest) {
        errors.push(
          "Reconnect recovery must start a new response without previous_response_id",
        );
      }
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: errors.length === 0 ? "passed" : "failed",
      duration: Date.now() - startTime,
      request: [
        firstTurn.request,
        reconnectTurn.request,
        recoveryTurn?.request,
      ],
      response: [
        firstTurn.finalResponse,
        reconnectTurn.errorEvent ?? reconnectTurn.finalResponse,
        recoveryTurn?.finalResponse,
      ],
      errors,
      streamEvents:
        firstTurn.events.length +
        reconnectTurn.events.length +
        (recoveryTurn?.events.length ?? 0),
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: firstRequest,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runWebSocketPreviousResponseNotFoundTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const request = template.getRequest(config);

  try {
    const [turn] = await makeWebSocketSession(config, [request]);
    const errorCode =
      turn.errorCode ?? getResponseErrorCode(turn.finalResponse);
    const errors = [...turn.errors];
    if (errorCode !== "previous_response_not_found") {
      errors.unshift(
        `Expected previous_response_not_found but got ${errorCode ?? "no error code"}`,
      );
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: errors.length === 0 ? "passed" : "failed",
      duration: Date.now() - startTime,
      request,
      response: turn.errorEvent ?? turn.finalResponse,
      errors,
      streamEvents: turn.events.length,
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runWebSocketFailedContinuationEvictsCacheTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const firstRequest = template.getRequest(config);

  try {
    const [firstTurn, failedTurn, retryTurn] = await makeWebSocketSession(
      config,
      [
        firstRequest,
        (turns) => {
          const previousResponseId = turns[0]?.finalResponse?.id;
          if (!previousResponseId) {
            throw new Error(
              "First WebSocket turn did not return a response id",
            );
          }
          return {
            type: "response.create",
            model: config.model,
            store: false,
            previous_response_id: previousResponseId,
            input: [
              {
                type: "function_call_output",
                call_id: "call_openresponses_missing",
                output:
                  "No matching tool call exists in the previous response.",
              },
            ],
          };
        },
        (turns) => {
          const previousResponseId = turns[0]?.finalResponse?.id;
          if (!previousResponseId) {
            throw new Error(
              "First WebSocket turn did not return a response id",
            );
          }
          return {
            type: "response.create",
            model: config.model,
            store: false,
            previous_response_id: previousResponseId,
            input:
              "Try to continue after the failed turn. Reply with exactly: stale",
          };
        },
      ],
    );
    const errors = [
      ...firstTurn.errors,
      ...hasResponseId(firstTurn.finalResponse),
    ];

    if (!failedTurn) {
      errors.push("Failed WebSocket continuation turn did not run");
    } else if (!isFailedTurn(failedTurn)) {
      errors.push(...failedTurn.errors);
      errors.push(
        `Expected second WebSocket continuation turn to fail but got status ${failedTurn.finalResponse?.status ?? "no terminal response"}`,
      );
    }

    const retryErrorCode = getTurnErrorCode(retryTurn);
    if (!retryTurn) {
      errors.push("Retry WebSocket continuation turn did not run");
    } else {
      errors.push(...retryTurn.errors);
      if (retryErrorCode !== "previous_response_not_found") {
        errors.push(
          `Expected previous_response_not_found after failed continuation eviction but got ${retryErrorCode ?? "no error code"}`,
        );
      }
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: errors.length === 0 ? "passed" : "failed",
      duration: Date.now() - startTime,
      request: [firstTurn.request, failedTurn?.request, retryTurn?.request],
      response: [
        firstTurn.finalResponse,
        failedTurn?.errorEvent ?? failedTurn?.finalResponse,
        retryTurn?.errorEvent ?? retryTurn?.finalResponse,
      ],
      errors,
      streamEvents: [firstTurn, failedTurn, retryTurn].reduce(
        (sum, turn) => sum + (turn?.events.length ?? 0),
        0,
      ),
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: firstRequest,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runWebSocketCompactNewChainTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const compactRequest = {
    model: config.model,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Remember the compaction code word: slate.",
          },
        ],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "OK.",
          },
        ],
      },
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Compress this conversation for later continuation.",
          },
        ],
      },
    ],
  };

  try {
    const { response: compactResponse, rawData: compactBody } =
      await makeRequest(config, "/responses/compact", compactRequest);
    if (!compactResponse.ok) {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration: Date.now() - startTime,
        request: compactRequest,
        response: compactBody,
        errors: [
          `HTTP ${compactResponse.status} from /responses/compact: ${JSON.stringify(compactBody)}`,
        ],
      };
    }

    const { output, errors: compactErrors } = getCompactedOutput(compactBody);
    if (compactErrors.length > 0) {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration: Date.now() - startTime,
        request: compactRequest,
        response: compactBody,
        errors: compactErrors,
      };
    }

    const websocketRequest = {
      type: "response.create",
      model: config.model,
      store: false,
      input: [
        ...output,
        {
          type: "message",
          role: "user",
          content: "Continue from here. Reply with exactly: compacted",
        },
      ],
      tools: [],
    } as TestRequestBody;

    const [turn] = await makeWebSocketSession(
      config,
      [websocketRequest],
      // The compacted window is provider-generated and the guide requires
      // passing it back as-is, so preflight validation cannot assume a static
      // input schema for those returned items.
      { validateRequests: false },
    );
    const websocketResult = createResponseResult(
      template,
      websocketRequest,
      turn.finalResponse,
      turn,
      startTime,
      { streaming: true, sseResult: turn, transport: "websocket" },
    );
    const errors = [...(websocketResult.errors ?? [])];

    if ("previous_response_id" in websocketRequest) {
      errors.push(
        "Standalone compact recovery must start a new chain without previous_response_id",
      );
    }

    return {
      ...websocketResult,
      status: errors.length === 0 ? "passed" : "failed",
      request: {
        compact: compactRequest,
        websocket: turn.request,
      },
      response: {
        compact: compactBody,
        websocket: turn.finalResponse,
      },
      errors,
      streamEvents: turn.events.length,
    };
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: compactRequest,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function runTest(
  template: TestTemplate,
  config: TestConfig,
): Promise<TestResult> {
  const startTime = Date.now();
  const streaming = template.streaming ?? false;
  const transport = template.transport ?? "http";
  const endpoint = template.endpoint ?? "/responses";
  const expectedStatuses = template.expectedStatuses ?? [200];
  const responseSchema =
    template.responseSchema === undefined
      ? responseResourceSchema
      : template.responseSchema;

  const unsupportedReason = template.unsupportedReason?.(config);
  if (unsupportedReason) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "skipped",
      duration: 0,
      errors: [unsupportedReason],
    };
  }

  if (template.run) {
    return template.run(config, template);
  }

  const requestBody = template.getRequest(config);

  try {
    if (template.getMockResponse) {
      return validateResponseData(
        template,
        requestBody,
        template.getMockResponse(config),
        Date.now() - startTime,
        responseSchema,
        { streaming, transport },
      );
    }

    if (transport === "websocket") {
      const sseResult = await makeWebSocketRequest(config, requestBody);
      const duration = Date.now() - startTime;
      const rawData = sseResult.finalResponse;

      const parseResult = responseResourceSchema.safeParse(rawData);
      if (!parseResult.success) {
        return {
          id: template.id,
          name: template.name,
          description: template.description,
          status: "failed",
          duration,
          request: requestBody,
          response: rawData,
          errors: [
            ...sseResult.errors,
            ...parseResult.error.issues.map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`,
            ),
          ],
          streamEvents: sseResult.events.length,
        };
      }

      const context: ValidatorContext = {
        streaming,
        sseResult,
        transport,
      };
      const errors = (template.validators ?? []).flatMap((v) =>
        v(parseResult.data, context),
      );

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: errors.length === 0 ? "passed" : "failed",
        duration,
        request: requestBody,
        response: parseResult.data,
        errors,
        streamEvents: sseResult.events.length,
      };
    }

    const { response, rawData, sseResult } = await makeRequest(
      config,
      endpoint,
      requestBody,
      streaming,
    );
    const duration = Date.now() - startTime;

    if (!expectedStatuses.includes(response.status)) {
      return {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration,
        request: displayRequest(requestBody, streaming),
        response: rawData,
        errors: [`HTTP ${response.status}: ${String(rawData)}`],
        streamEvents: sseResult?.events.length,
      };
    }

    return validateResponseData(
      template,
      requestBody,
      rawData,
      duration,
      responseSchema,
      { streaming, sseResult, transport },
    );
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
  templates = testTemplates,
): Promise<TestResult[]> {
  const promises = templates.map(async (template) => {
    const startTime = Date.now();
    let result: TestResult;
    try {
      const unsupportedReason = template.unsupportedReason?.(config);
      if (unsupportedReason) {
        result = {
          id: template.id,
          name: template.name,
          description: template.description,
          status: "skipped",
          duration: 0,
          errors: [unsupportedReason],
        };
      } else {
        onProgress({
          id: template.id,
          name: template.name,
          description: template.description,
          status: "running",
        });
        result = await runTest(template, config);
      }
    } catch (error) {
      result = {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration: Date.now() - startTime,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
    onProgress(result);
    return result;
  });

  return Promise.all(promises);
}
