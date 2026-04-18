// Pins the persistence-across-restarts guarantee: dedup state in the
// SQLite store must survive the store being closed and reopened. Without
// this invariant, a pod restart would let Nexus replay `payment.escrowed`
// and trigger double settlement.

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteProcessedEventStore } from "../services/processed-events/sqlite-store.js";

function tmpDbPath(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "acc-events-"));
  const dbPath = join(dir, "processed-events.sqlite");
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("SqliteProcessedEventStore", () => {
  it("records and reports events idempotently", async () => {
    const { dbPath, cleanup } = tmpDbPath();
    try {
      const store = await createSqliteProcessedEventStore({ dbPath });

      expect(await store.has("evt_1")).toBe(false);
      await store.add("evt_1", 1000);
      expect(await store.has("evt_1")).toBe(true);

      // Re-adding the same id MUST NOT throw.
      await store.add("evt_1", 2000);
      expect(await store.has("evt_1")).toBe(true);

      store.close();
    } finally {
      cleanup();
    }
  });

  it("survives process restart (reopen the same db file)", async () => {
    const { dbPath, cleanup } = tmpDbPath();
    try {
      const first = await createSqliteProcessedEventStore({ dbPath });
      await first.add("evt_restart", 5000);
      first.close();

      const second = await createSqliteProcessedEventStore({ dbPath });
      expect(await second.has("evt_restart")).toBe(true);
      second.close();
    } finally {
      cleanup();
    }
  });

  it("prune removes rows older than the TTL", async () => {
    const { dbPath, cleanup } = tmpDbPath();
    try {
      const store = await createSqliteProcessedEventStore({ dbPath });
      await store.add("old", 1_000);
      await store.add("new", 10_000);

      // now = 12_000, ttl = 5_000 → cutoff = 7_000 → "old" removed, "new" kept.
      await store.prune(5_000, 12_000);

      expect(await store.has("old")).toBe(false);
      expect(await store.has("new")).toBe(true);
      store.close();
    } finally {
      cleanup();
    }
  });
});
