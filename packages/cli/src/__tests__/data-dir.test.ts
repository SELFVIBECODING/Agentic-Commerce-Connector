import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { ensureDataDir, resolveDataDir } from "../shared/data-dir.js";

describe("resolveDataDir", () => {
  it("returns an absolute path for a relative input", () => {
    const layout = resolveDataDir("./acc-data");
    expect(isAbsolute(layout.root)).toBe(true);
    expect(layout.root.endsWith("/acc-data")).toBe(true);
  });

  it("derives all subpaths from the root", () => {
    const layout = resolveDataDir("/tmp/acc-test-root");
    expect(layout.keys).toBe("/tmp/acc-test-root/keys");
    expect(layout.skill).toBe("/tmp/acc-test-root/skill");
    expect(layout.db).toBe("/tmp/acc-test-root/db");
    expect(layout.configPath).toBe("/tmp/acc-test-root/config.json");
    expect(layout.envPath).toBe("/tmp/acc-test-root/.env");
    expect(layout.dbFile).toBe("/tmp/acc-test-root/db/acc.sqlite");
    expect(layout.skillMd).toBe("/tmp/acc-test-root/skill/acc-skill.md");
    expect(layout.encKeyFile).toBe("/tmp/acc-test-root/keys/enc.key");
    expect(layout.signerKeyFile).toBe("/tmp/acc-test-root/keys/signer.key");
  });
});

describe("ensureDataDir", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-data-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates keys/, skill/, db/ subdirectories with 0700 perms", () => {
    const root = join(tmp, "acc-data");
    const layout = ensureDataDir(root);
    expect(existsSync(layout.root)).toBe(true);
    expect(existsSync(layout.keys)).toBe(true);
    expect(existsSync(layout.skill)).toBe(true);
    expect(existsSync(layout.db)).toBe(true);

    const mode = (p: string): number => statSync(p).mode & 0o777;
    expect(mode(layout.keys)).toBe(0o700);
    expect(mode(layout.db)).toBe(0o700);
    expect(mode(layout.skill)).toBe(0o700);
  });

  it("is idempotent — re-running does not throw or alter perms", () => {
    const root = join(tmp, "acc-data");
    ensureDataDir(root);
    // Pre-existing dir with odd perms should be tightened.
    const reapplied = ensureDataDir(root);
    expect(existsSync(reapplied.root)).toBe(true);
    expect(statSync(reapplied.keys).mode & 0o777).toBe(0o700);
  });

  it("tightens perms on a pre-existing loose subdir", () => {
    const root = join(tmp, "acc-data");
    mkdirSync(join(root, "keys"), { recursive: true, mode: 0o755 });
    ensureDataDir(root);
    expect(statSync(join(root, "keys")).mode & 0o777).toBe(0o700);
  });

  it("detects a pre-existing config.json as 'initialised'", () => {
    const root = join(tmp, "acc-data");
    const layout = ensureDataDir(root);
    expect(layout.alreadyInitialised).toBe(false);

    // simulate a finished init
    mkdirSync(root, { recursive: true });
    writeFileSync(layout.configPath, "{}");
    const reapplied = ensureDataDir(root);
    expect(reapplied.alreadyInitialised).toBe(true);
  });
});
