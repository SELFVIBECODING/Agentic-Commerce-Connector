// ---------------------------------------------------------------------------
// Incoming Shopify webhook handler.
//
// Handles:
//   - APP_UNINSTALLED (flip `uninstalled_at` on the shop row)
//   - CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT / SHOP_REDACT — 200 no-op
//     acknowledgement; the connector does not retain customer PII today.
//
// Two URL families are accepted for the three GDPR topics:
//
//   /webhooks/shopify/*   — Shopify-direct delivery (classic Partners
//                           install). HMAC verified with client_secret
//                           against the raw body + shop from
//                           X-Shopify-Shop-Domain header.
//
//   /webhooks/gdpr/*      — Silicon Retail-style relay forwarding.
//                           `X-ACC-Relay-Signature` + `X-ACC-Relay-Timestamp`
//                           verified with ACC_RELAY_SECRET env; shop_domain
//                           is read from the JSON body (the relay re-signs
//                           the body verbatim, but the shop-identifying
//                           header isn't present). Falls back to the
//                           Shopify-direct verifier if the relay headers
//                           are absent OR ACC_RELAY_SECRET is unset.
//
// A relay-hosted merchant's connector sets ACC_RELAY_SECRET in .env; a
// classic Partners merchant leaves it unset. Both variants 401 on
// signature failure.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { assertShopDomain, isValidShopDomain } from "./shop-domain.js";
import { verifyRelayWebhook } from "./relay-hmac.js";
import { verifyShopifyWebhookHmac } from "./webhook-hmac.js";
import type { InstallationStore } from "./installation-store.js";
import type { OAuthConfig } from "./types.js";
import {
  BodyTooLargeError,
  MAX_BODY_WEBHOOK,
  readBody as readBodyShared,
} from "../../../http-utils.js";

export interface WebhookHandlerDeps {
  readonly oauthConfig: OAuthConfig;
  readonly installationStore: InstallationStore;
  readonly now?: () => number;
  /**
   * Per-shop HMAC key issued by the relay at install time. Read from
   * `ACC_RELAY_SECRET` in the caller's env; undefined for classic
   * Partners installs (which never receive relay-forwarded webhooks).
   */
  readonly relaySecret?: string;
}

// ---------------------------------------------------------------------------
// Response helpers (duplicated from routes.ts to keep this module self-contained)
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return readBodyShared(req, MAX_BODY_WEBHOOK);
}

// ---------------------------------------------------------------------------
// Shared verification step.
// ---------------------------------------------------------------------------

/** Pull `shop_domain` out of a JSON webhook body, or undefined on failure. */
function extractShopFromBody(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed && typeof parsed === "object" && "shop_domain" in parsed) {
      const v = (parsed as { shop_domain: unknown }).shop_domain;
      return typeof v === "string" ? v : undefined;
    }
  } catch {
    /* malformed JSON → undefined */
  }
  return undefined;
}

