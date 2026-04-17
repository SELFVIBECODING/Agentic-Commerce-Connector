import type { StepContext, StepOutcome } from "./context.js";

export async function stepPreflight(_ctx: StepContext): Promise<StepOutcome> {
  const raw = process.versions.node;
  const major = Number(raw.split(".")[0]);
  if (Number.isNaN(major) || major < 20) {
    throw new Error(
      `acc init requires Node >= 20 (found ${raw}). Upgrade Node and re-run.`,
    );
  }
  // better-sqlite3 resolvability — caught here so step 7 can trust import.
  try {
    await import("better-sqlite3");
  } catch (err) {
    throw new Error(
      `better-sqlite3 failed to load (${err instanceof Error ? err.message : String(err)}). ` +
        "On Linux VPS hosts, install build-essential + python3 then re-run `npm install`.",
    );
  }
  return { applied: true, summary: `Node ${raw} + better-sqlite3 OK` };
}
