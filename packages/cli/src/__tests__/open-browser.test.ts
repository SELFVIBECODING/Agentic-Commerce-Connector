import { describe, it, expect, vi } from "vitest";
import { openBrowser } from "../shared/open-browser.js";

describe("openBrowser", () => {
  it("returns false when no DISPLAY is available (fake platform)", async () => {
    const spawn = vi.fn().mockReturnValue({
      on: () => undefined,
      unref: () => undefined,
    });
    const result = await openBrowser("https://example.com", {
      spawn,
      platform: "linux",
      env: {}, // no DISPLAY, no WAYLAND_DISPLAY
    });
    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns `open` on darwin", async () => {
    const spawn = vi.fn().mockReturnValue({
      on: () => undefined,
      unref: () => undefined,
    });
    const result = await openBrowser("https://example.com", {
      spawn,
      platform: "darwin",
      env: {},
    });
    expect(result).toBe(true);
    expect(spawn).toHaveBeenCalledWith("open", ["https://example.com"], expect.any(Object));
  });

  it("spawns `start` on win32", async () => {
    const spawn = vi.fn().mockReturnValue({
      on: () => undefined,
      unref: () => undefined,
    });
    const result = await openBrowser("https://example.com", {
      spawn,
      platform: "win32",
      env: {},
    });
    expect(result).toBe(true);
    expect(spawn.mock.calls[0]![0]).toBe("cmd");
  });

  it("returns false if spawn throws", async () => {
    const spawn = vi.fn().mockImplementation(() => {
      throw new Error("nope");
    });
    const result = await openBrowser("https://example.com", {
      spawn,
      platform: "darwin",
      env: {},
    });
    expect(result).toBe(false);
  });
});
