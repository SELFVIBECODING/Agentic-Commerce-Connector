// SQLite-backed processed-events store. Durable across process restarts —
// which closes the at-most-once gap flagged in the security audit: a
// `payment.escrowed` replay after a pod bounce no longer triggers a
// second settlement call.

import Database from "better-sqlite3";
import type { Database as SqliteDb } from "better-sqlite3";
import type { ProcessedEventStore } from "./store.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id    TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS processed_webhook_events_received_at
  ON processed_webhook_events (received_at);
`;

export interface SqliteProcessedEventStoreOptions {
  /** File path or `:memory:`. Caller is responsible for the parent dir. */
  readonly dbPath: string;
}

export interface SqliteProcessedEventStore extends ProcessedEventStore {
  /** Close the underlying handle. Safe to call multiple times. */
  close(): void;
}

export function createSqliteProcessedEventStore(
  opts: SqliteProcessedEventStoreOptions,
): SqliteProcessedEventStore {
  const db: SqliteDb = new Database(opts.dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  const hasStmt = db.prepare(
    "SELECT 1 FROM processed_webhook_events WHERE event_id = ?",
  );
  // INSERT OR IGNORE keeps `add` idempotent — the handler's `has` check is
  // the authoritative dedup guard; this just means a concurrent duplicate
  // that slips past the read won't fail the insert.
  const addStmt = db.prepare(
    "INSERT OR IGNORE INTO processed_webhook_events (event_id, received_at) VALUES (?, ?)",
  );
  const pruneStmt = db.prepare(
    "DELETE FROM processed_webhook_events WHERE received_at < ?",
  );

  let closed = false;

  return {
    async has(eventId: string): Promise<boolean> {
      return hasStmt.get(eventId) !== undefined;
    },
    async add(eventId: string, receivedAt: number): Promise<void> {
      addStmt.run(eventId, receivedAt);
    },
    async prune(olderThanMs: number, now: number): Promise<void> {
      pruneStmt.run(now - olderThanMs);
    },
    close(): void {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
