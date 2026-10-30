import { afterEach, describe, expect, test } from "bun:test";
import { createResponseBodySchema } from "../generated/kubb/zod/createResponseBodySchema";
import { errorStreamingEventSchema } from "../generated/kubb/zod/errorStreamingEventSchema";
import { responseFixture } from "./compliance-test-fixtures";
import {
  runAllTests,
  testTemplates,
  type TestConfig,
  type TestResult,
  type TestTemplate,
} from "./compliance-tests";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function config(server: ReturnType<typeof Bun.serve>): TestConfig {
  servers.push(server);
  return {
    baseUrl: server.url.toString().replace(/\/$/, ""),
    apiKey: "test-key",
    authHeaderName: "Authorization",
    useBearerPrefix: true,
    model: "test-model",
    runtime: "server",
    timeoutMs: 100,
  };
}

const httpTemplate: TestTemplate = {
  id: "http",
  name: "HTTP request",
  description: "Fixture HTTP request",
  getRequest: () => ({ model: "test-model", input: "Hello" }),
};

function template(id: string) {
  return testTemplates.find((value) => value.id === id)!;
}

function terminalEvent() {
  return JSON.stringify({
    type: "response.completed",
    sequence_number: 0,
    response: responseFixture,
  });
}

const cacheCases = ["developer", "system"].flatMap((role) =>
  [false, true].map((streaming) => ({
    role,
    streaming,
    id: `mid-conversation-${role}-cache${streaming ? "-streaming" : ""}`,
  })),
);

