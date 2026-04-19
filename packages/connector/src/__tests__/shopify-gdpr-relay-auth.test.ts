// ---------------------------------------------------------------------------
// Relay-signed GDPR webhook authentication — Stream A / M5 (connector side).
//
// A Silicon Retail-style relay forwards Shopify's GDPR webhooks to this
// connector at /webhooks/gdpr/<topic>, re-signed with a per-shop HMAC key
// the merchant received at install time (ACC_RELAY_SECRET in .env). This
// suite pins:
//
//   1. Relay-signed webhook with valid signature + fresh timestamp → 200.
//   2. Relay-signed webhook with a stale timestamp (> 5min skew) → 401.
//   3. Relay-signed webhook with a wrong signature → 401 (no fall-through
//      to the Shopify-direct verifier when relay headers are present).
//   4. Unsigned webhook (Shopify-direct path) still works even when
//      ACC_RELAY_SECRET is set — so a merchant who migrates from
//      relay-hosted to classic Partners install doesn't break existing
//      webhooks that were registered pre-migration.
//   5. Classic Partners install (ACC_RELAY_SECRET unset) rejects relay-
//      signed webhooks — a misconfigured relay can't spoof GDPR events.
//   6. /webhooks/gdpr/<topic> is accepted as an alternative URL family
//      alongside /webhooks/shopify/<topic>.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createShopifyWebhookRouter } from "../adapters/shopify/oauth/webhook-handler.js";
import { createInMemoryInstallationStore } from "../adapters/shopify/oauth/installation-store.js";
import type { OAuthConfig } from "../adapters/shopify/oauth/types.js";

const CLIENT_SECRET = "shpss_secret";
const RELAY_SECRET = "r".repeat(64);
const SHOP = "foo.myshopify.com";
const NOW = 1_700_000_000_000;

function oauthConfig(): OAuthConfig {
  return {
    clientId: "c",
    clientSecret: CLIENT_SECRET,
    scopes: ["read_products"],
    redirectUri: "https://acc.example.com/auth/shopify/callback",
    apiVersion: "2025-07",
  };
}

function shopifyHmac(body: string, secret = CLIENT_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

function relaySignature(body: string, secret = RELAY_SECRET): string {
  const digest = createHmac("sha256", secret).update(body).digest("base64");
  return `sha256=${digest}`;
}

function mockReq(opts: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): IncomingMessage {
  const r = new Readable({
    read() {
      if (opts.body !== undefined) this.push(opts.body);
      this.push(null);
    },
  }) as IncomingMessage;
  r.method = opts.method ?? "POST";
  r.url = opts.url;
  r.headers = {
    host: "acc.example.com",
    "content-type": "application/json",
    ...(opts.headers ?? {}),
  };
  return r;
}

function mockRes(): {
  res: ServerResponse;
  status: () => number;
  body: () => string;
} {
  let statusCode = 0;
  const chunks: string[] = [];
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(chunk.toString());
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => statusCode,
    body: () => chunks.join(""),
  };
}

