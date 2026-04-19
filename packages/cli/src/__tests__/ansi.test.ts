// The ansi module captures the colour-enabled state at import time from
// env + stdout.isTTY. Vitest runs without a TTY, so by default every
// helper is a passthrough — which is what we want tested: snapshots
// piped to files should never contain raw \x1b codes.

import { describe, it, expect } from "vitest";
import {
  bold,
  dim,
  brightCyan,
  green,
  __colourEnabledForTests,
} from "../shared/ansi.js";

describe("ansi helpers", () => {
  it("are disabled under the vitest harness (no TTY on stdout)", () => {
    expect(__colourEnabledForTests).toBe(false);
  });

  it("pass input through verbatim when colour is disabled", () => {
    expect(bold("hello")).toBe("hello");
    expect(dim("hello")).toBe("hello");
    expect(brightCyan("hello")).toBe("hello");
    expect(green("hello")).toBe("hello");
  });

  it("never injects ANSI escape sequences in non-TTY output", () => {
    const output = [bold("a"), dim("b"), brightCyan("c"), green("d")].join("|");
    expect(output).not.toContain("\x1b[");
  });
});
