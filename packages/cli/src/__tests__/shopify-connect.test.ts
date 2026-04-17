import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { connect } from "../commands/shopify/connect.js";
import { ensureDataDir } from "../shared/data-dir.js";
import { saveConfig, type AccConfig } from "../shared/config-store.js";

const SEED_CONFIG: AccConfig = {
  dataVersion: 1,
  registry: "https://api.siliconretail.com",
  chainId: 1,
  selfUrl: "https://acc.example.com",
  skillMdPath: "./acc-data/skill/acc-skill.md",
};

function seedDataDir(root: string): { dbFile: string; cfgPath: string } {
  const layout = ensureDataDir(root);
  saveConfig(layout.configPath, SEED_CONFIG);
  // Create the sqlite db with the schema
  const db = new Database(layout.dbFile);
  db.exec(`
    CREATE TABLE shopify_installations (
      shop_domain TEXT PRIMARY KEY,
      admin_token TEXT NOT NULL,
      storefront_token TEXT,
      scopes TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      uninstalled_at INTEGER,
      key_version INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.close();
  return { dbFile: layout.dbFile, cfgPath: layout.configPath };
}

function insertInstallation(dbFile: string, shop: string): void {
  const db = new Database(dbFile);
  db.prepare(
    "INSERT INTO shopify_installations (shop_domain, admin_token, scopes, installed_at) VALUES (?, 'tok', '', ?)",
  ).run(shop, Date.now());
  db.close();
}

describe("connect — URL construction", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-connect-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("builds install URL from selfUrl + shop and skips poll with --print-url-only", async () => {
    const dataDir = join(tmp, "acc-data");
    seedDataDir(dataDir);
    const result = await connect({
      shop: "test-shop.myshopify.com",
      printUrlOnly: true,
      dataDir,
      skipQr: true,
    });
    expect(result.installUrl).toBe(
      "https://acc.example.com/auth/shopify/install?shop=test-shop.myshopify.com",
    );
    expect(result.installed).toBe(false);
  });

  it("throws when config.json is missing", async () => {
    const dataDir = join(tmp, "acc-data");
    await expect(
      connect({ shop: "x.myshopify.com", dataDir, skipQr: true }),
    ).rejects.toThrow(/Run 'acc init'/);
  });
});

describe("connect — polling", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-poll-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns installed=true when the shop row appears during polling", async () => {
    const dataDir = join(tmp, "acc-data");
    const { dbFile } = seedDataDir(dataDir);
    let tick = 0;
    // Inject row on the second sleep tick
    const result = await connect({
      shop: "new-shop.myshopify.com",
      dataDir,
      skipQr: true,
      sleep: async () => {
        tick += 1;
        if (tick === 2) insertInstallation(dbFile, "new-shop.myshopify.com");
      },
      now: (() => {
        let t = 0;
        return () => (t += 100);
      })(),
    });
    expect(result.installed).toBe(true);
  });

  it("returns installed=false when the deadline passes without a row", async () => {
    const dataDir = join(tmp, "acc-data");
    seedDataDir(dataDir);
    let simulatedNow = 0;
    const result = await connect({
      shop: "missing.myshopify.com",
      dataDir,
      skipQr: true,
      sleep: async () => {
        // Each sleep advances our clock past the deadline quickly
        simulatedNow += 60_000;
      },
      now: () => simulatedNow,
    });
    expect(result.installed).toBe(false);
  });
});
