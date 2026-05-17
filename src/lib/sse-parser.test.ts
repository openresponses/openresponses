import { describe, expect, it } from "bun:test";
import { parseSSEStream } from "./sse-parser";

const encoder = new TextEncoder();

function streamResponse(...chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );
}

const textDeltaEvent = (delta: string) => ({
  type: "response.output_text.delta",
  sequence_number: 1,
  item_id: "item_1",
  output_index: 0,
  content_index: 0,
  delta,
});

describe("parseSSEStream", () => {
  it("concatenates multi-line SSE data fields before parsing", async () => {
    const response = streamResponse(
      [
        "event: response.output_text.delta",
        'data: {"type":"response.output_text.delta",',
        'data: "sequence_number":1,"item_id":"item_1",',
        'data: "output_index":0,"content_index":0,"delta":"hello"}',
        "",
        "",
      ].join("\n"),
    );

    const result = await parseSSEStream(response);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data).toEqual(textDeltaEvent("hello"));
  });

  it("dispatches the final event when the stream closes without a blank line", async () => {
    const response = streamResponse(
      [
        "event: response.output_text.delta",
        `data: ${JSON.stringify(textDeltaEvent("tail"))}`,
      ].join("\n"),
    );

    const result = await parseSSEStream(response);

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data).toEqual(textDeltaEvent("tail"));
  });
});
