// ---------------------------------------------------------------------------
// Processed webhook event store — idempotency across process restarts.
//
// The webhook handler was previously keeping a module-level `Map<id, ts>`,
// which a process restart wiped. That let Nexus replay `payment.escrowed`
// after a pod bounce and trigger a duplicate settlement call — a real
// at-most-once violation. This module adds a persistence boundary so
// self-hosted deployments can opt into SQLite-backed dedup.
//
// Two implementations ship: in-memory (default, backwards-compatible) and
// SQLite-backed (durable, selected automatically when ACC_DATA_DIR is set
// and better-sqlite3 is available). The webhook handler depends only on
// the `ProcessedEventStore` interface below, so callers can inject Postgres
// later without touching the event flow.
// ---------------------------------------------------------------------------

export interface ProcessedEventStore {
  /** True if the event has been recorded within the retention window. */
  has(eventId: string): Promise<boolean>;
  /**
   * Record the event with its receive timestamp (unix ms). MUST be idempotent:
   * adding the same id twice is not an error.
   */
  add(eventId: string, receivedAt: number): Promise<void>;
  /** Drop rows older than `olderThanMs`. Called opportunistically. */
  prune(olderThanMs: number, now: number): Promise<void>;
}

// Default retention: 1 hour. Long enough to absorb Nexus's retry budget on
// transient 5xx (~15 min worst case) plus a safety margin, short enough
// that the SQLite table stays small in steady state.
export const DEFAULT_EVENT_TTL_MS = 3_600_000;