function cacheResponse(
  cachedTokens = 0,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...responseFixture,
    output: [
      {
        id: "msg_cache",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "OK", annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 8192,
      output_tokens: 1,
      total_tokens: 8193,
      input_tokens_details: { cached_tokens: cachedTokens },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    ...overrides,
  };
}

function cacheWireResponse(
  body: ReturnType<typeof cacheResponse>,
  streaming: boolean,
  extraEvents = "",
) {
  return streaming
    ? new Response(
        `data: ${JSON.stringify({ type: `response.${body.status}`, sequence_number: 0, response: body })}\n\n${extraEvents}`,
        { headers: { "Content-Type": "text/event-stream" } },
      )
    : Response.json(body);
}

describe("Mid-conversation prompt cache", () => {
  test.each(cacheCases)(
    "$role instructions preserve the request prefix (streaming: $streaming)",
    async ({ id, role, streaming }) => {
      const requests: Record<string, any>[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          expect(new URL(request.url).pathname).toBe("/responses");
          expect(request.method).toBe("POST");
          expect(request.headers.get("Authorization")).toBe("Bearer test-key");
          const body = await request.json();
          expect(createResponseBodySchema.safeParse(body).success).toBe(true);
          requests.push(body);
          return cacheWireResponse(
            cacheResponse(requests.length === 1 ? 0 : 4096),
            streaming,
          );
        },
      });
      const [result] = await runAllTests(
        { ...config(server), runtime: streaming ? "server" : "browser" },
        () => {},
        testTemplates.filter((value) => value.id === id),
      );
      expect(requests).toHaveLength(2);
      expect(result.status).toBe("passed");
      const [prime, followup] = requests;
      expect(prime.model).toBe("test-model");
      expect(prime.store).toBe(false);
      expect(prime.truncation).toBe("disabled");
      expect(prime.prompt_cache_key.length).toBeGreaterThan(0);
      expect(prime.prompt_cache_key.length).toBeLessThanOrEqual(64);
      expect(followup.model).toBe(prime.model);
      expect(followup.prompt_cache_key).toBe(prime.prompt_cache_key);
      expect(Boolean(prime.stream)).toBe(streaming);
      expect(Boolean(followup.stream)).toBe(streaming);
      expect(prime.input.map((item: any) => item.role)).toEqual([
        "system",
        "user",
        "assistant",
        "user",
      ]);
      expect(prime.input[0].content.length).toBeLessThan(256);
      expect(prime.input[1].content.length).toBeGreaterThan(20000);
      expect(JSON.stringify(followup.input.slice(0, prime.input.length))).toBe(
        JSON.stringify(prime.input),
      );
      expect(
        followup.input.slice(prime.input.length).map((item: any) => item.role),
      ).toEqual([role, "user"]);
      expect(result.request).toEqual({ prime, followup });
      expect(result.response).toMatchObject({
        prime: { usage: { input_tokens_details: { cached_tokens: 0 } } },
        followup: { usage: { input_tokens_details: { cached_tokens: 4096 } } },
      });
      if (streaming) expect(result.streamEvents).toBe(2);
    },
  );

  const invalidFollowups = [
    {
      name: "zero cached tokens",
      body: cacheResponse(0),
      error: "cached_tokens",
    },
    {
      name: "negative cached tokens",
      body: cacheResponse(-1),
      error: "cached_tokens",
    },
    {
      name: "null usage",
      body: cacheResponse(0, { usage: null }),
      error: "usage",
    },
    {
      name: "missing usage",
      body: cacheResponse(0, { usage: undefined }),
      error: "usage",
    },
    {
      name: "missing cache details",
      body: cacheResponse(0, {
        usage: { ...cacheResponse().usage, input_tokens_details: {} },
      }),
      error: "usage",
    },
    {
      name: "string cache count",
      body: cacheResponse(0, {
        usage: {
          ...cacheResponse().usage,
          input_tokens_details: { cached_tokens: "4096" },
        },
      }),
      error: "usage",
    },
    {
      name: "incomplete response",
      body: cacheResponse(4096, { status: "incomplete" }),
      error: "completed",
    },
    {
      name: "empty output",
      body: cacheResponse(4096, { output: [] }),
      error: "output",
    },
  ];

  test.each(
    invalidFollowups.flatMap((value) =>
      [false, true].map((streaming) => ({ ...value, streaming })),
    ),
  )(
    "rejects followup $name (streaming: $streaming)",
    async ({ body, error, streaming }) => {
      let requests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          requests++;
          // A prime hit must never satisfy the followup's cache assertion.
          return cacheWireResponse(
            requests === 1 ? cacheResponse(4096) : body,
            streaming,
          );
        },
      });
      const [result] = await runAllTests(config(server), () => {}, [
        template(
          `mid-conversation-developer-cache${streaming ? "-streaming" : ""}`,
        ),
      ]);
      expect(requests).toBe(2);
      expect(result.status).toBe("failed");
      expect(result.errors?.join("\n")).toContain(`followup:`);
      expect(result.errors?.join("\n")).toContain(error);
      expect(result.response).toHaveProperty("prime");
      expect(result.response).toHaveProperty("followup");
    },
  );

  test.each(["prime", "followup"])(
    "retains evidence for a %s HTTP error",
    async (stage) => {
      let requests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          requests++;
          return stage === "prime" || requests === 2
            ? Response.json(
                { error: { message: "Unsupported request" } },
                { status: 400 },
              )
            : Response.json(cacheResponse());
        },
      });
      const [result] = await runAllTests(config(server), () => {}, [
        template("mid-conversation-developer-cache"),
      ]);
      expect(requests).toBe(stage === "prime" ? 1 : 2);
      expect(result.status).toBe("failed");
      expect(result.errors?.join("\n")).toContain(`${stage}: HTTP 400`);
      expect(result.response).toHaveProperty(
        `${stage}.error.message`,
        "Unsupported request",
      );
      expect(Object.keys(result.request as object)).toHaveLength(requests);
    },
  );

  test.each([
    { name: "invalid schema", body: cacheResponse(0, { id: undefined }) },
    {
      name: "incomplete status",
      body: cacheResponse(0, { status: "incomplete" }),
    },
    { name: "empty output", body: cacheResponse(0, { output: [] }) },
  ])("does not follow a prime with $name", async ({ body }) => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return Response.json(body);
      },
    });
    const [result] = await runAllTests(config(server), () => {}, [
      template("mid-conversation-system-cache"),
    ]);
    expect(result.status).toBe("failed");
    expect(requests).toBe(1);
    expect(result.errors?.join("\n")).toContain("prime:");
    expect(result.request).not.toHaveProperty("followup");
  });

  test.each(
    ["prime", "followup"].flatMap((stage) =>
      ["malformed", "error", "response.failed", "response.incomplete"].map(
        (event) => ({ stage, event }),
      ),
    ),
  )("rejects a $event stream failure in $stage", async ({ stage, event }) => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        const failure = stage === "prime" || requests === 2;
        const errorEvent =
          event === "malformed"
            ? "invalid-json"
            : JSON.stringify({
                type: event,
                sequence_number: 1,
                ...(event === "error"
                  ? {
                      error: {
                        code: "server_error",
                        message: "Stream failed",
                        type: "server_error",
                        param: null,
                      },
                    }
                  : { response: cacheResponse(4096) }),
              });
        if (event === "error")
          expect(
            errorStreamingEventSchema.safeParse(JSON.parse(errorEvent)).success,
          ).toBe(true);
        if (failure && event.startsWith("response.")) {
          // Even a completed body cannot turn a failed terminal event into success.
          return new Response(`data: ${errorEvent}\n\n`, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        return cacheWireResponse(
          cacheResponse(4096),
          true,
          failure ? `data: ${errorEvent}\n\n` : "",
        );
      },
    });
    const [result] = await runAllTests(config(server), () => {}, [
      template("mid-conversation-system-cache-streaming"),
    ]);
    expect(requests).toBe(stage === "prime" ? 1 : 2);
    expect(result.status).toBe("failed");
    expect(result.errors?.join("\n")).toContain(`${stage}:`);
    expect(result.errors?.join("\n")).toContain(
      event === "malformed" ? "Failed to parse event data" : event,
    );
  });

  test("uses terminal usage rather than an earlier streaming hit", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        const created = JSON.stringify({
          type: "response.created",
          sequence_number: 0,
          response: cacheResponse(4096, { status: "in_progress" }),
        });
        const completed = JSON.stringify({
          type: "response.completed",
          sequence_number: 1,
          response: cacheResponse(0),
        });
        return new Response(`data: ${created}\n\ndata: ${completed}\n\n`, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    });
    const [result] = await runAllTests(config(server), () => {}, [
      template("mid-conversation-developer-cache-streaming"),
    ]);
    expect(requests).toBe(2);
    expect(result.status).toBe("failed");
    expect(result.errors?.join("\n")).toContain(
      "followup: Expected usage.input_tokens_details.cached_tokens > 0 but got 0",
    );
  });

  test("isolates concurrent invocations even when the prime already hits cache", async () => {
    const requests: Record<string, any>[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push(await request.json());
        return Response.json(cacheResponse(4096));
      },
    });
    const selected = template("mid-conversation-developer-cache");
    const results = await runAllTests(config(server), () => {}, [
      selected,
      selected,
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
    ]);
    expect(requests).toHaveLength(4);
    const primes = requests.filter((request) => request.input.length === 4);
    expect(
      new Set(primes.map((request) => request.prompt_cache_key)).size,
    ).toBe(2);
    expect(
      new Set(primes.map((request) => request.input[0].content)).size,
    ).toBe(2);
    for (const prime of primes) {
      const pair = requests.filter(
        (request) => request.prompt_cache_key === prime.prompt_cache_key,
      );
      expect(pair).toHaveLength(2);
      expect(pair[1].input[0]).toEqual(prime.input[0]);
    }
  });

  test.each([false, true])(
    "waits for the prime body before following up (streaming: %s)",
    async (streaming) => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let finishIndependent!: () => void;
      const independentFinished = new Promise<void>((resolve) => {
        finishIndependent = resolve;
      });
      let cacheRequests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          if (new URL(request.url).pathname === "/independent")
            return Response.json(responseFixture);
          cacheRequests++;
          if (cacheRequests > 1)
            return cacheWireResponse(cacheResponse(4096), streaming);
          const wire = cacheWireResponse(cacheResponse(), streaming);
          const bytes = new TextEncoder().encode(await wire.text());
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(bytes.slice(0, 10));
                await released;
                controller.enqueue(bytes.slice(10));
                controller.close();
              },
            }),
            { headers: wire.headers },
          );
        },
      });
      const pending = runAllTests(
        { ...config(server), timeoutMs: 1000 },
        (result) => {
          if (result.id === "independent" && result.status === "passed")
            finishIndependent();
        },
        [
          template(
            `mid-conversation-developer-cache${streaming ? "-streaming" : ""}`,
          ),
          { ...httpTemplate, id: "independent", endpoint: "/independent" },
        ],
      );
      try {
        await independentFinished;
        expect(cacheRequests).toBe(1);
      } finally {
        release();
      }
      const results = await pending;
      expect(results.map((result) => result.status)).toEqual([
        "passed",
        "passed",
      ]);
      expect(cacheRequests).toBe(2);
    },
  );

  test.each(
    ["prime", "followup"].flatMap((stage) =>
      [false, true].map((streaming) => ({ stage, streaming })),
    ),
  )(
    "bounds a stalled $stage body without blocking another test (streaming: $streaming)",
    async ({ stage, streaming }) => {
      let requests = 0;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch(request) {
          if (new URL(request.url).pathname === "/independent")
            return Response.json(responseFixture);
          requests++;
          if (stage === "prime" || requests === 2)
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      streaming
                        ? `data: ${JSON.stringify({ type: "response.completed", sequence_number: 0, response: cacheResponse(4096) })}\n\n`
                        : "{",
                    ),
                  );
                },
              }),
              {
                headers: {
                  "Content-Type": streaming
                    ? "text/event-stream"
                    : "application/json",
                },
              },
            );
          return cacheWireResponse(cacheResponse(), streaming);
        },
      });
      const progress: TestResult[] = [];
      const results = await runAllTests(
        config(server),
        (result) => progress.push(result),
        [
          template(
            `mid-conversation-system-cache${streaming ? "-streaming" : ""}`,
          ),
          { ...httpTemplate, id: "independent", endpoint: "/independent" },
        ],
      );
      expect(requests).toBe(stage === "prime" ? 1 : 2);
      expect(results.map((result) => result.status)).toEqual([
        "failed",
        "passed",
      ]);
      expect(results[0].errors?.join("\n")).toContain(`${stage}:`);
      expect(results[0].request).toHaveProperty(stage);
      if (stage === "followup")
        expect(results[0].response).toHaveProperty("prime");
      expect(
        progress.filter(
          (result) =>
            result.id === results[0].id && result.status !== "running",
        ),
      ).toEqual([results[0]]);
    },
    2000,
  );
});

