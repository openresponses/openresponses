import type { StreamingEvent } from "./types.ts";
import type { BufferAdapter } from "./buffer.ts";

// Events that carry item_id + content_index (content-part deltas/dones)
const CONTENT_PART_DELTA_TYPES = new Set([
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_text.annotation.added",
  "response.refusal.delta",
  "response.refusal.done",
  "response.reasoning.delta",
  "response.reasoning.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary.delta",
  "response.reasoning_summary.done",
]);

// Events that carry item_id but NO content_index (item-level deltas/dones)
const ITEM_DELTA_TYPES = new Set([
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
]);

/**
 * Returns the item ID that must already be open for this event to be valid,
 * or null if the event has no item dependency.
 */
function getRequiredItemId(event: StreamingEvent): string | null {
  const { type } = event;
  if (type === "response.output_item.done") {
    return event.item?.id ?? null;
  }
  if (
    type === "response.content_part.added" ||
    type === "response.content_part.done" ||
    CONTENT_PART_DELTA_TYPES.has(type) ||
    ITEM_DELTA_TYPES.has(type)
  ) {
    return (event as { item_id: string }).item_id;
  }
  return null;
}

/**
 * Returns the content-part key ("item_id:content_index") that must already be
 * open for this event to be valid, or null if there is no content-part dependency.
 */
function getRequiredContentPartKey(event: StreamingEvent): string | null {
  const { type } = event;
  if (
    type === "response.content_part.done" ||
    CONTENT_PART_DELTA_TYPES.has(type)
  ) {
    const e = event as { item_id: string; content_index: number };
    return `${e.item_id}:${e.content_index}`;
  }
  return null;
}

/**
 * Processes incoming streaming events, optionally buffering premature item/
 * content-part delta events until their gateway events have been seen.
 *
 * When no buffer adapter is supplied, events are emitted immediately
 * (identical to the existing pass-through behavior).
 *
 * When a buffer adapter is supplied, events whose item or content-part has
 * not yet been opened are enqueued; gateway events (`response.output_item.added`,
 * `response.content_part.added`) trigger a drain loop that re-emits now-valid
 * buffered events. At the end of the stream any remaining buffered events are
 * emitted unconditionally.
 */
export async function* createResponseStream(
  input: AsyncIterable<StreamingEvent>,
  options?: { buffer?: BufferAdapter },
): AsyncGenerator<StreamingEvent> {
  const buffer = options?.buffer;

  if (!buffer) {
    for await (const event of input) {
      yield event;
    }
    return;
  }

  // Narrow to a non-optional reference so closures below can use it safely.
  const buf: BufferAdapter = buffer;

  const openItems = new Set<string>();
  const openContentParts = new Set<string>();

  function isReady(event: StreamingEvent): boolean {
    const itemId = getRequiredItemId(event);
    if (itemId !== null && !openItems.has(itemId)) return false;
    const cpKey = getRequiredContentPartKey(event);
    if (cpKey !== null && !openContentParts.has(cpKey)) return false;
    return true;
  }

  function registerGateway(event: StreamingEvent): void {
    if (event.type === "response.output_item.added" && event.item?.id) {
      openItems.add(event.item.id);
    } else if (event.type === "response.content_part.added") {
      openContentParts.add(`${event.item_id}:${event.content_index}`);
    }
  }

  // Repeatedly drain the buffer until no more events become ready.
  // Returns all events that were drained and emitted.
  async function drainLoop(): Promise<StreamingEvent[]> {
    const result: StreamingEvent[] = [];
    let madeProgress = true;
    while (madeProgress) {
      madeProgress = false;
      const buffered = await buf.drainAll();
      const requeue: StreamingEvent[] = [];
      for (const event of buffered) {
        if (isReady(event)) {
          madeProgress = true;
          registerGateway(event);
          result.push(event);
        } else {
          requeue.push(event);
        }
      }
      if (requeue.length > 0) {
        await buf.requeueAll(requeue);
      }
    }
    return result;
  }

  for await (const event of input) {
    if (isReady(event)) {
      registerGateway(event);
      yield event;
      // Gateway events may unlock buffered events — drain after each one.
      if (
        event.type === "response.output_item.added" ||
        event.type === "response.content_part.added"
      ) {
        const drained = await drainLoop();
        for (const e of drained) yield e;
      }
    } else {
      await buf.enqueue(event);
    }
  }

  // After the input stream ends, run a final drain loop for any events that
  // were unlocked by late-arriving gateways.
  const finalDrained = await drainLoop();
  for (const e of finalDrained) yield e;

  // Emit any events that remain in the buffer and could never be unlocked
  // (e.g. their gateway event was missing from the stream entirely).
  const remaining = await buf.drainAll();
  for (const e of remaining) yield e;
}

/**
 * Returns a TransformStream that reorders streaming events into a valid FSM
 * sequence using the provided buffer adapter.
 *
 * When no buffer is provided, events pass through unchanged.
 */
export function createResponseTransformStream(options?: {
  buffer?: BufferAdapter;
}): TransformStream<StreamingEvent, StreamingEvent> {
  const queue: StreamingEvent[] = [];
  let resume: (() => void) | null = null;
  let inputDone = false;

  async function* makeInput(): AsyncGenerator<StreamingEvent> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (inputDone) {
        return;
      } else {
        await new Promise<void>((r) => {
          resume = r;
        });
      }
    }
  }

  let controller!: ReadableStreamDefaultController<StreamingEvent>;

  const readable = new ReadableStream<StreamingEvent>({
    start(c) {
      controller = c;
      (async () => {
        for await (const event of createResponseStream(makeInput(), options)) {
          controller.enqueue(event);
        }
        controller.close();
      })().catch((err) => controller.error(err));
    },
  });

  const writable = new WritableStream<StreamingEvent>({
    write(chunk) {
      queue.push(chunk);
      if (resume) {
        const r = resume;
        resume = null;
        r();
      }
    },
    close() {
      inputDone = true;
      if (resume) {
        const r = resume;
        resume = null;
        r();
      }
    },
    abort(reason) {
      inputDone = true;
      if (resume) {
        const r = resume;
        resume = null;
        r();
      }
      controller.error(reason);
    },
  });

  return { readable, writable };
}
