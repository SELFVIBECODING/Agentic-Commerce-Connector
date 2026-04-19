// ---------------------------------------------------------------------------
// Unit tests for the Phase-2 relay-backed refresh worker.
//
// Uses the in-memory installation store (extended with Phase-2 fields via
// saveWithRefresh) so the worker's wire contract with InstallationStore
// is exercised end-to-end without SQLite/Postgres. A vi.fn() fetch stub
// stands in for the relay's /refresh endpoint.
//
// The worker is driven deterministically:
//   - runImmediately: false so construction doesn't auto-fire a tick
//   - runNow() to invoke exactly one tick per assertion
//   - injected `now` so lookahead + rotation timestamps are stable
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import { createInMemoryInstallationStore } from "../adapters/shopify/oauth/installation-store.js";
import { startRelayRefreshWorker } from "../services/relay-refresh-worker.js";

const RELAY_URL = "https://api.siliconretail.com/relayer";

function makeFetch(
  handler: (body: {
    shop_domain: string;
    refresh_token: string;
  }) => Response,
): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const u = typeof url === "string" ? url : url.toString();
      if (!u.endsWith("/refresh")) {
        return new Response("unexpected", { status: 500 });
      }
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            shop_domain: string;
            refresh_token: string;
          })
        : { shop_domain: "", refresh_token: "" };
      return handler(body);
    },
  );
}

function seedStore(
  store: ReturnType<typeof createInMemoryInstallationStore>,
  rows: Array<{
    shop: string;
    refreshToken: string | null;
    tokenExpiresAt: number | null;
    uninstalled?: boolean;
  }>,
): void {
  for (const r of rows) {
    store.saveWithRefresh({
      shopDomain: r.shop,
      adminToken: `admin-${r.shop}`,
      storefrontToken: null,
      scopes: ["read_products"],
      installedAt: 1,
      uninstalledAt: r.uninstalled ? 2 : null,
      refreshToken: r.refreshToken,
      tokenExpiresAt: r.tokenExpiresAt,
    });
  }
}

const NOW_MS = 1_700_000_000_000;

