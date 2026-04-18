// Factory that picks the right ProcessedEventStore for the deployment.
//
// Selection rule:
//   - ACC_DATA_DIR set → SQLite-backed store at <dir>/db/processed-events.sqlite
//   - otherwise       → in-memory (tests, ephemeral dev)
//
// This mirrors the installation-store-factory pattern so operators get a
// consistent persistence story across both subsystems: if you've
// provisioned an ACC_DATA_DIR, both Shopify installs and webhook dedup
// survive restarts automatically.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ProcessedEventStore } from "./store.js";
import { createMemoryProcessedEventStore } from "./memory-store.js";
import { createSqliteProcessedEventStore } from "./sqlite-store.js";

export interface SelectProcessedEventStoreOptions {
  readonly dataDir: string | undefined;
}

export interface SelectedProcessedEventStore {
  readonly store: ProcessedEventStore;
  readonly describe: string;
}

export function selectProcessedEventStore(
  opts: SelectProcessedEventStoreOptions,
): SelectedProcessedEventStore {
  if (!opts.dataDir) {
    return {
      store: createMemoryProcessedEventStore(),
      describe: "in-memory (webhook dedup lost on restart)",
    };
  }
  const dbPath = resolve(opts.dataDir, "db", "processed-events.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true });
  return {
    store: createSqliteProcessedEventStore({ dbPath }),
    describe: `sqlite at ${dbPath}`,
  };
}
