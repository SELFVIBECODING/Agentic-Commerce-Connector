// Pins the path-traversal fix on ACC_SKILL_MD_PATH. The connector serves
// whatever path this resolves to at /.well-known/acc-skill.md without
// auth; a config that escapes ACC_DATA_DIR must be rejected at load.

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadBaseConfig } from "../config/base.js";

describe("loadBaseConfig — ACC_SKILL_MD_PATH containment", () => {
  it("defaults to <ACC_DATA_DIR>/skill/acc-skill.md", () => {
    const cfg = loadBaseConfig({ ACC_DATA_DIR: "/tmp/acc-data" }, "");
    expect(cfg.accSkillMdPath).toBe(
      resolve("/tmp/acc-data/skill/acc-skill.md"),
    );
  });

  it("accepts a path inside the data directory", () => {
    const cfg = loadBaseConfig(
      {
        ACC_DATA_DIR: "/tmp/acc-data",
        ACC_SKILL_MD_PATH: "/tmp/acc-data/custom/skill.md",
      },
      "",
    );
    expect(cfg.accSkillMdPath).toBe(resolve("/tmp/acc-data/custom/skill.md"));
  });

  it("rejects a path traversing outside the data directory", () => {
    expect(() =>
      loadBaseConfig(
        {
          ACC_DATA_DIR: "/tmp/acc-data",
          ACC_SKILL_MD_PATH: "/tmp/acc-data/../../../etc/passwd",
        },
        "",
      ),
    ).toThrow(/must resolve under ACC_DATA_DIR/);
  });

  it("rejects an absolute path in a sibling directory that starts with the same prefix", () => {
    expect(() =>
      loadBaseConfig(
        {
          ACC_DATA_DIR: "/tmp/acc-data",
          ACC_SKILL_MD_PATH: "/tmp/acc-data-evil/skill.md",
        },
        "",
      ),
    ).toThrow(/must resolve under ACC_DATA_DIR/);
  });

  it("rejects a fully unrelated absolute path", () => {
    expect(() =>
      loadBaseConfig(
        {
          ACC_DATA_DIR: "/tmp/acc-data",
          ACC_SKILL_MD_PATH: "/etc/passwd",
        },
        "",
      ),
    ).toThrow(/must resolve under ACC_DATA_DIR/);
  });
});
