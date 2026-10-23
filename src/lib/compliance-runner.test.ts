import { afterEach, describe, expect, test } from "bun:test";
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

function steeringServer(
  onSteer: (
    send: (event: unknown) => void,
    request: Record<string, unknown>,
    initial: typeof responseFixture,
    close: () => void,
  ) => void,
  onContinuation?: (
    send: (event: unknown) => void,
    request: Record<string, unknown>,
    initial: typeof responseFixture,
  ) => void,
  streamId?: string,
) {
  const requests: Record<string, unknown>[] = [];
  let closed!: () => void;
  const didClose = new Promise<void>((resolve) => {
    closed = resolve;
  });
  let initial = { ...responseFixture, id: "resp_initial" };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      message(ws, message) {
        const request = JSON.parse(String(message));
        requests.push(request);
        const send = (event: unknown) => ws.send(JSON.stringify(event));
        if (requests.length === 1 && request.type === "response.create") {
          initial = {
            ...initial,
            ...Object.fromEntries(
              Object.keys(responseFixture)
                .filter((key) => key in request)
                .map((key) => [key, request[key]]),
            ),
          };
          send({
            type: "response.created",
            sequence_number: 0,
            ...(streamId ? { stream_id: streamId } : {}),
            response: { ...initial, status: "in_progress", completed_at: null },
          });
        } else if (request.type === "response.steer") {
          onSteer(send, request, initial, () => ws.close());
        } else {
          onContinuation?.(send, request, initial);
        }
      },
      close: closed,
    },
  });
  return { server, requests, didClose };
}

const acceptedSteer = {
  type: "response.steer.accepted",
  sequence_number: 1,
  steer: { id: "steer_test", previous_response_id: "resp_initial" },
};

function finishSteering(
  send: (event: unknown) => void,
  initial: typeof responseFixture,
  overrides: Record<string, unknown> = {},
) {
  const successor = {
    ...initial,
    id: "resp_successor",
    previous_response_id: initial.id,
    output: [
      {
        type: "message",
        id: "msg_successor",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "openresponses-steering-applied",
            annotations: [],
          },
        ],
      },
    ],
    ...overrides,
  };
  send({
    type: "response.created",
    sequence_number: 3,
    response: { ...successor, status: "in_progress", completed_at: null },
  });
  send({
    type: "response.completed",
    sequence_number: 4,
    response: successor,
  });
}

