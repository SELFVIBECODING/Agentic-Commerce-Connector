// Coverage for the runtime-appropriate preflight:
//   - Bun-compiled binary: skip the native-module probe; bun:sqlite is
//     statically linked and can't fail to load.
//   - Node (dev/test): probe better-sqlite3 + enforce Node 20+.
//
// `process.versions.bun` is read at function-call time (not module-load
// time) so we can stub it per-test without dynamic-import gymnastics.

import { describe, it, expect, afterEach } from "vitest";
import { stepPreflight } from "../shared/steps/step1-preflight.js";
import type { StepContext } from "../shared/steps/context.js";

const fakeCtx = {} as unknown as StepContext;

const originalVersions = process.versions;

function patchVersions(patch: Partial<NodeJS.ProcessVersions> & { bun?: string }): void {
  Object.defineProperty(process, "versions", {
    value: { ...originalVersions, ...patch },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(process, "versions", {
    value: originalVersions,
    configurable: true,
    writable: true,
  });
});

describe("stepPreflight — Bun runtime", () => {
  it("skips native-module probing and reports the Bun version", async () => {
    patchVersions({ bun: "1.3.12" });
    const out = await stepPreflight(fakeCtx);
    expect(out.applied).toBe(true);
    expect(out.summary).toBe("Bun 1.3.12 + bun:sqlite OK");
  });

  it("does not touch better-sqlite3 under Bun (guaranteed by skipping the probe)", async () => {
    // If the probe ran, it would have to resolve better-sqlite3 — which the
    // Bun-compiled binary doesn't ship. Asserting only on the summary keeps
    // this test fast and doesn't require mocking dynamic-import failures.
    patchVersions({ bun: "9.9.9-nonexistent-version" });
    const out = await stepPreflight(fakeCtx);
    expect(out.summary).toContain("bun:sqlite OK");
  });
});

describe("stepPreflight — Node runtime", () => {
  it("rejects Node < 20 with an upgrade hint", async () => {
    patchVersions({ node: "18.17.0", bun: undefined });
    await expect(stepPreflight(fakeCtx)).rejects.toThrow(
      /requires Node >= 20 \(found 18\.17\.0\)/,
    );
  });

  it("succeeds on Node 20 with better-sqlite3 resolvable", async () => {
    // The dev node_modules ship better-sqlite3, so the real dynamic import
    // resolves. Assert the summary path rather than mocking import().
    patchVersions({ node: "20.11.0", bun: undefined });
    const out = await stepPreflight(fakeCtx);
    expect(out.applied).toBe(true);
    expect(out.summary).toBe("Node 20.11.0 + better-sqlite3 OK");
  });
});
