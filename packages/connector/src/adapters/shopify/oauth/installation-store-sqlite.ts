// ---------------------------------------------------------------------------
// SQLite-backed installation store.
//
// Default persistence for self-hosted single-shop deployments. Storage is
// one file on disk (e.g. ./acc-data/db/acc.sqlite). Reads/writes are
// synchronous at the driver level; we still surface async Promises so the
// InstallationStore interface is backend-agnostic.
//
// Schema is dialect-neutral — `TEXT` for strings, `INTEGER` for timestamps
// (unix ms) and key_version. Same DDL works verbatim on Postgres (with
// BIGINT as a finer type for ms), so the Pg impl can reuse most of the
// row-mapping code unchanged.
//
// Driver selection lives in ../../../services/db/sqlite.ts: bun:sqlite under
// the shipped binary, better-sqlite3 under Node for dev/tests.
// ---------------------------------------------------------------------------

import {
  openSqlite,
  type SqliteDatabase,
} from "../../../services/db/sqlite.js";
import {
  encryptToken,
  decryptToken,
} from "../../../services/crypto/token-cipher.js";
import type { ShopInstallation } from "./types.js";
import type {
  InstallationStore,
  RefreshableInstallation,
  RotateTokensInput,
} from "./installation-store.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shopify_installations (
  shop_domain     TEXT PRIMARY KEY,
  admin_token     TEXT NOT NULL,
  storefront_token TEXT,
  scopes          TEXT NOT NULL,
  installed_at    INTEGER NOT NULL,
  uninstalled_at  INTEGER,
  key_version     INTEGER NOT NULL DEFAULT 1,
  token_expires_at INTEGER,
  refresh_token   TEXT
);
`;

/**
 * Idempotent column add for databases created by pre-v2 schema. Runs once at
 * store open; harmless on fresh DBs that already have the columns from
 * SCHEMA_SQL above. The `token_expires_at` / `refresh_token` columns are
 * reserved for the Phase 2 relay-refresh flow; Phase 1 writes NULL.
 */
async function ensureSchemaV2(db: SqliteDatabase): Promise<void> {
  const cols = db
    .prepare("PRAGMA table_info(shopify_installations)")
    .all() as Array<{
    readonly name: string;
  }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("token_expires_at")) {
    db.exec(
      "ALTER TABLE shopify_installations ADD COLUMN token_expires_at INTEGER",
    );
  }
  if (!names.has("refresh_token")) {
    db.exec("ALTER TABLE shopify_installations ADD COLUMN refresh_token TEXT");
  }
}

interface Row {
  readonly shop_domain: string;
  readonly admin_token: string;
  readonly storefront_token: string | null;
  readonly scopes: string;
  readonly installed_at: number;
  readonly uninstalled_at: number | null;
  readonly key_version: number;
  // Reserved for Phase 2 relay-refresh; always null in Phase 1 rows.
  readonly token_expires_at: number | null;
  readonly refresh_token: string | null;
}

export interface SqliteInstallationStoreOptions {
  /** File path or `:memory:`. Caller is responsible for the parent dir. */
  readonly dbPath: string;
  /** 64-hex AES-256 key used for admin/storefront token encryption. */
  readonly encryptionKey: string;
  /** Injectable clock for tests (only used during uninstall). */
  readonly now?: () => number;
}

export interface SqliteInstallationStore extends InstallationStore {
  /** Close the underlying DB handle. Safe to call multiple times. */
  close(): void;
}

export async function createSqliteInstallationStore(
  opts: SqliteInstallationStoreOptions,
): Promise<SqliteInstallationStore> {
  if (!opts.encryptionKey) {
    throw new Error(
      "[SqliteInstallationStore] encryptionKey is required. This store never writes tokens in plaintext.",
    );
  }
  const db: SqliteDatabase = await openSqlite(opts.dbPath);
  // WAL gives us concurrent readers + one writer with no extra config.
  // `:memory:` ignores WAL silently, so the pragma is safe for tests too.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  await ensureSchemaV2(db);

  const getStmt = db.prepare(
    "SELECT * FROM shopify_installations WHERE shop_domain = ?",
  );
  // NB: on the UPDATE branch we COALESCE the refresh-related fields with
  // the existing row so a call to save() that comes in with null
  // (the Phase-1 shape) doesn't wipe refresh tokens rotated by the
  // background worker. Install wizards that want to set these fields
  // explicitly use the separate admin-install path via rotateTokens().
  const upsertStmt = db.prepare(
    `INSERT INTO shopify_installations
       (shop_domain, admin_token, storefront_token, scopes, installed_at, uninstalled_at, key_version, token_expires_at, refresh_token)
     VALUES (@shop_domain, @admin_token, @storefront_token, @scopes, @installed_at, @uninstalled_at, @key_version, @token_expires_at, @refresh_token)
     ON CONFLICT(shop_domain) DO UPDATE SET
       admin_token       = excluded.admin_token,
       storefront_token  = excluded.storefront_token,
       scopes            = excluded.scopes,
       installed_at      = excluded.installed_at,
       uninstalled_at    = excluded.uninstalled_at,
       key_version       = excluded.key_version,
       token_expires_at  = COALESCE(excluded.token_expires_at, shopify_installations.token_expires_at),
       refresh_token     = COALESCE(excluded.refresh_token, shopify_installations.refresh_token)`,
  );
  const uninstallStmt = db.prepare(
    "UPDATE shopify_installations SET uninstalled_at = ? WHERE shop_domain = ?",
  );
  const listStmt = db.prepare("SELECT * FROM shopify_installations");
  // M4: refresh-worker queries.
  //
  // listRefreshableStmt — rows where both phase-2 fields are populated and
  // the row is still active. The worker filters further on beforeMs in JS
  // when it needs to restrict to the 1h window; keeping the SQL stable
  // simplifies the prepared-statement cache.
  const listRefreshableStmt = db.prepare(
    `SELECT shop_domain, admin_token, refresh_token, token_expires_at
       FROM shopify_installations
      WHERE uninstalled_at IS NULL
        AND refresh_token IS NOT NULL
        AND token_expires_at IS NOT NULL`,
  );
  const rotateTokensStmt = db.prepare(
    `UPDATE shopify_installations
        SET admin_token      = @admin_token,
            refresh_token    = @refresh_token,
            token_expires_at = @token_expires_at
      WHERE shop_domain = @shop_domain
        AND uninstalled_at IS NULL`,
  );

  function rowToInstallation(row: Row): ShopInstallation {
    return {
      shopDomain: row.shop_domain,
      adminToken: decryptToken(row.admin_token, opts.encryptionKey),
      storefrontToken: row.storefront_token
        ? decryptToken(row.storefront_token, opts.encryptionKey)
        : null,
      scopes: row.scopes.split(",").filter((s) => s.length > 0),
      installedAt: row.installed_at,
      uninstalledAt: row.uninstalled_at,
    };
  }

  return {
    async get(shop: string): Promise<ShopInstallation | null> {
      const row = getStmt.get([shop]) as Row | undefined;
      return row ? rowToInstallation(row) : null;
    },

    async save(installation: ShopInstallation): Promise<void> {
      upsertStmt.run({
        shop_domain: installation.shopDomain,
        admin_token: encryptToken(installation.adminToken, opts.encryptionKey),
        storefront_token:
          installation.storefrontToken == null
            ? null
            : encryptToken(installation.storefrontToken, opts.encryptionKey),
        scopes: installation.scopes.join(","),
        installed_at: installation.installedAt,
        uninstalled_at: installation.uninstalledAt ?? null,
        key_version: 1,
        // Reserved columns — Phase 2 populates these when relay-refresh lands.
        token_expires_at: null,
        refresh_token: null,
      });
    },

    async markUninstalled(shop: string, at: number): Promise<void> {
      uninstallStmt.run([at, shop]);
    },

    async list(): Promise<readonly ShopInstallation[]> {
      return (listStmt.all() as Row[]).map(rowToInstallation);
    },

    async listRefreshable(
      beforeMs?: number,
    ): Promise<readonly RefreshableInstallation[]> {
      const raw = listRefreshableStmt.all() as Array<{
        readonly shop_domain: string;
        readonly admin_token: string;
        readonly refresh_token: string;
        readonly token_expires_at: number;
      }>;
      const out: RefreshableInstallation[] = [];
      for (const r of raw) {
        if (beforeMs !== undefined && r.token_expires_at >= beforeMs) continue;
        out.push({
          shopDomain: r.shop_domain,
          refreshToken: decryptToken(r.refresh_token, opts.encryptionKey),
          tokenExpiresAt: r.token_expires_at,
        });
      }
      return out;
    },

    async rotateTokens(input: RotateTokensInput): Promise<boolean> {
      const result = rotateTokensStmt.run({
        shop_domain: input.shopDomain,
        admin_token: encryptToken(input.adminToken, opts.encryptionKey),
        refresh_token: encryptToken(input.refreshToken, opts.encryptionKey),
        token_expires_at: input.tokenExpiresAt,
      });
      return result.changes > 0;
    },

    close(): void {
      if (db.open) db.close();
    },
  };
}
