import { describe, it, expect } from "vitest";
import { renderQr } from "../shared/qr.js";

describe("renderQr", () => {
  it("produces non-empty multi-line output for a URL", () => {
    const output = renderQr("https://example.com/.well-known/acc-skill.md");
    expect(output.length).toBeGreaterThan(0);
    expect(output.split("\n").length).toBeGreaterThan(5);
  });

  it("is deterministic for the same input", () => {
    const a = renderQr("https://same-input");
    const b = renderQr("https://same-input");
    expect(a).toBe(b);
  });

  it("renders a smaller form with { small: true }", () => {
    const big = renderQr("https://example.com", { small: false });
    const small = renderQr("https://example.com", { small: true });
    expect(small.length).toBeLessThan(big.length);
  });
});
