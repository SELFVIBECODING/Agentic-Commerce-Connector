// ---------------------------------------------------------------------------
// Preflight — runtime-appropriate sanity checks before the wizard proceeds.
//
// Under the shipped Bun-compiled binary (the `acc` single-file executable),
// SQLite is served by `bun:sqlite`, which is statically linked into the Bun
// runtime itself. It cannot fail to load short of the binary being corrupted,
// so we skip the import-probe entirely and just report the Bun version.
//
// Under Node (dev, tests, legacy `node build/server.js`), SQLite is served
// by `better-sqlite3` — a native module whose load can fail on fresh VPS
// hosts missing build-essential + python3. That's the case we genuinely need
// to catch before step 7 tries to open the DB. See
// ../../connector/src/services/db/sqlite.ts for the runtime routing this
// mirrors.
// ---------------------------------------------------------------------------

import type { StepContext, StepOutcome } from "./context.js";

export async function stepPreflight(_ctx: StepContext): Promise<StepOutcome> {
  const bunVersion = (
    process as unknown as { versions?: Record<string, string> }
  ).versions?.bun;
  if (typeof bunVersion === "string") {
    return { applied: true, summary: `Bun ${bunVersion} + bun:sqlite OK` };
  }

  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  if (Number.isNaN(major) || major < 20) {
    throw new Error(
      `acc init requires Node >= 20 (found ${nodeVersion}). Upgrade Node and re-run.`,
    );
  }

  try {
    await import("better-sqlite3");
  } catch (err) {
    throw new Error(
      `better-sqlite3 failed to load (${err instanceof Error ? err.message : String(err)}). ` +
        "On Linux VPS hosts, install build-essential + python3 then re-run `npm install`.",
    );
  }
  return { applied: true, summary: `Node ${nodeVersion} + better-sqlite3 OK` };
}
