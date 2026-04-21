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
  fileSearchVectorStoreId?: string;
  enableOfflineWebSearch?: boolean;
}

export interface TestResult {
  id: string;
  name: string;
  description: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
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
  getRequest?: (config: TestConfig) => CreateResponseBody;
  run?: (config: TestConfig, template: TestTemplate) => Promise<TestResult>;
  streaming?: boolean;
  optional?: boolean;
  isEnabled?: (config: TestConfig) => boolean;
  skipReason?: (config: TestConfig) => string;
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

const optionalConfigMissing = (name: string) => () =>
  `${name} is optional and skipped until its required configuration is provided.`;

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
    id: "function-call-roundtrip",
    name: "Function Call Round Trip",
    description: "Execute a function_call and return function_call_output",
    run: runFunctionCallRoundTripTest,
    validators: [hasOutput, completedStatus],
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
    id: "file-input",
    name: "File Input",
    description: "Send a small base64 input_file content part",
    getRequest: (config) => ({
      model: config.model,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Read the attached file and answer with its title only.",
            },
            {
              type: "input_file",
              filename: "openresponses-fixture.pdf",
              file_data:
                "data:application/pdf;base64,JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTQ0XSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA3NCA+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjcyIDcyIFRkCihUaXRsZTogT3BlblJlc3BvbnNlcyBGaWxlIElucHV0IEZpeHR1cmUpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnRyYWlsZXIKPDwgL1Jvb3QgMSAwIFIgPj4KJSVFT0Y=",
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

  {
    id: "previous-response-id",
    name: "Previous Response ID",
    description: "Use previous_response_id for provider-managed turn state",
    run: runPreviousResponseIdTest,
    validators: [hasOutput, completedStatus],
  },

  {
    id: "file-search",
    name: "File Search",
    description: "Optional semantic search test using an existing vector store",
    optional: true,
    isEnabled: (config) => Boolean(config.fileSearchVectorStoreId),
    skipReason: optionalConfigMissing("File search"),
    getRequest: (config) => ({
      model: config.model,
      input:
        "Search the configured vector store for relevant content and summarize one result.",
      tools: [
        {
          type: "file_search",
          vector_store_ids: [config.fileSearchVectorStoreId ?? ""],
        },
      ],
      tool_choice: { type: "file_search" },
      include: ["file_search_call.results"],
    }),
    validators: [hasOutput, hasOutputType("file_search_call")],
  },

  {
    id: "offline-web-search",
    name: "Offline Web Search",
    description: "Optional web_search test with live web access disabled",
    optional: true,
    isEnabled: (config) => Boolean(config.enableOfflineWebSearch),
    skipReason: optionalConfigMissing("Offline web search"),
    getRequest: (config) => ({
      model: config.model,
      input: "Find the most relevant cached result for OpenResponses.",
      tools: [
        {
          type: "web_search",
          external_web_access: false,
        },
      ],
      tool_choice: { type: "web_search" },
      include: ["web_search_call.action.sources"],
    }),
    validators: [hasOutput, hasOutputType("web_search_call")],
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

function skipResult(template: TestTemplate, config: TestConfig): TestResult {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: "skipped",
    errors: [template.skipReason?.(config) ?? "Optional test skipped"],
  };
}

async function parseResponse(
  template: TestTemplate,
  response: Response,
  requestBody: CreateResponseBody,
  streaming: boolean,
  duration: number,
): Promise<
  | {
      ok: true;
      response: ResponseResource;
      sseResult?: SSEParseResult;
    }
  | { ok: false; result: TestResult }
> {
  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false,
      result: {
        id: template.id,
        name: template.name,
        description: template.description,
        status: "failed",
        duration,
        request: requestBody,
        response: errorText,
        errors: [`HTTP ${response.status}: ${errorText}`],
      },
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

  const parseResult = responseResourceSchema.safeParse(rawData);
  if (!parseResult.success) {
    return {
      ok: false,
      result: {
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
      },
    };
  }

  return {
    ok: true,
    response: parseResult.data,
    sseResult,
  };
}

async function runSingleRequestTest(
  template: TestTemplate,
  config: TestConfig,
): Promise<TestResult> {
  if (!template.getRequest) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      errors: ["Test template does not define a request"],
    };
  }

  const startTime = Date.now();
  const requestBody = template.getRequest(config);
  const streaming = template.streaming ?? false;
  const response = await makeRequest(config, requestBody, streaming);
  const duration = Date.now() - startTime;
  const parsed = await parseResponse(
    template,
    response,
    requestBody,
    streaming,
    duration,
  );

  if (parsed.ok === false) return parsed.result;

  const context: ValidatorContext = {
    streaming,
    sseResult: parsed.sseResult,
  };
  const errors = template.validators.flatMap((v) =>
    v(parsed.response, context),
  );

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: errors.length === 0 ? "passed" : "failed",
    duration,
    request: streaming ? { ...requestBody, stream: true } : requestBody,
    response: parsed.response,
    errors,
    streamEvents: parsed.sseResult?.events.length,
  };
}

