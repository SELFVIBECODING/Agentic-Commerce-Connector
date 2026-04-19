/**
 * SQLite-backed InstallationStore tests. Uses an in-memory DB so no files
 * are created. The factory tests live separately so this file stays focused
 * on the CRUD + encryption-at-rest contract of the concrete impl.
 */
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  createSqliteInstallationStore,
  type SqliteInstallationStore,
} from "../adapters/shopify/oauth/installation-store-sqlite.js";
import type { ShopInstallation } from "../adapters/shopify/oauth/types.js";

const KEY = "a".repeat(64);

let store: SqliteInstallationStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

async function open(): Promise<SqliteInstallationStore> {
  store = await createSqliteInstallationStore({
    dbPath: ":memory:",
    encryptionKey: KEY,
  });
  return store;
}

function makeInstallation(
  partial: Partial<ShopInstallation> = {},
): ShopInstallation {
  return {
    shopDomain: "foo.myshopify.com",
    adminToken: "shpat_admin_token",
    storefrontToken: "sf_token",
    scopes: ["read_products", "write_orders"],
    installedAt: 1_700_000_000_000,
    uninstalledAt: null,
    ...partial,
  };
}

describe("SqliteInstallationStore", () => {
  it("throws on missing encryption key at construction", async () => {
    await expect(
      createSqliteInstallationStore({
        dbPath: ":memory:",
        encryptionKey: "",
      }),
    ).rejects.toThrow(/encryptionKey is required/);
  });

  it("returns null for unknown shop", async () => {
    const s = await open();
    expect(await s.get("nobody.myshopify.com")).toBeNull();
  });

  it("saves and round-trips an installation", async () => {
    const s = await open();
    const inst = makeInstallation();
    await s.save(inst);
    const got = await s.get(inst.shopDomain);
    expect(got).toEqual(inst);
  });

  it("handles a null storefront token round-trip", async () => {
    const s = await open();
    const inst = makeInstallation({ storefrontToken: null });
    await s.save(inst);
    expect(await s.get(inst.shopDomain)).toEqual(inst);
  });

  it("upserts on conflict (same shop_domain)", async () => {
    const s = await open();
    await s.save(makeInstallation({ adminToken: "v1" }));
    await s.save(
      makeInstallation({ adminToken: "v2", scopes: ["read_products"] }),
    );
    const got = await s.get("foo.myshopify.com");
    expect(got?.adminToken).toBe("v2");
    expect(got?.scopes).toEqual(["read_products"]);
  });

  it("marks uninstalled without touching the tokens", async () => {
    const s = await open();
    await s.save(makeInstallation());
    await s.markUninstalled("foo.myshopify.com", 1_700_000_999_000);
    const got = await s.get("foo.myshopify.com");
    expect(got?.uninstalledAt).toBe(1_700_000_999_000);
    expect(got?.adminToken).toBe("shpat_admin_token");
  });

  it("lists all installations", async () => {
    const s = await open();
    await s.save(makeInstallation({ shopDomain: "a.myshopify.com" }));
    await s.save(makeInstallation({ shopDomain: "b.myshopify.com" }));
    const list = await s.list();
    const domains = list.map((r) => r.shopDomain).sort();
    expect(domains).toEqual(["a.myshopify.com", "b.myshopify.com"]);
  });

  it("stores tokens encrypted at rest, not as plaintext", async () => {
    const s = await open();
    await s.save(makeInstallation({ adminToken: "shpat_SECRET_PLAINTEXT" }));
    // Re-open the DB file directly via better-sqlite3 and inspect the raw
    // column — it must NOT contain the plaintext substring.
    // For :memory: we instead peek through the same DB handle via a query
    // that isn't our repo's read path.
    const dbPath = ":memory:";
    // Can't reopen :memory: from a different handle, so verify with a
    // dedicated raw read on a fresh store sharing the same file. Use a
    // temp-file path instead:
    s.close();
    store = null;
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(tmpdir(), "acc-sqlite-test-"));
    const fsPath = join(tmp, "acc.sqlite");
    try {
      store = await createSqliteInstallationStore({
        dbPath: fsPath,
        encryptionKey: KEY,
      });
      await store.save(
        makeInstallation({ adminToken: "shpat_SECRET_PLAINTEXT" }),
      );
      const raw = new Database(fsPath, { readonly: true });
      const row = raw
        .prepare("SELECT admin_token FROM shopify_installations")
        .get() as { admin_token: string };
      raw.close();
      expect(row.admin_token).not.toContain("SECRET");
      expect(row.admin_token).toMatch(/^[0-9a-f]+$/);
    } finally {
      store?.close();
      store = null;
      rmSync(tmp, { recursive: true, force: true });
    }
    // Touch dbPath to silence unused-var lint.
    void dbPath;
  });

  it("listRefreshable is empty until rotateTokens populates the phase-2 fields", async () => {
    const s = await open();
    await s.save(makeInstallation({ shopDomain: "fresh.myshopify.com" }));
    // Phase 1 save writes NULL into token_expires_at + refresh_token — not refreshable.
    expect(await s.listRefreshable()).toEqual([]);

    await s.rotateTokens({
      shopDomain: "fresh.myshopify.com",
      adminToken: "rotated_admin",
      refreshToken: "rotated_rt",
      tokenExpiresAt: 1_700_000_100_000,
    });

    const list = await s.listRefreshable();
    expect(list).toHaveLength(1);
    expect(list[0].shopDomain).toBe("fresh.myshopify.com");
    expect(list[0].refreshToken).toBe("rotated_rt");
    expect(list[0].tokenExpiresAt).toBe(1_700_000_100_000);

    // get() sees the rotated admin_token.
    const got = await s.get("fresh.myshopify.com");
    expect(got?.adminToken).toBe("rotated_admin");
  });

  it("listRefreshable honours the beforeMs cutoff", async () => {
    const s = await open();
    await s.save(makeInstallation({ shopDomain: "near.myshopify.com" }));
    await s.save(makeInstallation({ shopDomain: "far.myshopify.com" }));
    await s.rotateTokens({
      shopDomain: "near.myshopify.com",
      adminToken: "a",
      refreshToken: "r1",
      tokenExpiresAt: 100,
    });
    await s.rotateTokens({
      shopDomain: "far.myshopify.com",
      adminToken: "a",
      refreshToken: "r2",
      tokenExpiresAt: 10_000,
    });

    const within = await s.listRefreshable(500);
    expect(within.map((r) => r.shopDomain)).toEqual(["near.myshopify.com"]);
  });

  it("rotateTokens is a no-op on an uninstalled row", async () => {
    const s = await open();
    await s.save(makeInstallation({ shopDomain: "gone.myshopify.com" }));
    await s.rotateTokens({
      shopDomain: "gone.myshopify.com",
      adminToken: "a",
      refreshToken: "r",
      tokenExpiresAt: 1,
    });
    await s.markUninstalled("gone.myshopify.com", 999);
    const ok = await s.rotateTokens({
      shopDomain: "gone.myshopify.com",
      adminToken: "new_admin",
      refreshToken: "new_r",
      tokenExpiresAt: 2,
    });
    expect(ok).toBe(false);
  });

  it("save() preserves phase-2 refresh fields (COALESCE invariant)", async () => {
    const s = await open();
    await s.save(makeInstallation());
    await s.rotateTokens({
      shopDomain: "foo.myshopify.com",
      adminToken: "rotated_admin",
      refreshToken: "rotated_rt",
      tokenExpiresAt: 123456,
    });
    // A subsequent Phase-1 style save() (scopes changed, say) must NOT
    // wipe the refresh fields just rotated in by the worker.
    await s.save(
      makeInstallation({
        adminToken: "re_saved_admin",
        scopes: ["read_products"],
      }),
    );
    const list = await s.listRefreshable();
    expect(list).toHaveLength(1);
    expect(list[0].refreshToken).toBe("rotated_rt");
    expect(list[0].tokenExpiresAt).toBe(123456);
  });

  it("rejects decryption when the key is rotated (data-loss sentinel)", async () => {
    const s = await open();
    await s.save(makeInstallation());
    s.close();
    store = null;

    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmp = mkdtempSync(join(tmpdir(), "acc-sqlite-test-"));
    const fsPath = join(tmp, "acc.sqlite");
    try {
      store = await createSqliteInstallationStore({
        dbPath: fsPath,
        encryptionKey: KEY,
      });
      await store.save(makeInstallation());
      store.close();

      // Reopen with a different key.
      const wrongKeyStore = await createSqliteInstallationStore({
        dbPath: fsPath,
        encryptionKey: "b".repeat(64),
      });
      store = wrongKeyStore;
      await expect(wrongKeyStore.get("foo.myshopify.com")).rejects.toThrow();
    } finally {
      store?.close();
      store = null;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
