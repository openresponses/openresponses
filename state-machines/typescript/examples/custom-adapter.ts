/**
 * custom-adapter.ts
 *
 * Documented example of a Redis-backed BufferAdapter.
 *
 * This file is illustrative — it does NOT run directly because it requires a
 * real Redis client.  Replace `redisClient` with your actual client instance
 * (ioredis, node-redis, Upstash, etc.).
 *
 * Key design notes
 * ----------------
 * • Use a per-response key so concurrent responses never share a buffer.
 * • RPUSH / LPUSH + LRANGE gives O(1) enqueue and O(N) drain — acceptable
 *   because N is bounded by the number of early events.
 * • Set a TTL on the key so abandoned buffers do not leak memory.
 * • For strict atomicity on drainAll, wrap LRANGE + DEL in a Lua script or
 *   a pipeline so no events are lost if the process crashes between the two
 *   commands.
 */

import type { BufferAdapter } from "../src/buffer.ts";
import type { StreamingEvent } from "../src/types.ts";
import { createResponseStream } from "../src/stream-processor.ts";

// ---------------------------------------------------------------------------
// RedisBufferAdapter
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Redis commands this adapter needs.
 * Compatible with ioredis, node-redis, and most other clients.
 */
interface RedisClient {
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export class RedisBufferAdapter implements BufferAdapter {
  private readonly key: string;
  private readonly ttlSeconds: number;

  /**
   * @param client      - Your Redis client instance
   * @param responseId  - Unique identifier for this response stream
   * @param ttlSeconds  - How long to keep the key if the stream is abandoned (default: 300s)
   */
  constructor(
    private readonly client: RedisClient,
    responseId: string,
    ttlSeconds = 300,
  ) {
    // Namespaced key: stream:<responseId>:buffer
    this.key = `stream:${responseId}:buffer`;
    this.ttlSeconds = ttlSeconds;
  }

  async enqueue(event: StreamingEvent): Promise<void> {
    const serialized = JSON.stringify(event);
    await this.client.rpush(this.key, serialized);
    // Refresh TTL on each write so long-running streams stay alive.
    await this.client.expire(this.key, this.ttlSeconds);
  }

  async drainAll(): Promise<StreamingEvent[]> {
    // Atomicity note: for production use, replace the two calls below with a
    // Lua script so the list cannot receive new items between LRANGE and DEL.
    //
    //   local items = redis.call('LRANGE', KEYS[1], 0, -1)
    //   redis.call('DEL', KEYS[1])
    //   return items
    const items = await this.client.lrange(this.key, 0, -1);
    if (items.length > 0) {
      await this.client.del(this.key);
    }
    return items.map((s) => JSON.parse(s) as StreamingEvent);
  }

  async requeueAll(events: StreamingEvent[]): Promise<void> {
    if (events.length === 0) return;
    // LPUSH prepends in reverse order; push in reverse so final order is preserved.
    const serialized = events.map((e) => JSON.stringify(e)).reverse();
    await this.client.lpush(this.key, ...serialized);
    await this.client.expire(this.key, this.ttlSeconds);
  }
}

// ---------------------------------------------------------------------------
// Usage sketch (not executed — illustrative only)
// ---------------------------------------------------------------------------

async function exampleUsage(
  redisClient: RedisClient,
  responseId: string,
  incomingEvents: AsyncIterable<StreamingEvent>,
) {
  const adapter = new RedisBufferAdapter(redisClient, responseId);
  const reordered = createResponseStream(incomingEvents, { buffer: adapter });

  for await (const event of reordered) {
    // Forward the correctly-ordered event downstream (e.g. to a WebSocket,
    // a database, or a validation layer).
    console.log(event.type);
  }
}

// Keep TypeScript happy — exampleUsage is exported for documentation purposes.
export { exampleUsage };
