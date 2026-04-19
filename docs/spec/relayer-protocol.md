# ACC Install Relay Protocol

**Version:** `relay-protocol/1.0.0`
**Status:** Normative (M1 — install + poll + consume + Shopify callback)
**Last updated:** 2026-04-19

This document specifies the wire protocol between the ACC CLI and an
**install relay** — a service that holds a Shopify Custom Distribution
Partners app's `client_secret`, absorbs Shopify's OAuth callback, and
hands the resulting access tokens to a merchant's self-hosted connector
via a short-lived pair session.

The reference implementation is operated by Silicon Retail at
`https://api.siliconretail.com/relayer/*`. The protocol is open so that
any ecosystem operator can run a compatible relay under their own brand
without modifying the public CLI — merchants opt into a specific relay
with `acc init shopify --via=<relay-url>`.

**Runtime invariant:** the relay is never in the path of an agent's
runtime request to the merchant. Once the pair session completes, the
merchant's connector talks to Shopify directly with its own access
token. The relay participates only at install time and (for
2024-Q4+ expiring offline tokens) periodic token refresh.

---

## 1. Terminology

| Term | Meaning |
|---|---|
| **CLI** | The `acc` binary running on the merchant's machine. |
| **Relay** | An HTTP service implementing this protocol. |
| **Merchant connector** | The merchant's self-hosted ACC instance, reachable at `connector_url`. |
| **Shop** | A Shopify store identified by its `<handle>.myshopify.com` domain. |
| **Pair code** | An opaque 32-byte hex token minted by the relay; ties the CLI's poll request to Shopify's OAuth callback via the `state` parameter. |
| **Pair session** | The relay's server-side record holding tokens between the OAuth callback and the CLI's final poll. Ephemeral. |
| **Installation registry** | The relay's durable record of `(shop_domain → connector_url)` used for token refresh and GDPR-webhook forwarding after install completes. |

---

## 2. Base URL

Every endpoint in this spec is rooted at a relay base URL. The CLI
takes the base URL as a configuration value (`ACC_INSTALL_RELAY_URL` in
`.env` after install completes) and appends paths literally. A relay
MUST NOT redirect between base URLs mid-flow; the CLI treats a 3xx on
the pair routes as a fatal error.

**Silicon Retail reference implementation — long-term target URL:**

```
https://api.siliconretail.com/relayer
```

**Silicon Retail reference implementation — current URL (interim):**

```
https://acc-marketplace-relayer.onrender.com/relayer
```

The siliconretail.com path-routing layer is blocked on a Cloudflare /
Render custom-domain configuration; until that lands, the live relay
serves on its managed onrender.com hostname. The CLI's
`DEFAULT_RELAY_URL` constant points at the onrender URL during the
interim — that's the address merchants picking "Silicon Retail
relayer" in `acc init shopify` actually hit. When the branded host
comes online the CLI's default flips back to
`api.siliconretail.com/relayer` in a one-line code change. The wire
protocol is unchanged either way.

All paths below (`/pair/new`, `/auth/shopify/callback`, etc.) are
relative to whichever base the operator is serving.

---

## 3. Install flow (happy path)

```
CLI                                                  Relay                Shopify
│                                                       │                    │
│ 1. POST /pair/new {shop_domain, connector_url}        │                    │
├──────────────────────────────────────────────────────▶│                    │
│                                                       │                    │
│ ◀ {pair_code, install_url, poll_url, expires_in}  ────┤                    │
│                                                                            │
│ 2. open install_url in merchant's browser                                  │
│ ─────────────────────────────────────────────────────────────────────────▶ │
│                                                                            │
│                        3. Shopify merchant approves                        │
│                        4. Shopify → GET /auth/shopify/callback?code&state  │
│                                                       │◀───────────────────│
│                                                       │ verify HMAC,       │
│                                                       │ exchange code→tok, │
│                                                       │ mint storefront,   │
│                                                       │ fulfil pair        │
│ 5. GET /pair/poll?code=<pair_code>                    │                    │
├─(every 2s)───────────────────────────────────────────▶│                    │
│ ◀ {status: "pending", ...} ──────────────────────────┤  (until callback)  │
│                                                       │                    │
│ 6. GET /pair/poll?code=<pair_code>                    │                    │
├──────────────────────────────────────────────────────▶│                    │
│ ◀ {status: "ready", access_token, ...} ───────────────┤                    │
│                                                                            │
│ 7. persist tokens to local SQLite                                          │
│                                                                            │
│ 8. POST /pair/consume {pair_code}                     │                    │
├──────────────────────────────────────────────────────▶│                    │
│ ◀ {ok: true} ─────────────────────────────────────────┤ purge pair +       │
│                                                       │ write installation │
│                                                       │ registry row       │
```