describe("HTTP request deadlines", () => {
  test("a stalled response header fails without blocking another test or terminal progress", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch(request) {
        requests++;
        return new URL(request.url).pathname === "/stall"
          ? new Promise<Response>(() => {})
          : Response.json(responseFixture);
      },
    });
    const progress: TestResult[] = [];
    const results = await runAllTests(
      config(server),
      (result) => progress.push(result),
      [{ ...httpTemplate, id: "stalled", endpoint: "/stall" }, httpTemplate],
    );
    expect(requests).toBe(2);
    expect(results.map((result) => result.status)).toEqual([
      "failed",
      "passed",
    ]);
    expect(results[0].errors?.length).toBeGreaterThan(0);
    expect(progress.filter((result) => result.status !== "running")).toEqual([
      results[1],
      results[0],
    ]);
  }, 2000);

  test.each(["application/json", "text/plain"])(
    "a stalled %s response body is aborted",
    async (contentType) => {
      let cancel!: () => void;
      const cancelled = new Promise<void>((resolve) => {
        cancel = resolve;
      });
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("{"));
              },
              cancel,
            }),
            { headers: { "Content-Type": contentType } },
          );
        },
      });
      const [result] = await runAllTests(config(server), () => {}, [
        httpTemplate,
      ]);
      expect(result.status).toBe("failed");
      expect(result.errors?.length).toBeGreaterThan(0);
      await cancelled;
    },
    2000,
  );

  test("a terminal SSE response that never closes times out", async () => {
    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `event: response.completed\ndata: ${terminalEvent()}\n\n`,
                ),
              );
            },
            cancel,
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    const [result] = await runAllTests(config(server), () => {}, [
      template("streaming-response"),
    ]);
    expect(result.status).toBe("failed");
    expect(result.errors?.length).toBeGreaterThan(0);
    await cancelled;
  }, 2000);

  test("the WebSocket compaction preflight also bounds body consumption", async () => {
    let path: string | undefined;
    let cancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch(request) {
        path = new URL(request.url).pathname;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"output":['));
            },
            cancel,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const [result] = await runAllTests(config(server), () => {}, [
      template("websocket-compact-new-chain"),
    ]);
    expect(path).toBe("/responses/compact");
    expect(result.status).toBe("failed");
    expect(result.errors?.length).toBeGreaterThan(0);
    await cancelled;
  }, 2000);
});

