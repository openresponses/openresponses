import { describe, expect, it } from "bun:test";
import { responseFixture } from "./compliance-test-fixtures";
import { parseSSEStream, parseStreamingEventData } from "./sse-parser";

const encoder = new TextEncoder();
const delta = {
  type: "response.output_text.delta",
  sequence_number: 0,
  item_id: "msg_test",
  output_index: 0,
  content_index: 0,
  delta: "héllo 🌍",
};
const terminal = {
  type: "response.completed",
  sequence_number: 1,
  response: responseFixture,
};
const frame = (event: typeof delta | typeof terminal) =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const completeStream = frame(delta) + frame(terminal) + "data: [DONE]\n\n";

it.each([
  {
    type: "response.steer.accepted",
    sequence_number: 1,
    steer: { id: "steer_test", previous_response_id: "resp_test" },
  },
  {
    type: "response.steer.pending",
    sequence_number: 2,
    steer: { id: "steer_test", previous_response_id: "resp_test" },
    reason: "waiting_for_required_input",
    required_input: [
      { type: "function_call_output", call_id: "call_test", name: "lookup" },
    ],
  },
  {
    type: "response.steer.failed",
    sequence_number: 3,
    steer: {
      id: "steer_test",
      previous_response_id: "resp_test",
      input: "Change direction.",
    },
    error: {
      type: "invalid_request_error",
      code: "successor_creation_failed",
      message: "The update could not be applied.",
    },
  },
])("accepts $type only over WebSocket", (event) => {
  expect(
    parseStreamingEventData(event, undefined, { transport: "websocket" })
      .validationResult.success,
  ).toBe(true);
  expect(parseStreamingEventData(event).validationResult.success).toBe(false);
});

function chunkedResponse(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    }),
  );
}

async function parse(text: string) {
  return parseSSEStream(chunkedResponse([encoder.encode(text)]));
}

describe("SSE response parsing", () => {
  it("preserves events and UTF-8 at every byte boundary with each line ending", async () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const bytes = encoder.encode(completeStream.replaceAll("\n", newline));
      for (let offset = 1; offset < bytes.length; offset++) {
        const result = await parseSSEStream(
          chunkedResponse([bytes.slice(0, offset), bytes.slice(offset)]),
        );
        expect(result.errors).toEqual([]);
        expect(result.events.map((event) => event.data)).toEqual([
          delta,
          terminal,
        ]);
        expect(result.events.map((event) => event.event)).toEqual([
          delta.type,
          terminal.type,
        ]);
        expect(result.finalResponse).toEqual(responseFixture);
      }
      const bytewise = await parseSSEStream(
        chunkedResponse(Array.from(bytes, (byte) => Uint8Array.of(byte))),
      );
      expect(bytewise.errors).toEqual([]);
      expect(bytewise.events.map((event) => event.data)).toEqual([
        delta,
        terminal,
      ]);
    }
  });

  it("joins multiline data and ignores comments and unrelated SSE fields", async () => {
    const lines = JSON.stringify(delta, null, 2)
      .split("\n")
      .map((line) => `data: ${line}`)
      .join("\n");
    const result = await parse(
      `\uFEFF: heartbeat\nid: ignored\nretry: 1000\nevent: overwritten\nevent: explicit-wire-name\n${lines}\n\n` +
        frame(terminal) +
        "data:[DONE]\n\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.events[0].event).toBe("explicit-wire-name");
    expect(result.events.map((event) => event.data)).toEqual([delta, terminal]);
  });

  it("reports malformed JSON and invalid event schemas without losing later events", async () => {
    for (const malformed of [
      "",
      '{"type":',
      JSON.stringify({ ...delta, sequence_number: "bad" }),
    ]) {
      const result = await parse(`data: ${malformed}\n\n` + completeStream);
      expect(result.errors).toHaveLength(1);
      expect(result.events.slice(-2).map((event) => event.data)).toEqual([
        delta,
        terminal,
      ]);
      expect(result.finalResponse).toEqual(responseFixture);
    }
  });

  it("accepts each terminal response with or without DONE", async () => {
    for (const status of ["completed", "failed", "incomplete"]) {
      const event = {
        type: `response.${status}`,
        sequence_number: 1,
        response: { ...responseFixture, status },
      };
      const terminalFrame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const suffix of ["", "data: [DONE]\n\n", ": connection closed"]) {
        const result = await parse(terminalFrame + suffix);
        expect(result.errors).toEqual([]);
        expect(result.events.map((entry) => entry.data)).toEqual([event]);
        expect(result.finalResponse).toEqual(event.response);
      }
    }
  });

  it("fails streams missing their terminal response or ending mid-event", async () => {
    for (const text of [
      "",
      frame(delta),
      frame(terminal).slice(0, -1),
      "data: [DONE]\n\n",
      completeStream.slice(0, -1),
      frame(terminal) + 'data: {"type":',
      frame(terminal) + "event: response.output_text.delta\n",
    ]) {
      const result = await parse(text);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("finishes at DONE and cancels an open body with any line ending", async () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      let cancelled = false;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              (completeStream + "data: not-json\n\n").replaceAll("\n", newline),
            ),
          );
        },
        cancel() {
          cancelled = true;
        },
      });
      const result = await parseSSEStream(new Response(body));
      expect(result.errors).toEqual([]);
      expect(result.finalResponse).toEqual(responseFixture);
      expect(cancelled).toBe(true);
      expect(body.locked).toBe(false);
    }
  });

  it("preserves parsed events and releases the reader when the transport fails", async () => {
    let reads = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(encoder.encode(frame(delta)));
        else controller.error(new Error("connection reset"));
      },
    });
    const result = await parseSSEStream(new Response(body));
    expect(result.errors).toHaveLength(1);
    expect(result.events.map((event) => event.data)).toEqual([delta]);
    expect(body.locked).toBe(false);
  });
});
