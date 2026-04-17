import { describe, it, expect } from "vitest";
import { CURRENT_DATA_VERSION, migrateConfig } from "../shared/data-version.js";
import type { AccConfig } from "../shared/config-store.js";

const BASE: AccConfig = {
  dataVersion: 1,
  registry: "https://api.siliconretail.com",
  chainId: 1,
  selfUrl: "https://acc.example.com",
  skillMdPath: "./acc-data/skill/acc-skill.md",
};

describe("migrateConfig", () => {
  it("returns v1 unchanged (no migrations yet)", () => {
    expect(migrateConfig(BASE)).toEqual(BASE);
  });

  it("throws on a future unsupported version", () => {
    const future = { ...BASE, dataVersion: CURRENT_DATA_VERSION + 1 } as AccConfig;
    expect(() => migrateConfig(future)).toThrow(/unsupported/);
  });
});