---

## 4. Endpoints

### 4.1 `POST /pair/new`

Create a pair session. The relay issues a `pair_code`, remembers
`shop_domain + connector_url` for this code, and constructs a Shopify
authorize URL that uses the code as the OAuth `state` parameter.

**Request body (application/json):**

```json
{
  "shop_domain": "<handle>.myshopify.com",
  "connector_url": "https://<merchant-host>"
}
```

| Field | Type | Requirements |
|---|---|---|
| `shop_domain` | string | Matches `/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/` (after lowercasing). A relay MUST accept case-insensitive input and lowercase it before persisting. |
| `connector_url` | string | An `https://` URL, no trailing slash. A relay MUST reject HTTP. |

**Success response (`200 OK`):**

```json
{
  "pair_code": "a3f2b8...",
  "install_url": "https://<shop>.myshopify.com/admin/oauth/authorize?client_id=...&scope=...&redirect_uri=...&state=<pair_code>",
  "poll_url": "<relay-base-url>/pair/poll?code=<pair_code>",
  "expires_in": 600
}
```

| Field | Type | Notes |
|---|---|---|
| `pair_code` | string | Opaque, 32-byte hex recommended (64 chars). Sufficient entropy to prevent brute-force pair_code guessing attacks. |
| `install_url` | string | Fully-formed Shopify OAuth authorize URL. MUST include `state=<pair_code>` and a `redirect_uri` pointing at `<relay-base-url>/auth/shopify/callback`. |
| `poll_url` | string | Convenience — the `GET /pair/poll?code=...` URL pre-rendered. |
| `expires_in` | integer | Seconds until the pair session expires. A relay SHOULD return at least 300 and SHOULD NOT exceed 1800. |

**Error responses:**

| Status | `error` code | Meaning |
|---|---|---|
| 400 | `invalid_shop` | `shop_domain` fails the regex or is missing. |
| 400 | `invalid_connector_url` | `connector_url` is not HTTPS or not a valid URL. |
| 400 | `missing_connector_url` | `connector_url` absent. |
| 429 | — | Rate-limit exceeded. A relay MAY return this. |
| 503 | `capacity_exhausted` | Shopify Custom Distribution 50-store cap reached. |

### 4.2 `GET /pair/poll?code=<pair_code>`

Idempotent. The CLI polls every 2 seconds while the merchant approves
on Shopify. A relay MUST NOT rate-limit this endpoint at a threshold
that would conflict with a 2s poll interval over the full TTL (e.g. a
limit of 60/minute would cut off a 10-minute session at the 2-minute
mark).

**Responses:**

| Status | Body | When |
|---|---|---|
| 200 | `{"status": "pending", "expires_in": <int>}` | Pair session exists, callback has not yet landed. |
| 200 | `{"status": "ready", "shop_domain": ..., "access_token": ..., "storefront_token": ..., "scopes": [...], "refresh_token": ..., "token_expires_at": ...}` | Callback landed and tokens are ready. See §5 for field semantics. |
| 410 | `{"status": "expired"}` | Pair session existed but its TTL elapsed without a callback. |
| 404 | `{"status": "unknown"}` | `pair_code` never existed, or existed and was already consumed via `/pair/consume`. |
| 400 | `{"error": "missing_code"}` | `code` query param absent. |

