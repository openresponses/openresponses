import { describe, it, expect, beforeEach } from "bun:test";
import { ResponseStreamValidator } from "./validator.ts";
import type { StreamingEvent } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers to build minimal valid streaming events
// ---------------------------------------------------------------------------
let seq = 0;
function nextSeq() {
  return ++seq;
}

function resetSeq() {
  seq = 0;
}

function ev<T extends Partial<StreamingEvent> & { type: string }>(
  fields: T,
): T & { sequence_number: number } {
  return { sequence_number: nextSeq(), ...fields } as T & {
    sequence_number: number;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResponseStreamValidator", () => {
  // Reset sequence counter before each test group
  beforeEach(() => resetSeq());

  describe("happy path", () => {
    it("passes a valid end-to-end stream with no violations", () => {
      const v = new ResponseStreamValidator();

      const results = [
        v.send(ev({ type: "response.created" })),
        v.send(ev({ type: "response.in_progress" })),
        v.send(
          ev({
            type: "response.output_item.added",
            output_index: 0,
            item: { id: "item-1" },
          }),
        ),
        v.send(
          ev({
            type: "response.content_part.added",
            item_id: "item-1",
            output_index: 0,
            content_index: 0,
          }),
        ),
        v.send(
          ev({
            type: "response.output_text.delta",
            item_id: "item-1",
            output_index: 0,
            content_index: 0,
          }),
        ),
        v.send(
          ev({
            type: "response.output_text.done",
            item_id: "item-1",
            output_index: 0,
            content_index: 0,
          }),
        ),
        v.send(
          ev({
            type: "response.content_part.done",
            item_id: "item-1",
            output_index: 0,
            content_index: 0,
          }),
        ),
        v.send(
          ev({
            type: "response.output_item.done",
            output_index: 0,
            item: { id: "item-1", status: "completed" },
          }),
        ),
        v.send(ev({ type: "response.completed" })),
      ];

      for (const r of results) {
        expect(r.valid).toBe(true);
        expect(r.violations).toHaveLength(0);
      }

      const final = v.finalize();
      expect(final.valid).toBe(true);
      expect(final.violations).toHaveLength(0);
    });
  });

  describe("response FSM violations", () => {
    it("rejects response.completed before response.in_progress", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.created" }));
      const r = v.send(ev({ type: "response.completed" }));
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("INVALID_RESPONSE_TRANSITION");
    });

    it("allows response.failed as the first response event", () => {
      const v = new ResponseStreamValidator();
      const r = v.send(ev({ type: "response.failed" }));
      expect(r.valid).toBe(true);
      expect(r.violations).toHaveLength(0);
    });

    it("rejects an event after a terminal response state", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(ev({ type: "response.completed" }));
      const r = v.send(ev({ type: "response.completed" }));
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("INVALID_RESPONSE_TRANSITION");
    });
  });

  describe("item FSM violations", () => {
    it("rejects a delta event before output_item.added (UNKNOWN_ITEM)", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      const r = v.send(
        ev({
          type: "response.function_call_arguments.delta",
          item_id: "missing-item",
          output_index: 0,
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("UNKNOWN_ITEM");
    });

    it("rejects a duplicate output_item.added (DUPLICATE_ITEM)", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      const r = v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("DUPLICATE_ITEM");
    });

    it("rejects output_item.done for an unknown item", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      const r = v.send(
        ev({
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "ghost-item", status: "completed" },
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("UNKNOWN_ITEM");
    });
  });

  describe("content-part FSM violations", () => {
    it("rejects a delta before content_part.added (UNKNOWN_CONTENT_PART)", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      const r = v.send(
        ev({
          type: "response.output_text.delta",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("UNKNOWN_CONTENT_PART");
    });

    it("rejects a delta after content_part.done", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      v.send(
        ev({
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      v.send(
        ev({
          type: "response.content_part.done",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      const r = v.send(
        ev({
          type: "response.output_text.delta",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("INVALID_CONTENT_PART_TRANSITION");
    });

    it("rejects a duplicate content_part.added (DUPLICATE_CONTENT_PART)", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      v.send(
        ev({
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      const r = v.send(
        ev({
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("DUPLICATE_CONTENT_PART");
    });
  });

  describe("sequence number validation", () => {
    it("rejects a non-monotonic sequence number (NON_MONOTONIC_SEQUENCE)", () => {
      const v = new ResponseStreamValidator();
      // Use explicit sequence numbers to control order
      v.send({
        type: "response.created",
        sequence_number: 1,
      } as StreamingEvent);
      v.send({
        type: "response.in_progress",
        sequence_number: 5,
      } as StreamingEvent);
      const r = v.send({
        type: "response.completed",
        sequence_number: 3,
      } as StreamingEvent);
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("NON_MONOTONIC_SEQUENCE");
    });

    it("rejects an equal sequence number (NON_MONOTONIC_SEQUENCE)", () => {
      const v = new ResponseStreamValidator();
      v.send({
        type: "response.created",
        sequence_number: 1,
      } as StreamingEvent);
      const r = v.send({
        type: "response.in_progress",
        sequence_number: 1,
      } as StreamingEvent);
      expect(r.valid).toBe(false);
      expect(r.violations[0]?.rule).toBe("NON_MONOTONIC_SEQUENCE");
    });
  });

  describe("finalize() checks", () => {
    it("reports RESPONSE_NOT_TERMINATED when stream ends without a terminal event", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      const final = v.finalize();
      expect(final.valid).toBe(false);
      expect(
        final.violations.some((v) => v.rule === "RESPONSE_NOT_TERMINATED"),
      ).toBe(true);
    });

    it("reports ITEM_NOT_TERMINATED when an item is never closed", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      v.send(ev({ type: "response.completed" }));
      const final = v.finalize();
      expect(final.valid).toBe(false);
      expect(
        final.violations.some((v) => v.rule === "ITEM_NOT_TERMINATED"),
      ).toBe(true);
    });

    it("reports CONTENT_PART_NOT_TERMINATED when a content part is never closed", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      v.send(
        ev({
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      v.send(
        ev({
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "item-1", status: "completed" },
        }),
      );
      v.send(ev({ type: "response.completed" }));
      const final = v.finalize();
      expect(final.valid).toBe(false);
      expect(
        final.violations.some((v) => v.rule === "CONTENT_PART_NOT_TERMINATED"),
      ).toBe(true);
    });

    it("returns valid:true for a well-terminated stream", () => {
      const v = new ResponseStreamValidator();
      v.send(ev({ type: "response.in_progress" }));
      v.send(
        ev({
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "item-1" },
        }),
      );
      v.send(
        ev({
          type: "response.content_part.added",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      v.send(
        ev({
          type: "response.content_part.done",
          item_id: "item-1",
          output_index: 0,
          content_index: 0,
        }),
      );
      v.send(
        ev({
          type: "response.output_item.done",
          output_index: 0,
          item: { id: "item-1", status: "completed" },
        }),
      );
      v.send(ev({ type: "response.completed" }));
      const final = v.finalize();
      expect(final.valid).toBe(true);
    });
  });
});