describe("Shopify GDPR webhooks — relay-signed envelope", () => {
  const body = JSON.stringify({
    shop_id: 1,
    shop_domain: SHOP,
    customer: { id: 42 },
  });

  for (const path of [
    "/webhooks/gdpr/customers_data_request",
    "/webhooks/gdpr/customers_redact",
    "/webhooks/gdpr/shop_redact",
  ]) {
    it(`accepts a correctly signed relay envelope at ${path}`, async () => {
      const router = createShopifyWebhookRouter({
        oauthConfig: oauthConfig(),
        installationStore: createInMemoryInstallationStore(),
        relaySecret: RELAY_SECRET,
        now: () => NOW,
      });
      const res = mockRes();
      const handled = await router(
        mockReq({
          url: path,
          headers: {
            "x-acc-relay-signature": relaySignature(body),
            "x-acc-relay-timestamp": String(NOW),
          },
          body,
        }),
        res.res,
      );
      expect(handled).toBe(true);
      expect(res.status()).toBe(200);
    });
  }

  it("rejects a relay envelope with a stale timestamp (>5min skew)", async () => {
    const router = createShopifyWebhookRouter({
      oauthConfig: oauthConfig(),
      installationStore: createInMemoryInstallationStore(),
      relaySecret: RELAY_SECRET,
      now: () => NOW,
    });
    const res = mockRes();
    const stale = String(NOW - 10 * 60 * 1000); // 10 minutes ago
    await router(
      mockReq({
        url: "/webhooks/gdpr/customers_redact",
        headers: {
          "x-acc-relay-signature": relaySignature(body),
          "x-acc-relay-timestamp": stale,
        },
        body,
      }),
      res.res,
    );
    expect(res.status()).toBe(401);
  });

  it("rejects a relay envelope signed with the wrong secret", async () => {
    const router = createShopifyWebhookRouter({
      oauthConfig: oauthConfig(),
      installationStore: createInMemoryInstallationStore(),
      relaySecret: RELAY_SECRET,
      now: () => NOW,
    });
    const res = mockRes();
    await router(
      mockReq({
        url: "/webhooks/gdpr/customers_redact",
        headers: {
          "x-acc-relay-signature": relaySignature(body, "w".repeat(64)),
          "x-acc-relay-timestamp": String(NOW),
        },
        body,
      }),
      res.res,
    );
    expect(res.status()).toBe(401);
  });

  it(
    "does NOT fall through to Shopify-direct HMAC when relay headers are " +
      "present but invalid (prevents downgrade attacks)",
    async () => {
      const router = createShopifyWebhookRouter({
        oauthConfig: oauthConfig(),
        installationStore: createInMemoryInstallationStore(),
        relaySecret: RELAY_SECRET,
        now: () => NOW,
      });
      const res = mockRes();
      // Body is validly Shopify-signed AND relay-signed-but-wrong. The
      // handler must reject on the wrong relay signature rather than
      // silently accept the valid Shopify signature.
      await router(
        mockReq({
          url: "/webhooks/gdpr/customers_redact",
          headers: {
            "x-acc-relay-signature": relaySignature(body, "w".repeat(64)),
            "x-acc-relay-timestamp": String(NOW),
            "x-shopify-hmac-sha256": shopifyHmac(body),
            "x-shopify-shop-domain": SHOP,
          },
          body,
        }),
        res.res,
      );
      expect(res.status()).toBe(401);
    },
  );

  it(
    "falls through to Shopify-direct HMAC when relay headers are absent " +
      "even though ACC_RELAY_SECRET is set",
    async () => {
      const router = createShopifyWebhookRouter({
        oauthConfig: oauthConfig(),
        installationStore: createInMemoryInstallationStore(),
        relaySecret: RELAY_SECRET,
        now: () => NOW,
      });
      const res = mockRes();
      await router(
        mockReq({
          url: "/webhooks/shopify/customers-redact",
          headers: {
            "x-shopify-hmac-sha256": shopifyHmac(body),
            "x-shopify-shop-domain": SHOP,
          },
          body,
        }),
        res.res,
      );
      expect(res.status()).toBe(200);
    },
  );

  it(
    "rejects relay-signed envelopes when ACC_RELAY_SECRET is unset (classic " +
      "Partners install refuses unknown signing authorities)",
    async () => {
      const router = createShopifyWebhookRouter({
        oauthConfig: oauthConfig(),
        installationStore: createInMemoryInstallationStore(),
        // No relaySecret — classic install.
        now: () => NOW,
      });
      const res = mockRes();
      // A relay-signed envelope without relaySecret configured triggers the
      // Shopify-direct verifier; since the caller didn't send a Shopify HMAC
      // header either, that fails → 401.
      await router(
        mockReq({
          url: "/webhooks/gdpr/customers_redact",
          headers: {
            "x-acc-relay-signature": relaySignature(body),
            "x-acc-relay-timestamp": String(NOW),
          },
          body,
        }),
        res.res,
      );
      expect(res.status()).toBe(401);
    },
  );

  it(
    "rejects /webhooks/shopify/* Shopify-signed webhooks with the wrong " +
      "secret when ACC_RELAY_SECRET is unset (regression guard)",
    async () => {
      const router = createShopifyWebhookRouter({
        oauthConfig: oauthConfig(),
        installationStore: createInMemoryInstallationStore(),
      });
      const res = mockRes();
      await router(
        mockReq({
          url: "/webhooks/shopify/customers-redact",
          headers: {
            "x-shopify-hmac-sha256": shopifyHmac(body, "wrong_secret"),
            "x-shopify-shop-domain": SHOP,
          },
          body,
        }),
        res.res,
      );
      expect(res.status()).toBe(401);
    },
  );

  it("accepts /webhooks/gdpr/<topic> via Shopify-direct HMAC too", async () => {
    // A merchant whose Partners-app webhook is configured with the relay's
    // path spelling can deliver direct, and we still accept.
    const router = createShopifyWebhookRouter({
      oauthConfig: oauthConfig(),
      installationStore: createInMemoryInstallationStore(),
    });
    const res = mockRes();
    await router(
      mockReq({
        url: "/webhooks/gdpr/shop_redact",
        headers: {
          "x-shopify-hmac-sha256": shopifyHmac(body),
          "x-shopify-shop-domain": SHOP,
        },
        body,
      }),
      res.res,
    );
    expect(res.status()).toBe(200);
  });
});