**`ready` response fields:**

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `shop_domain` | string | no | Lowercased `<handle>.myshopify.com`. |
| `access_token` | string | no | Shopify admin API offline access token (e.g. `shpat_...`). |
| `storefront_token` | string or null | yes | Storefront API token minted via `storefrontAccessTokenCreate`. Null when the mint failed (best-effort — the connector can mint its own later). |
| `scopes` | array of strings | no | Scopes Shopify actually granted (may differ from those requested). |
| `refresh_token` | string or null | yes | Present for apps Shopify issues expiring tokens for (2024-Q4 onward). Null for legacy offline tokens. |
| `token_expires_at` | integer (unix ms) or null | yes | Non-null iff `refresh_token` is non-null. |

The relay MAY return the same `ready` body to repeated polls until the
CLI calls `/pair/consume`. After consume, subsequent polls MUST return
`404 unknown`.

### 4.3 `POST /pair/consume`

Signals that the CLI has persisted the tokens locally and the relay can
forget them. Idempotent.

**Request body (application/json):**

```json
{ "pair_code": "<pair_code>" }
```

**Responses:**

| Status | Body | When |
|---|---|---|
| 200 | `{"ok": true}` | Pair session (if any) purged from memory. |
| 400 | `{"error": "missing_pair_code"}` | Field absent. |

On consume the relay MUST:

1. Purge the pair session from in-memory state (no subsequent
   `/pair/poll` for the same `pair_code` returns `ready`).
2. Persist `(shop_domain → connector_url)` into its installation
   registry so that later GDPR webhooks and token refresh can find the
   merchant.
3. Return `{"ok": true}` regardless of whether the pair_code was
   present (idempotency); a relay MUST NOT 404 a double-consume.

### 4.4 `GET /auth/shopify/callback`

Shopify's OAuth redirect target. This endpoint is NOT called by the
CLI; Shopify's servers invoke it via the browser redirect after the
merchant consents. It is documented here because the relay's behaviour
at this endpoint is what makes the pair session transition to `ready`.

**Query parameters (from Shopify):**

- `code` — OAuth authorization code to exchange for an access token.
- `hmac` — HMAC-SHA256 hex of the remaining query params signed with
  `client_secret`. A relay MUST verify this with a timing-safe
  comparison before acting on the other params.
- `state` — Echoed back from the authorize request. Equals the
  `pair_code` the relay issued in §4.1. A relay MUST use this to look
  up the pair session and reject with 400 if no matching session
  exists.
- `shop` — Shopify shop domain. A relay MUST normalise and match it
  against the pair session's recorded `shop_domain`; a mismatch is 400
  `shop_mismatch`.
- `timestamp` — Unix seconds. A relay MUST reject if `|now - timestamp|
  > 300s`.

**Processing (normative order):**

1. Verify `hmac` (timing-safe).
2. Verify `timestamp` freshness.
3. Verify `shop` matches the pair session's `shop_domain`.
4. Exchange `code` for an access token at
   `https://<shop>/admin/oauth/access_token` using `client_id` +
   `client_secret`.
5. Optionally (best-effort) mint a Storefront access token via the
   Admin GraphQL API.
6. Transition the pair session to `ready` with the tokens + scopes +
   (possibly) refresh_token + token_expires_at.
7. Render an HTML success page to the merchant's browser. The body
   content is not normative; a relay SHOULD include a hint to return to
   the terminal.

**Error responses:**

| Status | `error` | When |
|---|---|---|
| 400 | `hmac_mismatch` | Signature verification failed. |
| 400 | `bad_timestamp` | Timestamp missing or non-numeric. |
| 400 | `timestamp_skew` | `|now - ts| > 300s`. |
| 400 | `invalid_shop` | Shop domain fails regex. |
| 400 | `unknown_pair` | No pair session for `state`. |
| 400 | `shop_mismatch` | Pair session's shop_domain differs from `shop`. |
| 400 | `missing_code` | `code` query param absent. |
| 409 | `pair_already_fulfilled` | Pair was already transitioned to ready. |
| 410 | `pair_expired` | Pair TTL elapsed. |
| 502 | `token_exchange_failed` | Shopify's token endpoint returned non-2xx or an unparseable body. |

---

## 5. Token refresh (M4 — planned, not required for M1 compliance)

