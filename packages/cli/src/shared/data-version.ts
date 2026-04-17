// ---------------------------------------------------------------------------
// Forward-migration runner for `config.json`. Single source of truth for
// which `dataVersion` the CLI knows how to produce and consume.
//
// Future bumps: add a case that transforms the older shape into the new one,
// bump CURRENT_DATA_VERSION, and add a test.
// ---------------------------------------------------------------------------

import type { AccConfig } from "./config-store.js";

export const CURRENT_DATA_VERSION = 1 as const;

export function migrateConfig(cfg: AccConfig): AccConfig {
  if (cfg.dataVersion === CURRENT_DATA_VERSION) return cfg;
  throw new Error(
    `unsupported dataVersion: ${cfg.dataVersion} (this CLI understands up to v${CURRENT_DATA_VERSION})`,
  );
}
