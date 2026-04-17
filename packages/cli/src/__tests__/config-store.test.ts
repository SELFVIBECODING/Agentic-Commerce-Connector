import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  saveConfig,
  type AccConfig,
} from "../shared/config-store.js";

const MIN_CONFIG: AccConfig = {
  dataVersion: 1,
  registry: "https://api.siliconretail.com",
  chainId: 1,
  selfUrl: "https://acc.example.com",
  skillMdPath: "./acc-data/skill/acc-skill.md",
};

describe("saveConfig + loadConfig", () => {
  let tmp: string;
  let path: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-cfg-"));
    path = join(tmp, "config.json");
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("round-trips a minimal config", () => {
    saveConfig(path, MIN_CONFIG);
    expect(loadConfig(path)).toEqual(MIN_CONFIG);
  });

  it("round-trips an optional wallet section", () => {
    const withWallet: AccConfig = {
      ...MIN_CONFIG,
      wallet: {
        address: "0x1234567890abcdef1234567890abcdef12345678",
        encrypted: false,
      },
    };
    saveConfig(path, withWallet);
    expect(loadConfig(path)).toEqual(withWallet);
  });

  it("rejects an unsupported dataVersion", () => {
    const raw = JSON.stringify({ ...MIN_CONFIG, dataVersion: 99 });
    writeFileSync(path, raw, "utf-8");
    expect(() => loadConfig(path)).toThrow(/dataVersion/);
  });

  it("rejects a malformed JSON file", () => {
    writeFileSync(path, "not-json", "utf-8");
    expect(() => loadConfig(path)).toThrow();
  });

  it("returns null when the config file does not exist", () => {
    expect(loadConfig(path)).toBeNull();
  });

  it("writes atomically via tmp + rename (no stale half-files)", () => {
    saveConfig(path, MIN_CONFIG);
    // tmp file should not remain after rename
    const tmpName = `${path}.tmp`;
    expect(existsSync(tmpName)).toBe(false);
    expect(readFileSync(path, "utf-8")).toContain('"dataVersion": 1');
  });
});