Apps created after Shopify's 2024-Q4 Token Exchange rollout receive
offline access tokens that expire (typical lifetime 24h). The relay MAY
implement a refresh endpoint that the merchant connector calls
periodically to rotate the access token via its refresh_token. M1
implementations are allowed to omit this endpoint; their installed
merchants must use legacy non-expiring offline tokens.

**Endpoint:** `POST /refresh` (documented in a future revision of this
spec). Input: `{shop_domain, refresh_token}`. Output: new
`{access_token, refresh_token, token_expires_at}`.

---

## 6. GDPR webhook forwarding (M5 — planned)

Shopify's three mandatory compliance webhooks (`customers/data_request`,
`customers/redact`, `shop/redact`) are configured once per Partners app
at a single URL. For a shared relay this is
`<relay-base-url>/webhooks/gdpr/:topic`. On receipt the relay MUST:

1. Verify `X-Shopify-Hmac-Sha256` against the raw body using
   `client_secret`.
2. Look up the merchant's `connector_url` in its installation registry
   by `shop_domain`.
3. Forward the request body to
   `${connector_url}/webhooks/gdpr/<topic>`, re-signed with a
   per-shop HMAC key (`relay_secret`) that was delivered to the
   merchant in the final `/pair/poll → ready` response.
4. Return 2xx to Shopify regardless of forwarding success — forwarding
   retries live in the relay's own dead-letter queue.

Full semantics (retry schedule, relay_secret handshake, header names)
will be specified in a future revision of this document. M1
implementations MAY omit this endpoint; Shopify will retry its webhook
deliveries for ~48h, giving operators a window to upgrade.

---

## 7. Security

- **`client_secret` never leaves the relay.** Merchants never see it in
  their `.env`; the merchant's `.env` marker is `SHOPIFY_CLIENT_ID=relay-hosted`
  and an empty `SHOPIFY_CLIENT_SECRET=` so the connector's config loader
  routes refresh via the relay rather than directly to Shopify.
- **`pair_code` is sufficient entropy** (32 bytes / 256 bits) to resist
  online guessing without server-side rate-limiting. Relays SHOULD
  still rate-limit `/pair/new` to prevent amplification attacks.
- **HMAC verification** on `/auth/shopify/callback` MUST be
  timing-safe (`crypto.timingSafeEqual` in Node, equivalent elsewhere).
- **Timestamp freshness** on the callback (±300s) prevents replay of a
  previously-leaked callback URL against a new pair session.
- **TLS at the edge.** All endpoints MUST be served over HTTPS. A relay
  MUST reject plain HTTP.

---

## 8. Capacity and rate limits

Shopify Custom Distribution apps are capped at 50 installs per app
across all stores. A relay operator MUST monitor its installation
registry and:

- SHOULD warn (log, alert) at 90% of the cap.
- SHOULD return `503 capacity_exhausted` on `/pair/new` once the cap is
  reached.

Rate-limit recommendations (not normative):

| Endpoint | Per-IP limit |
|---|---|
| `POST /pair/new` | 10/minute, 100/hour |
| `GET /pair/poll` | Unlimited (or ≥ 1 req/s) |
| `POST /pair/consume` | 60/minute (idempotent; abuse is benign) |
| `GET /auth/shopify/callback` | No limit (Shopify-originated) |

---

## 9. Reference implementation

The Silicon Retail relay is the canonical implementation of this spec.
Source is not public (it ships as a service, not a library), but its
wire behaviour is fully described here — every tested claim in this
document is covered by the reference's test suite.

The merchant-facing CLI client (`acc init shopify --via=<relay-url>`)
that speaks this protocol is open-source in the same repository as this
document, under `packages/cli/`.

---

## 10. Versioning

This document is versioned at the top (`relay-protocol/1.0.0`). Future
revisions MAY:

- Add new endpoints (e.g. `/refresh`, `/webhooks/gdpr/:topic`) without
  bumping the major version.
- Add OPTIONAL request/response fields without a bump.
- Change the `state` parameter semantics, the pair_code format, or any
  of the normative order-of-verification steps only with a major bump
  (`2.0.0`).

A relay MAY advertise the version it implements via an HTTP header
`X-Relay-Protocol: relay-protocol/1.0.0` on any response. CLIs MAY
inspect this header to fail fast against incompatible relays.
