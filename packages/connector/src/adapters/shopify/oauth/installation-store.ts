// ---------------------------------------------------------------------------
// Installation store — persists one ShopInstallation per shop domain.
//
// Phase 3 ships only the in-memory implementation. Phase 4 swaps to a
// SQLite/Postgres-backed impl by returning a different object from the
// factory; the interface doesn't change, so callers aren't rewritten.
//
// Phase 2 (relay-backed installs) extends the interface with two
// refresh-aware methods used by the background refresh worker:
//   - listRefreshable(): lists active installs that carry an expiring
//     token (refresh_token + token_expires_at both non-null). Used by
//     the worker's 15-minute tick to pick rows to refresh.
//   - rotateTokens(): updates just the tokens + expiry atomically. The
//     worker calls this after POSTing to the relay's /refresh endpoint.
//
// These are separate from save() because save() rewrites the whole row
// (including scopes + installed_at) — which is wrong for a refresh where
// the only thing changing is the tokens + expiry.
// ---------------------------------------------------------------------------

import type { ShopInstallation } from "./types.js";

/**
 * Minimal row shape the refresh worker needs: just enough to decide
 * whether to refresh + what to send. Plaintext tokens, decrypted by the
 * store on the way out (same contract as ShopInstallation).
 */
export interface RefreshableInstallation {
  readonly shopDomain: string;
  readonly refreshToken: string;
  readonly tokenExpiresAt: number;
}

/** Input shape for an atomic token rotation after a successful refresh. */
export interface RotateTokensInput {
  readonly shopDomain: string;
  readonly adminToken: string;
  readonly refreshToken: string;
  readonly tokenExpiresAt: number;
}

export interface InstallationStore {
  get(shop: string): Promise<ShopInstallation | null>;
  save(installation: ShopInstallation): Promise<void>;
  markUninstalled(shop: string, at: number): Promise<void>;
  list(): Promise<readonly ShopInstallation[]>;

  /**
   * List active installations with an expiring token. "Active" means
   * `uninstalledAt IS NULL`. "Expiring" means both `refresh_token` and
   * `token_expires_at` are non-null. Optional filter: only rows with
   * `token_expires_at < beforeMs` — lets the worker restrict the result
   * set to the 1h-window rows without doing a client-side filter.
   */
  listRefreshable(
    beforeMs?: number,
  ): Promise<readonly RefreshableInstallation[]>;

  /**
   * Atomically update admin_token + refresh_token + token_expires_at for
   * an active (non-uninstalled) row. No-op if the row is missing or
   * uninstalled. Returns true iff exactly one row was updated — the
   * worker logs the no-op case so an uninstall-mid-flight doesn't fail
   * silently.
   */
  rotateTokens(input: RotateTokensInput): Promise<boolean>;
}

// Extended shape for the in-memory store — it carries the Phase-2 fields
// so the worker tests can exercise the interface without the SQLite driver.
interface InMemoryRow extends ShopInstallation {
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: number | null;
}

/**
 * In-memory store variant that accepts the Phase-2 fields. Its save()
 * defaults the new fields to null (backward-compat with every existing
 * call site that still constructs a plain ShopInstallation); the
 * `saveWithRefresh` hook lets tests seed rows with the new fields.
 */
export interface InMemoryInstallationStore extends InstallationStore {
  /**
   * Test-only: seed a row with Phase-2 fields set. Not part of the
   * production InstallationStore contract — production callers go
   * through save() + the refresh worker's rotateTokens().
   */
  saveWithRefresh(row: InMemoryRow): Promise<void>;
}

export function createInMemoryInstallationStore(): InMemoryInstallationStore {
  const rows = new Map<string, InMemoryRow>();

  return {
    async get(shop: string): Promise<ShopInstallation | null> {
      const row = rows.get(shop);
      if (!row) return null;
      // Return only the ShopInstallation-visible fields — the Phase-2
      // ones are internal to this store and the worker's typed methods.
      const {
        shopDomain,
        adminToken,
        storefrontToken,
        scopes,
        installedAt,
        uninstalledAt,
      } = row;
      return {
        shopDomain,
        adminToken,
        storefrontToken,
        scopes,
        installedAt,
        uninstalledAt,
      };
    },

    async save(installation: ShopInstallation): Promise<void> {
      const existing = rows.get(installation.shopDomain);
      rows.set(installation.shopDomain, {
        ...installation,
        refreshToken: existing?.refreshToken ?? null,
        tokenExpiresAt: existing?.tokenExpiresAt ?? null,
      });
    },

    async saveWithRefresh(row: InMemoryRow): Promise<void> {
      rows.set(row.shopDomain, row);
    },

    async markUninstalled(shop: string, at: number): Promise<void> {
      const existing = rows.get(shop);
      if (!existing) return;
      rows.set(shop, { ...existing, uninstalledAt: at });
    },

    async list(): Promise<readonly ShopInstallation[]> {
      return Array.from(rows.values()).map((r) => ({
        shopDomain: r.shopDomain,
        adminToken: r.adminToken,
        storefrontToken: r.storefrontToken,
        scopes: r.scopes,
        installedAt: r.installedAt,
        uninstalledAt: r.uninstalledAt,
      }));
    },

    async listRefreshable(
      beforeMs?: number,
    ): Promise<readonly RefreshableInstallation[]> {
      const out: RefreshableInstallation[] = [];
      for (const row of rows.values()) {
        if (row.uninstalledAt !== null) continue;
        if (row.refreshToken === null) continue;
        if (row.tokenExpiresAt === null) continue;
        if (beforeMs !== undefined && row.tokenExpiresAt >= beforeMs) continue;
        out.push({
          shopDomain: row.shopDomain,
          refreshToken: row.refreshToken,
          tokenExpiresAt: row.tokenExpiresAt,
        });
      }
      return out;
    },

    async rotateTokens(input: RotateTokensInput): Promise<boolean> {
      const existing = rows.get(input.shopDomain);
      if (!existing || existing.uninstalledAt !== null) return false;
      rows.set(input.shopDomain, {
        ...existing,
        adminToken: input.adminToken,
        refreshToken: input.refreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
      });
      return true;
    },
  };
}