describe("WebSocket steering compliance", () => {
  test.each(["incomplete", "completed"] as const)(
    "follows the correlated successor after the original response is %s",
    async (status) => {
      const fixture = steeringServer(
        (send, request, initial) => {
          expect(request.previous_response_id).toBe(initial.id);
          expect(request).not.toHaveProperty("stream_id");
          send({
            type: "response.steer.failed",
            steer: {
              previous_response_id: initial.id,
              input: "Another submission",
            },
          });
          send({
            ...acceptedSteer,
            steer: {
              id: "steer_unrelated",
              previous_response_id: "resp_other",
            },
          });
          send(acceptedSteer);
          send({
            type: "response.completed",
            stream_id: "lane_other",
            sequence_number: "invalid unrelated frame",
            response: initial,
          });
          for (const type of [
            "response.steer.pending",
            "response.steer.failed",
          ]) {
            send({
              type,
              steer: { id: "steer_other", previous_response_id: initial.id },
            });
          }
          send({
            type: `response.${status}`,
            sequence_number: 2,
            response: {
              ...initial,
              status,
              incomplete_details:
                status === "incomplete" ? { reason: "steered" } : null,
            },
          });
          finishSteering(send, initial, {
            id: "resp_unrelated",
            previous_response_id: "resp_other",
          });
          send({
            type: "response.output_text.delta",
            response_id: "resp_other",
            sequence_number: "invalid unrelated frame",
          });
          finishSteering(send, initial);
        },
        undefined,
        "lane_primary",
      );
      const [result] = await runAllTests(config(fixture.server), () => {}, [
        template("websocket-steering"),
      ]);
      expect(result.errors).toEqual([]);
      expect(result.status).toBe("passed");
      expect(fixture.requests.map((request) => request.type)).toEqual([
        "response.create",
        "response.steer",
      ]);
      expect(result.response).toMatchObject({
        initial: { id: "resp_initial", status },
        successor: { id: "resp_successor", status: "completed" },
      });
      await fixture.didClose;
    },
    2000,
  );

  test.each([
    "wrong-final-parent",
    "failed-envelope",
    "overlapping-successors",
    "conflicting-response-identities",
    "duplicate-original-terminal",
  ] as const)(
    "rejects %s instead of reporting a successful steering continuation",
    async (behavior) => {
      const fixture = steeringServer((send, _request, initial) => {
        send(acceptedSteer);
        send({
          type: "response.completed",
          sequence_number: 2,
          response: initial,
        });
        if (behavior === "duplicate-original-terminal") {
          send({
            type: "response.completed",
            sequence_number: 3,
            response: { ...initial, instructions: "Replaced settings" },
          });
        }
        if (behavior === "overlapping-successors") {
          send({
            type: "response.created",
            sequence_number: 3,
            response: {
              ...initial,
              id: "resp_abandoned",
              previous_response_id: initial.id,
              status: "in_progress",
              completed_at: null,
            },
          });
        }
        finishSteering(
          (event) => {
            const data = event as {
              type: string;
              response: Record<string, unknown>;
            };
            if (data.type === "response.completed") {
              if (behavior === "wrong-final-parent")
                data.response.previous_response_id = "resp_other";
              if (behavior === "failed-envelope") data.type = "response.failed";
              if (behavior === "conflicting-response-identities")
                Object.assign(data, { response_id: "resp_other" });
            }
            send(data);
          },
          initial,
          behavior === "duplicate-original-terminal"
            ? { instructions: "Replaced settings" }
            : {},
        );
      });
      const [result] = await runAllTests(config(fixture.server), () => {}, [
        template("websocket-steering"),
      ]);
      expect(result.status).toBe("failed");
      expect(result.errors?.length).toBeGreaterThan(0);
      await fixture.didClose;
    },
    2000,
  );

  test("compares inherited settings structurally when object keys change order", async () => {
    const fixture = steeringServer((send, _request, initial) => {
      send(acceptedSteer);
      send({
        type: "response.completed",
        sequence_number: 2,
        response: initial,
      });
      finishSteering(send, initial, {
        metadata: { second: "two", first: "one" },
      });
    });
    const steering = template("websocket-steering");
    const [result] = await runAllTests(config(fixture.server), () => {}, [
      {
        ...steering,
        getRequest: (value) => ({
          ...steering.getRequest(value),
          metadata: { first: "one", second: "two" },
        }),
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("passed");
    await fixture.didClose;
  }, 2000);

  test.each([
    "accepted-only",
    "progress-without-successor",
    "closed",
    "unchanged-output",
    "changed-settings",
    "failed",
    "unsupported",
    "malformed-acceptance",
  ] as const)(
    "fails and closes the connection for %s steering",
    async (behavior) => {
      const fixture = steeringServer((send, request, initial, close) => {
        if (behavior === "closed") {
          close();
          return;
        }
        if (behavior === "malformed-acceptance") {
          send({
            ...acceptedSteer,
            steer: { previous_response_id: initial.id },
          });
          finishSteering(send, initial);
          return;
        }
        send(acceptedSteer);
        if (behavior === "failed" || behavior === "unsupported") {
          send({
            type: "response.steer.failed",
            sequence_number: 2,
            steer: { ...acceptedSteer.steer, input: request.input },
            error: {
              type: "invalid_request_error",
              code:
                behavior === "failed"
                  ? "successor_creation_failed"
                  : "steering_not_supported",
              message: "The update could not be applied.",
            },
          });
          return;
        }
        send({
          type: "response.completed",
          sequence_number: 2,
          response: initial,
        });
        if (behavior === "accepted-only") return;
        if (behavior === "progress-without-successor") {
          const timer = setInterval(
            () =>
              send({
                type: "response.in_progress",
                sequence_number: 3,
                response: {
                  ...initial,
                  status: "in_progress",
                  completed_at: null,
                },
              }),
            10,
          );
          void fixture.didClose.then(() => clearInterval(timer));
          return;
        }
        finishSteering(
          send,
          initial,
          behavior === "unchanged-output"
            ? { output: [] }
            : { instructions: "The original settings were lost." },
        );
      });
      const [result] = await runAllTests(config(fixture.server), () => {}, [
        template("websocket-steering"),
      ]);
      expect(result.status).toBe("failed");
      expect(result.errors?.length).toBeGreaterThan(0);
      if (
        behavior === "accepted-only" ||
        behavior === "progress-without-successor"
      ) {
        expect(result.errors?.join("\n")).toContain("Timed out");
      }
      if (behavior === "failed" || behavior === "unsupported") {
        expect(result.errors?.join("\n")).toContain(
          behavior === "failed"
            ? "successor_creation_failed"
            : "steering_not_supported",
        );
      }
      await fixture.didClose;
    },
    2000,
  );

  test.each(["automatic", "tool-output"] as const)(
    "applies a separate deadline to the %s continuation",
    async (mode) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      const finishLater = (
        send: (event: unknown) => void,
        initial: typeof responseFixture,
        overrides = {},
      ) => {
        finishSteering(
          (event) => {
            if ((event as { type: string }).type === "response.completed") {
              timers.push(setTimeout(() => send(event), 120));
            } else {
              send(event);
            }
          },
          initial,
          overrides,
        );
      };
      const fixture = steeringServer(
        (send, _request, initial) => {
          send(acceptedSteer);
          send({
            type: "response.completed",
            sequence_number: 2,
            response: {
              ...initial,
              ...(mode === "tool-output"
                ? {
                    output: [
                      {
                        type: "function_call",
                        id: "fc_test",
                        call_id: "call_test",
                        name: "get_project_status",
                        arguments: "{}",
                        status: "completed",
                      },
                    ],
                  }
                : {}),
            },
          });
          timers.push(
            setTimeout(() => {
              if (mode === "automatic") {
                finishLater(send, initial);
              } else {
                send({
                  type: "response.steer.pending",
                  sequence_number: 3,
                  steer: acceptedSteer.steer,
                  reason: "waiting_for_required_input",
                  required_input: [
                    {
                      type: "function_call_output",
                      call_id: "call_test",
                      name: "get_project_status",
                    },
                  ],
                });
              }
            }, 120),
          );
        },
        (send, request, initial) =>
          finishLater(send, initial, {
            instructions: request.instructions,
            tools: request.tools,
            tool_choice: request.tool_choice,
          }),
      );
      try {
        const [result] = await runAllTests(
          { ...config(fixture.server), timeoutMs: 200 },
          () => {},
          [
            template(
              mode === "automatic"
                ? "websocket-steering"
                : "websocket-steering-tool-output",
            ),
          ],
        );
        expect(result.errors).toEqual([]);
        expect(result.status).toBe("passed");
        await fixture.didClose;
      } finally {
        for (const timer of timers) clearTimeout(timer);
      }
    },
    2000,
  );

  test.each([
    "complete",
    "duplicate-requirement",
    "unknown-call",
    "missing-call",
    "wrong-steer-id",
    "changed-explicit-settings",
  ] as const)(
    "handles %s pending function results without replaying accepted steering",
    async (behavior) => {
      const calls = ["first", "second"].map((id) => ({
        type: "function_call",
        id: `fc_${id}`,
        call_id: `call_${id}`,
        name: "get_project_status",
        arguments: "{}",
        status: "completed",
      }));
      const requiredInput = calls.map((call) => ({
        type: "function_call_output",
        call_id: call.call_id,
        name: call.name,
      }));
      if (behavior === "duplicate-requirement")
        requiredInput[1] = requiredInput[0];
      if (behavior === "unknown-call")
        requiredInput[1] = { ...requiredInput[1], call_id: "call_unknown" };
      if (behavior === "missing-call") requiredInput.pop();
      const fixture = steeringServer(
        (send, _request, initial) => {
          send(acceptedSteer);
          send({
            type: "response.completed",
            sequence_number: 2,
            response: {
              ...initial,
              output: calls,
            },
          });
          send({
            type: "response.steer.pending",
            sequence_number: 3,
            steer:
              behavior === "wrong-steer-id"
                ? { ...acceptedSteer.steer, id: "steer_other" }
                : acceptedSteer.steer,
            reason: "waiting_for_required_input",
            required_input: requiredInput,
          });
        },
        (send, request, initial) => {
          finishSteering(send, initial, {
            instructions:
              behavior === "changed-explicit-settings"
                ? initial.instructions
                : request.instructions,
            tools: request.tools,
            tool_choice: request.tool_choice,
          });
        },
      );
      const [result] = await runAllTests(config(fixture.server), () => {}, [
        template("websocket-steering-tool-output"),
      ]);
      expect(result.status).toBe(behavior === "complete" ? "passed" : "failed");
      if (behavior === "complete") {
        expect(result.errors).toEqual([]);
        expect(fixture.requests.map((request) => request.type)).toEqual([
          "response.create",
          "response.steer",
          "response.create",
        ]);
        expect(fixture.requests[2]).toMatchObject({
          previous_response_id: "resp_initial",
          input: calls.map((call) => ({
            type: "function_call_output",
            call_id: call.call_id,
          })),
        });
        expect(JSON.stringify(fixture.requests[2].input)).not.toContain(
          "openresponses-steering-applied",
        );
      } else {
        expect(result.errors?.length).toBeGreaterThan(0);
        if (behavior !== "changed-explicit-settings") {
          expect(fixture.requests.map((request) => request.type)).toEqual([
            "response.create",
            "response.steer",
          ]);
        }
      }
      await fixture.didClose;
    },
    2000,
  );

  test.each([
    {
      id: "websocket-steering-invalid-target",
      code: "response_not_found",
      matches: true,
    },
    {
      id: "websocket-steering-invalid-input",
      code: "invalid_input",
      matches: true,
    },
    {
      id: "websocket-steering-invalid-target",
      code: "response_not_found",
      matches: false,
    },
    {
      id: "websocket-steering-invalid-input",
      code: "invalid_input",
      matches: false,
    },
  ] as const)(
    "validates $id ($code), matching input: $matches",
    async ({ id, code, matches }) => {
      const fixture = steeringServer((send, request) => {
        send({
          type: "response.steer.failed",
          sequence_number: 1,
          steer: {
            previous_response_id: request.previous_response_id,
            input: matches ? request.input : "Another submission",
          },
          error: {
            type: "invalid_request_error",
            code,
            message: "The submission was rejected.",
          },
        });
      });
      const [result] = await runAllTests(config(fixture.server), () => {}, [
        template(id),
      ]);
      expect(result.status).toBe(matches ? "passed" : "failed");
      if (matches) expect(result.errors).toEqual([]);
      else expect(result.errors?.join("\n")).toContain("Timed out");
      expect(fixture.requests.at(-1)?.type).toBe("response.steer");
      await fixture.didClose;
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
