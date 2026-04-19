import type { StreamingEvent } from "./types.ts";

export interface BufferAdapter {
  enqueue(event: StreamingEvent): Promise<void>;
  drainAll(): Promise<StreamingEvent[]>;
  requeueAll(events: StreamingEvent[]): Promise<void>;
}

export class InMemoryBufferAdapter implements BufferAdapter {
  private queue: StreamingEvent[] = [];

  async enqueue(event: StreamingEvent): Promise<void> {
    this.queue.push(event);
  }

  async drainAll(): Promise<StreamingEvent[]> {
    const q = [...this.queue];
    this.queue = [];
    return q;
  }

  async requeueAll(events: StreamingEvent[]): Promise<void> {
    this.queue = [...events, ...this.queue];
  }
}
