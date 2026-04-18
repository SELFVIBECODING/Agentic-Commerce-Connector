// In-memory processed-events store. Backwards-compatible default; used
// when no DATABASE_URL / ACC_DATA_DIR is configured. Loses dedup state on
// process restart — operators who need durability across restarts should
// provision the SQLite store.

import type { ProcessedEventStore } from "./store.js";

export function createMemoryProcessedEventStore(): ProcessedEventStore {
  const events = new Map<string, number>();

  return {
    async has(eventId: string): Promise<boolean> {
      return events.has(eventId);
    },
    async add(eventId: string, receivedAt: number): Promise<void> {
      events.set(eventId, receivedAt);
    },
    async prune(olderThanMs: number, now: number): Promise<void> {
      for (const [id, ts] of events) {
        if (now - ts > olderThanMs) events.delete(id);
      }
    },
  };
}