async function runPreviousResponseIdTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const firstRequest: CreateResponseBody = {
    model: config.model,
    input: "Remember this code word: papaya. Reply with only OK.",
  };
  const firstResponse = await makeRequest(config, firstRequest);
  const firstParsed = await parseResponse(
    template,
    firstResponse,
    firstRequest,
    false,
    Date.now() - startTime,
  );

  if (firstParsed.ok === false) return firstParsed.result;

  const secondRequest: CreateResponseBody = {
    model: config.model,
    previous_response_id: firstParsed.response.id,
    input: "What code word did I ask you to remember?",
  };
  const secondResponse = await makeRequest(config, secondRequest);
  const duration = Date.now() - startTime;
  const secondParsed = await parseResponse(
    template,
    secondResponse,
    secondRequest,
    false,
    duration,
  );

  if (secondParsed.ok === false) return secondParsed.result;

  const errors = template.validators.flatMap((v) =>
    v(secondParsed.response, { streaming: false }),
  );

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: errors.length === 0 ? "passed" : "failed",
    duration,
    request: [firstRequest, secondRequest],
    response: [firstParsed.response, secondParsed.response],
    errors,
  };
}

async function runFunctionCallRoundTripTest(
  config: TestConfig,
  template: TestTemplate,
): Promise<TestResult> {
  const startTime = Date.now();
  const firstRequest: CreateResponseBody = {
    model: config.model,
    input: "Use the weather tool to get the temperature in San Francisco.",
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
    tool_choice: { type: "function", name: "get_weather" },
  };

  const firstResponse = await makeRequest(config, firstRequest);
  const firstParsed = await parseResponse(
    template,
    firstResponse,
    firstRequest,
    false,
    Date.now() - startTime,
  );

  if (firstParsed.ok === false) return firstParsed.result;

  const functionCall = firstParsed.response.output.find(
    (item) => item.type === "function_call",
  );
  if (!functionCall || !("call_id" in functionCall)) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
      duration: Date.now() - startTime,
      request: firstRequest,
      response: firstParsed.response,
      errors: ["First response did not include a function_call with call_id"],
    };
  }

  const secondRequest: CreateResponseBody = {
    model: config.model,
    previous_response_id: firstParsed.response.id,
    input: [
      {
        type: "function_call_output",
        call_id: functionCall.call_id,
        output: "64 degrees and clear",
      },
    ],
  };

  const secondResponse = await makeRequest(config, secondRequest);
  const duration = Date.now() - startTime;
  const secondParsed = await parseResponse(
    template,
    secondResponse,
    secondRequest,
    false,
    duration,
  );

  if (secondParsed.ok === false) return secondParsed.result;

  const errors = template.validators.flatMap((v) =>
    v(secondParsed.response, { streaming: false }),
  );

  return {
    id: template.id,
    name: template.name,
    description: template.description,
    status: errors.length === 0 ? "passed" : "failed",
    duration,
    request: [firstRequest, secondRequest],
    response: [firstParsed.response, secondParsed.response],
    errors,
  };
}

async function runTest(
  template: TestTemplate,
  config: TestConfig,
): Promise<TestResult> {
  try {
    if (template.isEnabled && !template.isEnabled(config)) {
      return skipResult(template, config);
    }
    if (template.run) return template.run(config, template);
    return runSingleRequestTest(template, config);
  } catch (error) {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: "failed",
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
