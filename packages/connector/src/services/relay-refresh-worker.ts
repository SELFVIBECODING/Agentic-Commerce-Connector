// ---------------------------------------------------------------------------
// Relay-backed Shopify token refresh worker.
//
// Runs only when `ACC_INSTALL_RELAY_URL` is set — i.e. the merchant
// installed via the Silicon Retail shared-relay path and therefore has
// expiring offline tokens that need periodic refresh. Self-hosted Partners
// installs (the primary path) never need this worker because the
// Partners-app tokens don't expire on that path.
//
// Behaviour on each tick (every 15min by default):
//
//   1. SELECT rows where `token_expires_at IS NOT NULL AND < now() + 1h
//      AND uninstalled_at IS NULL AND refresh_token IS NOT NULL`.
//   2. For each, POST to `${relayUrl}/refresh` with `{shop_domain,
//      refresh_token}`.
//   3. On 200: atomically UPDATE the row with the rotated tokens + new
//      expiry.
//   4. On 401: UPDATE `uninstalled_at = now()` — signals the merchant to
//      re-run `acc shopify connect --via=siliconretail`.
//   5. On network error / non-200 non-401: log + continue. Next tick will
//      try again — refresh windows are bounded by the 1h lookahead, not
//      by a single tick.
//
// One tick processes rows serially. We'd parallelise if we ever had many
// installs per connector, but self-hosted connectors typically manage 1-5
// shops — serial is simpler and keeps the relay's rate limiter happy.
// ---------------------------------------------------------------------------

import type {
  InstallationStore,
  RefreshableInstallation,
} from "../adapters/shopify/oauth/installation-store.js";

type LoggerFn = (message: string, data?: Record<string, unknown>) => void;

export interface RelayRefreshWorkerOptions {
  readonly store: InstallationStore;
  /** Base URL of the relay. The worker POSTs to `${relayUrl}/refresh`. */
  readonly relayUrl: string;
  /** Tick interval. Override in tests via ACC_REFRESH_INTERVAL_MS / here. */
  readonly intervalMs?: number;
  /** Horizon of "about to expire" — default 1h ahead of now. */
  readonly lookaheadMs?: number;
  /** Injectable fetch (tests). Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock (tests). Defaults to Date.now. */
  readonly now?: () => number;
  /** Structured-logger hook. Defaults to console.error. */
  readonly log?: LoggerFn;
  /**
   * Run the first tick immediately on start rather than waiting out the
   * interval. Defaults to true — on a cold boot we want near-expiry rows
   * picked up promptly.
   */
  readonly runImmediately?: boolean;
}

export interface RelayRefreshWorkerHandle {
  /** Stop the scheduled interval. Idempotent. */
  stop(): void;
  /**
   * Force a single tick to run now. Returns after the tick completes.
   * Exposed for tests + for `acc admin refresh-now` style ops commands.
   */
  runNow(): Promise<void>;
}

/** 15 minutes — the spec-mandated default from §8.2. */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
/** 1h — the spec-mandated lookahead from §8.2. */
const DEFAULT_LOOKAHEAD_MS = 60 * 60 * 1000;
/** Per-call timeout on the relay POST — keep below the tick interval. */
const FETCH_TIMEOUT_MS = 15_000;

export function startRelayRefreshWorker(
  opts: RelayRefreshWorkerOptions,
): RelayRefreshWorkerHandle {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const lookaheadMs = opts.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS;
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Default logger mirrors the rest of the connector's style — structured
  // JSON-ish key/value on stderr so log aggregation tools can grep.
  const log: LoggerFn =
    opts.log ??
    ((msg, data) =>
      console.error(
        `[RelayRefresh] ${msg}${data ? " " + JSON.stringify(data) : ""}`,
      ));
  const relayUrl = opts.relayUrl.replace(/\/+$/, "");
  const runImmediately = opts.runImmediately ?? true;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const horizon = now() + lookaheadMs;
      const rows = await opts.store.listRefreshable(horizon);
      if (rows.length === 0) return;
      log("tick", { candidates: rows.length });
      for (const row of rows) {
        if (stopped) return;
        await refreshOne(row).catch((err) => {
          // refreshOne already logs; this .catch is a belt-and-braces
          // guard against a programmer error that throws synchronously
          // before its own try/catch kicks in.
          log("refresh_unexpected_error", {
            shop: row.shopDomain,
            err: errorMessage(err),
          });
        });
      }
    } catch (err) {
      log("tick_failed", { err: errorMessage(err) });
    }
  }

  async function refreshOne(row: RefreshableInstallation): Promise<void> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${relayUrl}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_domain: row.shopDomain,
          refresh_token: row.refreshToken,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      log("network_error", {
        shop: row.shopDomain,
        err: errorMessage(err),
      });
      return;
    } finally {
      clearTimeout(t);
    }

    if (res.status === 401) {
      // Relay mapped Shopify's 401 to invalid_refresh_token — the
      // refresh_token we have is revoked or the app was uninstalled.
      // Mark the row uninstalled so the worker stops retrying and the
      // operator gets a clear re-install signal.
      try {
        await opts.store.markUninstalled(row.shopDomain, now());
        log("marked_uninstalled", { shop: row.shopDomain });
      } catch (err) {
        log("mark_uninstalled_failed", {
          shop: row.shopDomain,
          err: errorMessage(err),
        });
      }
      return;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log("relay_error", {
        shop: row.shopDomain,
        status: res.status,
        body: body.slice(0, 200),
      });
      return;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      log("parse_error", {
        shop: row.shopDomain,
        err: errorMessage(err),
      });
      return;
    }

    const parsed = parseRefreshResponse(json);
    if (!parsed) {
      log("malformed_response", { shop: row.shopDomain });
      return;
    }

    try {
      const rotated = await opts.store.rotateTokens({
        shopDomain: row.shopDomain,
        adminToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        tokenExpiresAt: parsed.tokenExpiresAt,
      });
      if (!rotated) {
        log("rotation_no_row", { shop: row.shopDomain });
        return;
      }
      log("rotated", {
        shop: row.shopDomain,
        expires_in_s: Math.round((parsed.tokenExpiresAt - now()) / 1000),
      });
    } catch (err) {
      log("rotation_persist_failed", {
        shop: row.shopDomain,
        err: errorMessage(err),
      });
    }
  }

  async function runNow(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = tick().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  if (runImmediately) {
    // Fire a first tick in the background — don't await in the factory
    // because server.ts wants an immediate stop handle.
    void runNow();
  }

  timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  // Don't keep the Node event loop alive just for this worker.
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    runNow,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedRefreshResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenExpiresAt: number;
}

/**
 * Parse the `POST /relayer/refresh` 200-response shape:
 *   { access_token: string, refresh_token: string, token_expires_at: number }
 * Returns null on any malformed field — the caller logs + skips rather
 * than throwing (refresh failures are soft errors; the next tick retries).
 */
function parseRefreshResponse(
  raw: unknown,
): ParsedRefreshResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const accessToken = r.access_token;
  const refreshToken = r.refresh_token;
  const tokenExpiresAt = r.token_expires_at;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) return null;
  if (typeof tokenExpiresAt !== "number" || !Number.isFinite(tokenExpiresAt)) {
    return null;
  }
  return { accessToken, refreshToken, tokenExpiresAt };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
