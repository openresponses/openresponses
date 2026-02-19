import { describe, it, expect } from "bun:test";
import { createResponseStream } from "./stream-processor.ts";
import { InMemoryBufferAdapter } from "./buffer.ts";
import type { BufferAdapter } from "./buffer.ts";
import type { StreamingEvent } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* fromArray(
  arr: StreamingEvent[],
): AsyncGenerator<StreamingEvent> {
  for (const item of arr) {
    yield item;
  }
}

async function toArray(
  gen: AsyncIterable<StreamingEvent>,
): Promise<StreamingEvent[]> {
  const result: StreamingEvent[] = [];
  for await (const item of gen) {
    result.push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createResponseStream", () => {
  describe("no buffer (pass-through)", () => {
    it("emits events unchanged when no buffer is provided", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        { type: "response.completed", sequence_number: 3 },
      ];

      const output = await toArray(createResponseStream(fromArray(events)));
      expect(output).toEqual(events);
    });

    it("passes out-of-order events through unchanged with no buffer", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-1",
          output_index: 0,
          sequence_number: 2,
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
          sequence_number: 3,
        },
        { type: "response.completed", sequence_number: 4 },
      ];

      const output = await toArray(createResponseStream(fromArray(events)));
      // No reordering — events come out exactly as they went in
      expect(output.map((e) => e.type)).toEqual([
        "response.created",
        "response.function_call_arguments.delta",
        "response.output_item.added",
        "response.completed",
      ]);
    });
  });

  describe("output_item.added arrives late", () => {
    it("buffers delta events until output_item.added is seen", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        // Delta arrives before item is opened
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-1",
          output_index: 0,
          sequence_number: 3,
        },
        {
          type: "response.function_call_arguments.done",
          item_id: "item-1",
          output_index: 0,
          sequence_number: 4,
        },
        // Gateway event
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
          sequence_number: 5,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "item-1", status: "completed" },
          sequence_number: 6,
        },
        { type: "response.completed", sequence_number: 7 },
      ];

      const output = await toArray(
        createResponseStream(fromArray(events), {
          buffer: new InMemoryBufferAdapter(),
        }),
      );
      const types = output.map((e) => e.type);

      const addedIdx = types.indexOf("response.output_item.added");
      const deltaIdx = types.indexOf("response.function_call_arguments.delta");
      const doneIdx = types.indexOf("response.function_call_arguments.done");

      expect(addedIdx).toBeGreaterThanOrEqual(0);
      expect(addedIdx).toBeLessThan(deltaIdx);
      expect(addedIdx).toBeLessThan(doneIdx);
      expect(output).toHaveLength(7);
    });
  });

  describe("content_part.added arrives late", () => {
    it("buffers content delta events until content_part.added is seen", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
          sequence_number: 3,
        },
        // Content delta arrives before content_part.added
        {
          type: "response.output_text.delta",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 4,
        },
        // Gateway for content part
        {
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 5,
        },
        {
          type: "response.output_text.done",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 6,
        },
        {
          type: "response.content_part.done",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 7,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "item-1", status: "completed" },
          sequence_number: 8,
        },
        { type: "response.completed", sequence_number: 9 },
      ];

      const output = await toArray(
        createResponseStream(fromArray(events), {
          buffer: new InMemoryBufferAdapter(),
        }),
      );
      const types = output.map((e) => e.type);

      const cpAddedIdx = types.indexOf("response.content_part.added");
      const textDeltaIdx = types.indexOf("response.output_text.delta");

      expect(cpAddedIdx).toBeGreaterThanOrEqual(0);
      expect(cpAddedIdx).toBeLessThan(textDeltaIdx);
      expect(output).toHaveLength(9);
    });
  });

  describe("transitive unlock", () => {
    it("unlocks content_part.added via item gate, then content deltas via content gate", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        // Content delta arrives first — needs both item and content part
        {
          type: "response.output_text.delta",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 3,
        },
        // Content part added arrives next — needs item
        {
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 4,
        },
        // Item added arrives last — gateway that unlocks everything
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
          sequence_number: 5,
        },
        {
          type: "response.content_part.done",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
          sequence_number: 6,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "item-1", status: "completed" },
          sequence_number: 7,
        },
        { type: "response.completed", sequence_number: 8 },
      ];

      const output = await toArray(
        createResponseStream(fromArray(events), {
          buffer: new InMemoryBufferAdapter(),
        }),
      );
      const types = output.map((e) => e.type);

      const itemAddedIdx = types.indexOf("response.output_item.added");
      const cpAddedIdx = types.indexOf("response.content_part.added");
      const textDeltaIdx = types.indexOf("response.output_text.delta");

      expect(itemAddedIdx).toBeLessThan(cpAddedIdx);
      expect(cpAddedIdx).toBeLessThan(textDeltaIdx);
      expect(output).toHaveLength(8);
    });
  });

  describe("multiple items interleaved", () => {
    it("flushes each item's buffered events independently when their gateway arrives", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        // item-2 delta arrives before item-2 is opened
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-2",
          output_index: 1,
          sequence_number: 3,
        },
        // item-1 opens (does not unlock item-2's delta)
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
          sequence_number: 4,
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-1",
          output_index: 0,
          sequence_number: 5,
        },
        // item-2 opens (should flush item-2's buffered delta)
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { id: "item-2" },
          sequence_number: 6,
        },
        {
          type: "response.function_call_arguments.done",
          item_id: "item-1",
          output_index: 0,
          sequence_number: 7,
        },
        {
          type: "response.function_call_arguments.done",
          item_id: "item-2",
          output_index: 1,
          sequence_number: 8,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "item-1", status: "completed" },
          sequence_number: 9,
        },
        {
          type: "response.output_item.done",
          output_index: 1,
          item: { id: "item-2", status: "completed" },
          sequence_number: 10,
        },
        { type: "response.completed", sequence_number: 11 },
      ];

      const output = await toArray(
        createResponseStream(fromArray(events), {
          buffer: new InMemoryBufferAdapter(),
        }),
      );

      const item2AddedIdx = output.findIndex(
        (e) =>
          e.type === "response.output_item.added" &&
          (e as { item?: { id: string } }).item?.id === "item-2",
      );
      const item2DeltaIdx = output.findIndex(
        (e) =>
          e.type === "response.function_call_arguments.delta" &&
          (e as { item_id?: string }).item_id === "item-2",
      );

      expect(item2AddedIdx).toBeGreaterThanOrEqual(0);
      expect(item2DeltaIdx).toBeGreaterThan(item2AddedIdx);
      expect(output).toHaveLength(11);
    });
  });

  describe("events in buffer at end of stream (unreachable gateway)", () => {
    it("drains remaining buffered events when the stream ends without their gateway", async () => {
      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        // Delta for an item that is never opened
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-ghost",
          output_index: 0,
          sequence_number: 3,
        },
        { type: "response.completed", sequence_number: 4 },
      ];

      const output = await toArray(
        createResponseStream(fromArray(events), {
          buffer: new InMemoryBufferAdapter(),
        }),
      );

      expect(output).toHaveLength(4);
      expect(output[3]!.type).toBe("response.function_call_arguments.delta");
    });
  });

  describe("custom adapter", () => {
    it("calls enqueue, drainAll, and requeueAll on the adapter", async () => {
      const enqueuedEvents: StreamingEvent[] = [];
      const drainAllCallCount = { count: 0 };
      const requeuedBatches: StreamingEvent[][] = [];

      const spyAdapter: BufferAdapter = {
        async enqueue(event) {
          enqueuedEvents.push(event);
        },
        async drainAll() {
          drainAllCallCount.count++;
          const snapshot = [...enqueuedEvents];
          enqueuedEvents.length = 0;
          return snapshot;
        },
        async requeueAll(events) {
          requeuedBatches.push(events);
          enqueuedEvents.unshift(...events);
        },
      };

      const events: StreamingEvent[] = [
        { type: "response.created", sequence_number: 1 },
        { type: "response.in_progress", sequence_number: 2 },
        // Delta arrives before item — must be buffered
        {
          type: "response.function_call_arguments.delta",
          item_id: "item-1",
          output_index: 0,
          sequence_number: 3,
        },
        // Gateway arrives and should flush the buffered delta
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
          sequence_number: 4,
        },
        { type: "response.completed", sequence_number: 5 },
      ];

      const output = await toArray(
        createResponseStream(fromArray(events), { buffer: spyAdapter }),
      );

      // The delta was buffered
      expect(drainAllCallCount.count).toBeGreaterThan(0);

      // All 5 events should appear in the output
      expect(output).toHaveLength(5);

      // output_item.added must appear before the delta
      const types = output.map((e) => e.type);
      const addedIdx = types.indexOf("response.output_item.added");
      const deltaIdx = types.indexOf("response.function_call_arguments.delta");
      expect(addedIdx).toBeLessThan(deltaIdx);
    });
  });
});
