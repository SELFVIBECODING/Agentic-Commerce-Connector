import { describe, it, expect } from "vitest";
import { renderLogo } from "../shared/logo.js";

describe("renderLogo", () => {
  it("contains the ACC block-letter glyphs", () => {
    const out = renderLogo();
    // The full-block + box-drawing glyphs are what give the logo its
    // identity; a terminal that can't render them degrades to mojibake,
    // which is already worse than every other UTF-8 affordance in the
    // wizard (prompt boxes, spinner, QR).
    expect(out).toContain("█");
    expect(out).toContain("╗");
    expect(out).toContain("╝");
  });

  it("includes the tagline", () => {
    const out = renderLogo();
    expect(out).toContain("Agentic Commerce Connector");
  });

  it("appends an optional descriptor when provided", () => {
    expect(renderLogo("wizard")).toContain("wizard");
    expect(renderLogo()).not.toContain("wizard");
  });

  it("opens and closes with blank lines so it slots into flow output", () => {
    const out = renderLogo();
    expect(out.startsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(true);
  });
});