describe("WebSocket request deadlines and cleanup", () => {
  test("a stalled handshake fails", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch() {
        requests++;
        return new Promise<Response>(() => {});
      },
    });
    const [result] = await runAllTests(config(server), () => {}, [
      template("websocket-response"),
    ]);
    expect(requests).toBe(1);
    expect(result.status).toBe("failed");
    expect(result.errors?.length).toBeGreaterThan(0);
  }, 2000);

  test.each(["stall", "disconnect", "complete"] as const)(
    "handles %s during the second turn and closes the socket",
    async (behavior) => {
      let messages = 0;
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        idleTimeout: 0,
        fetch(request, server) {
          if (server.upgrade(request)) return;
          return new Response(null, { status: 400 });
        },
        websocket: {
          message(ws) {
            messages++;
            if (messages === 1 || behavior === "complete")
              ws.send(terminalEvent());
            else if (behavior === "disconnect") ws.close();
          },
          close,
        },
      });
      const [result] = await runAllTests(config(server), () => {}, [
        template("websocket-sequential-responses"),
      ]);
      expect(messages).toBe(2);
      expect(result.status).toBe(behavior === "complete" ? "passed" : "failed");
      if (behavior !== "complete")
        expect(result.errors?.length).toBeGreaterThan(0);
      await closed;
    },
    2000,
  );
});

test("template setup and custom runner failures each report a terminal result", async () => {
  const failures: TestTemplate[] = [
    {
      ...httpTemplate,
      id: "setup",
      getRequest() {
        throw new Error("setup failed");
      },
    },
    {
      ...httpTemplate,
      id: "run",
      async run() {
        throw new Error("runner failed");
      },
    },
    {
      ...httpTemplate,
      id: "support",
      unsupportedReason() {
        throw new Error("support check failed");
      },
    },
  ];
  const progress: TestResult[] = [];
  const results = await runAllTests(
    {
      baseUrl: "http://127.0.0.1:1",
      apiKey: "",
      authHeaderName: "Authorization",
      useBearerPrefix: true,
      model: "test-model",
    },
    (result) => progress.push(result),
    failures,
  );
  expect(results.map((result) => result.status)).toEqual([
    "failed",
    "failed",
    "failed",
  ]);
  for (const result of results) {
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(
      progress.filter(
        (entry) => entry.id === result.id && entry.status === "failed",
      ),
    ).toEqual([result]);
  }
});