function headerStr(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

async function verifyAndExtract(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<{ shop: string; rawBody: string } | null> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return null;
  }

  let rawBody: string;
  try {
    rawBody = await readBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      sendJson(res, 413, {
        error: "payload_too_large",
        limit: MAX_BODY_WEBHOOK,
      });
      return null;
    }
    throw err;
  }

  // Try the relay-signed envelope first iff BOTH relay headers are
  // present AND we have a relay secret on file. If either is missing,
  // fall through to the Shopify-direct verifier unchanged — that's the
  // classic Partners install path.
  const relaySig = headerStr(req, "x-acc-relay-signature");
  const relayTs = headerStr(req, "x-acc-relay-timestamp");
  const relaySecret = deps.relaySecret;
  if (relaySig && relayTs && relaySecret) {
    const result = verifyRelayWebhook({
      rawBody,
      signatureHeader: relaySig,
      timestampHeader: relayTs,
      relaySecret,
      now: deps.now,
    });
    if (result.ok) {
      // Relay-forwarded webhooks carry the shop in the JSON body; the
      // relay preserves Shopify's payload byte-for-byte, and every
      // GDPR topic's payload includes `shop_domain` per Shopify's
      // schema.
      const shopFromBody = extractShopFromBody(rawBody);
      if (!isValidShopDomain(shopFromBody)) {
        sendJson(res, 400, { error: "invalid_shop" });
        return null;
      }
      return { shop: assertShopDomain(shopFromBody), rawBody };
    }
    // Relay verification failed — do NOT fall through to the Shopify
    // verifier when the caller explicitly sent relay headers. Either
    // the timestamp is stale (replay attempt) or the signature is
    // wrong; in both cases we should reject rather than let a valid
    // Shopify HMAC authorise the same body under a different auth
    // authority.
    sendJson(res, 401, { error: "hmac_mismatch" });
    return null;
  }

  // Shopify-direct path: X-Shopify-Hmac-Sha256 signs the raw body with
  // client_secret; shop comes from X-Shopify-Shop-Domain.
  const shopifyHmac = headerStr(req, "x-shopify-hmac-sha256");
  const shopHeader = headerStr(req, "x-shopify-shop-domain");
  if (
    !verifyShopifyWebhookHmac(
      rawBody,
      shopifyHmac,
      deps.oauthConfig.clientSecret,
    )
  ) {
    sendJson(res, 401, { error: "hmac_mismatch" });
    return null;
  }

  if (!isValidShopDomain(shopHeader)) {
    sendJson(res, 400, { error: "invalid_shop" });
    return null;
  }

  return { shop: assertShopDomain(shopHeader), rawBody };
}

// ---------------------------------------------------------------------------
// app/uninstalled — mark installation as uninstalled, 200.
// ---------------------------------------------------------------------------

export async function handleAppUninstalled(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<void> {
  const verified = await verifyAndExtract(req, res, deps);
  if (!verified) return;

  const now = (deps.now ?? Date.now)();
  await deps.installationStore.markUninstalled(verified.shop, now);
  sendEmpty(res, 200);
}

// ---------------------------------------------------------------------------
// GDPR topics — acknowledge only (no-op today; no customer data retained).
// ---------------------------------------------------------------------------

export async function handleGdprAcknowledge(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebhookHandlerDeps,
): Promise<void> {
  const verified = await verifyAndExtract(req, res, deps);
  if (!verified) return;
  sendEmpty(res, 200);
}

// ---------------------------------------------------------------------------
// Router — dispatches the four webhook paths.
// ---------------------------------------------------------------------------

export function createShopifyWebhookRouter(deps: WebhookHandlerDeps) {
  return async function route(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    ).pathname;

    if (path === "/webhooks/shopify/app-uninstalled") {
      await handleAppUninstalled(req, res, deps);
      return true;
    }
    if (
      path === "/webhooks/shopify/customers-data-request" ||
      path === "/webhooks/shopify/customers-redact" ||
      path === "/webhooks/shopify/shop-redact"
    ) {
      await handleGdprAcknowledge(req, res, deps);
      return true;
    }
    // Silicon Retail-style relay forwards GDPR webhooks to
    // /webhooks/gdpr/{topic} with topic names that use underscores to match
    // Shopify's own topic-code casing (customers_redact, shop_redact,
    // customers_data_request). Accept both underscore and hyphen forms so
    // a sibling-operator relay that uses the path-style spelling still
    // works.
    if (
      path === "/webhooks/gdpr/customers_data_request" ||
      path === "/webhooks/gdpr/customers_redact" ||
      path === "/webhooks/gdpr/shop_redact" ||
      path === "/webhooks/gdpr/customers-data-request" ||
      path === "/webhooks/gdpr/customers-redact" ||
      path === "/webhooks/gdpr/shop-redact"
    ) {
      await handleGdprAcknowledge(req, res, deps);
      return true;
    }
    return false;
  };
}

export type ShopifyWebhookRouter = ReturnType<
  typeof createShopifyWebhookRouter
>;