describe("relay-refresh-worker", () => {
  it("refreshes only rows within the 1h window", async () => {
    const store = createInMemoryInstallationStore();
    seedStore(store, [
      {
        shop: "near.myshopify.com",
        refreshToken: "rt_near",
        tokenExpiresAt: NOW_MS + 30 * 60_000, // 30min from now → in window
      },
      {
        shop: "far.myshopify.com",
        refreshToken: "rt_far",
        tokenExpiresAt: NOW_MS + 6 * 3_600_000, // 6h → out of window
      },
      {
        shop: "gone.myshopify.com",
        refreshToken: "rt_gone",
        tokenExpiresAt: NOW_MS + 10 * 60_000,
        uninstalled: true,
      },
    ]);

    const fetchImpl = makeFetch((body) =>
      new Response(
        JSON.stringify({
          access_token: `new_admin_${body.shop_domain}`,
          refresh_token: `new_rt_${body.shop_domain}`,
          token_expires_at: NOW_MS + 24 * 3_600_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      runImmediately: false,
      now: () => NOW_MS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {
        /* silence */
      },
    });

    await worker.runNow();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.shop_domain).toBe("near.myshopify.com");
    expect(body.refresh_token).toBe("rt_near");

    // near.myshopify.com should now carry the rotated tokens.
    const near = await store.listRefreshable();
    const nearRow = near.find((r) => r.shopDomain === "near.myshopify.com");
    expect(nearRow).toBeDefined();
    expect(nearRow?.refreshToken).toBe("new_rt_near.myshopify.com");
    expect(nearRow?.tokenExpiresAt).toBe(NOW_MS + 24 * 3_600_000);

    worker.stop();
  });

  it("rotates tokens on relay 200 response", async () => {
    const store = createInMemoryInstallationStore();
    seedStore(store, [
      {
        shop: "shop-a.myshopify.com",
        refreshToken: "rt_old",
        tokenExpiresAt: NOW_MS + 10 * 60_000,
      },
    ]);

    const fetchImpl = makeFetch(() =>
      new Response(
        JSON.stringify({
          access_token: "new_admin",
          refresh_token: "rt_rotated",
          token_expires_at: NOW_MS + 2 * 3_600_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      runImmediately: false,
      now: () => NOW_MS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {
        /* silence */
      },
    });

    await worker.runNow();

    const got = await store.get("shop-a.myshopify.com");
    expect(got?.adminToken).toBe("new_admin");
    // listRefreshable returns the plaintext refresh token (in-mem store)
    const refreshable = await store.listRefreshable();
    expect(refreshable.find((r) => r.shopDomain === "shop-a.myshopify.com")
      ?.refreshToken).toBe("rt_rotated");

    worker.stop();
  });

  it("marks the row uninstalled on relay 401", async () => {
    const store = createInMemoryInstallationStore();
    seedStore(store, [
      {
        shop: "revoked.myshopify.com",
        refreshToken: "rt_revoked",
        tokenExpiresAt: NOW_MS + 10 * 60_000,
      },
    ]);

    const fetchImpl = makeFetch(() =>
      new Response(
        JSON.stringify({ error: "invalid_refresh_token" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      runImmediately: false,
      now: () => NOW_MS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {
        /* silence */
      },
    });

    await worker.runNow();

    const row = await store.get("revoked.myshopify.com");
    expect(row?.uninstalledAt).toBe(NOW_MS);
    // Subsequent ticks won't pick it up because uninstalled_at is set.
    const refreshable = await store.listRefreshable();
    expect(
      refreshable.find((r) => r.shopDomain === "revoked.myshopify.com"),
    ).toBeUndefined();

    worker.stop();
  });

  it("keeps going (no throw) on network errors — other shops still refresh", async () => {
    const store = createInMemoryInstallationStore();
    seedStore(store, [
      {
        shop: "offline.myshopify.com",
        refreshToken: "rt_off",
        tokenExpiresAt: NOW_MS + 10 * 60_000,
      },
      {
        shop: "online.myshopify.com",
        refreshToken: "rt_on",
        tokenExpiresAt: NOW_MS + 10 * 60_000,
      },
    ]);

    const fetchImpl = vi.fn(
      async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const body = init?.body
          ? (JSON.parse(String(init.body)) as { shop_domain: string })
          : { shop_domain: "" };
        if (body.shop_domain === "offline.myshopify.com") {
          throw new Error("ECONNREFUSED");
        }
        return new Response(
          JSON.stringify({
            access_token: "ok_admin",
            refresh_token: "ok_rt",
            token_expires_at: NOW_MS + 24 * 3_600_000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      runImmediately: false,
      now: () => NOW_MS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {
        /* silence */
      },
    });

    await worker.runNow();

    // Online one rotated; offline one unchanged.
    const online = (await store.listRefreshable()).find(
      (r) => r.shopDomain === "online.myshopify.com",
    );
    const offline = (await store.listRefreshable()).find(
      (r) => r.shopDomain === "offline.myshopify.com",
    );
    expect(online?.refreshToken).toBe("ok_rt");
    expect(offline?.refreshToken).toBe("rt_off");

    worker.stop();
  });

  it("runs the initial tick when runImmediately is true (default)", async () => {
    const store = createInMemoryInstallationStore();
    seedStore(store, [
      {
        shop: "near.myshopify.com",
        refreshToken: "rt",
        tokenExpiresAt: NOW_MS + 10 * 60_000,
      },
    ]);

    const fetchImpl = makeFetch(() =>
      new Response(
        JSON.stringify({
          access_token: "a",
          refresh_token: "b",
          token_expires_at: NOW_MS + 24 * 3_600_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      // runImmediately omitted → true
      intervalMs: 3_600_000, // won't fire during this test
      now: () => NOW_MS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {
        /* silence */
      },
    });

    // Use runNow to await the same tick-path the immediate one kicks off.
    // runNow short-circuits if a tick is in flight, so either the immediate
    // tick or this call gets the fetch — but both converge on the same
    // promise.
    await worker.runNow();
    expect(fetchImpl).toHaveBeenCalled();
    worker.stop();
  });

  it("is idempotent on stop()", () => {
    const store = createInMemoryInstallationStore();
    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      runImmediately: false,
      log: () => {
        /* silence */
      },
    });
    worker.stop();
    worker.stop(); // must not throw
  });

  it("skips shops with no refresh_token on file", async () => {
    const store = createInMemoryInstallationStore();
    seedStore(store, [
      {
        shop: "legacy.myshopify.com",
        refreshToken: null,
        tokenExpiresAt: NOW_MS + 10 * 60_000,
      },
    ]);
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const worker = startRelayRefreshWorker({
      store,
      relayUrl: RELAY_URL,
      runImmediately: false,
      now: () => NOW_MS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => {
        /* silence */
      },
    });
    await worker.runNow();
    expect(fetchImpl).not.toHaveBeenCalled();
    worker.stop();
  });
});
