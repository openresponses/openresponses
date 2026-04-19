/**
 * in-memory-buffer.ts
 *
 * End-to-end example: take an out-of-order sequence of StreamingEvents,
 * reorder them with createResponseStream + InMemoryBufferAdapter, then
 * validate the output with ResponseStreamValidator.
 *
 * Run: bun run state-machines/typescript/examples/in-memory-buffer.ts
 */

import {
  createResponseStream,
  InMemoryBufferAdapter,
  ResponseStreamValidator,
} from "../src/index.ts";
import type { StreamingEvent } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Build an intentionally out-of-order event stream
// ---------------------------------------------------------------------------

const outOfOrderEvents: StreamingEvent[] = [
  { type: "response.created", sequence_number: 1 },
  { type: "response.in_progress", sequence_number: 2 },

  // These three arrive before their gateway events:
  {
    type: "response.output_text.delta",
    item_id: "item-1",
    output_index: 0,
    content_index: 0,
    sequence_number: 3,
  },
  {
    type: "response.content_part.added",
    item_id: "item-1",
    output_index: 0,
    content_index: 0,
    sequence_number: 4,
  },
  // ^ content_part.added itself arrives before output_item.added

  // Gateway events arrive "late":
  {
    type: "response.output_item.added",
    output_index: 0,
    item: { id: "item-1" },
    sequence_number: 5,
  },

  // These arrive in order relative to the reordered stream:
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

async function* fromArray(arr: StreamingEvent[]) {
  for (const event of arr) yield event;
}

// ---------------------------------------------------------------------------
// Reorder and validate
// ---------------------------------------------------------------------------

const buffer = new InMemoryBufferAdapter();
const reorderedStream = createResponseStream(fromArray(outOfOrderEvents), {
  buffer,
});
const validator = new ResponseStreamValidator();

console.log("--- Reordered events ---");
let eventIndex = 0;
for await (const event of reorderedStream) {
  eventIndex++;
  const result = validator.send(event);
  const status = result.valid
    ? "✓"
    : `✗ [${result.violations.map((v) => v.rule).join(", ")}]`;
  console.log(
    `  ${String(eventIndex).padStart(2)}. ${event.type.padEnd(40)} ${status}`,
  );
}

const finalResult = validator.finalize();
console.log("\n--- Final validation ---");
if (finalResult.valid) {
  console.log("✓ Stream is fully valid — no violations.");
} else {
  console.log("✗ Finalize violations:");
  for (const v of finalResult.violations) {
    console.log(`    [${v.rule}] ${v.message}`);
  }
}

console.log(`\nAll violations: ${validator.violations.length}`);
