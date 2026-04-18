# Phase 2 Stream A — Silicon Retail install relay

**Status:** Draft, not yet implemented
**Author:** @ciphertang
**Date:** 2026-04-18
**Target ship:** `v0.6.0`

## 1. Summary

Add an **optional install path** for merchants who can't (or don't want to)
register their own Shopify Partners account. A Silicon Retail-operated relay
(at `https://api.siliconretail.com/relayer/*`, co-tenant with the
marketplace API on the same domain) holds a single shared Partners app's
`client_secret`, handles Shopify's OAuth callback, and hands freshly-minted
access tokens to the merchant's self-hosted ACC connector via a short-lived
pair session.

**Runtime remains relay-free.** Once the pair session completes, the
merchant's connector talks to Shopify Admin/Storefront APIs directly with
its own access token. Silicon Retail participates only during install and
(for 2024-Q4+ expiring tokens) periodic refresh.

**Code lives in two repos:**
- **Public `Agentic-Commerce-Connector` repo:** the pair protocol spec
  (this document + `docs/spec/relayer-protocol.md` in M1), the CLI
  client that speaks it (`acc init shopify --via=siliconretail`), and
  the connector-side refresh worker. Anyone reading the public repo
  can audit exactly what the merchant's CLI/connector sends and receives.
- **Private `acc-marketplace` repo (siliconretail.com-operated):** the
  specific server implementation of the relay at
  `services/relayer/`, mounted on the marketplace's reverse proxy under
  the `/relayer` path. Partners app credentials, encryption keys, and
  the installation registry live with the marketplace's operational
  infrastructure.

This split keeps the protocol transparent while acknowledging that
running a Shopify Custom Distribution relay is an operational commitment
with real costs (Partners account, capacity management, GDPR data
processor status). A sibling ecosystem operator who wants their own
relay follows the public protocol spec and builds their own server.

## 2. Goals and non-goals

**Goals:**

- Merchant onboarding time drops from ~25 min (Partners setup + filling
  GDPR webhook URLs + privacy policy) to ~3 min (type shop domain, click
  one link, wait for CLI to confirm).
- Zero new trust placed on Silicon Retail at runtime — a merchant whose
  connector finished installing can survive the relay going offline
  permanently (for non-expiring offline tokens) or for the duration of a
  single access-token lifetime (for expiring tokens).
- Relay protocol is documented publicly (in this repo); relay
  implementation is operated by Silicon Retail from the private
  `acc-marketplace` repo. Ecosystem operators wanting to run their own
  relay follow the published spec — no private code to license.
- Clean fallback: the existing per-merchant Partners flow
  (`acc init shopify`, no `--via` flag) continues to work verbatim.
- Complies with Shopify Custom Distribution rules (≤50 stores per app)
  and EU GDPR via a DPA template for merchants whose buyers are in the
  EEA.

**Non-goals:**

- Shopify App Store listing (deferred until the 50-store cap actually
  binds).
- Multi-provider payment wiring (that's Stream B).
- Shopify store metadata enrichment of `skill.md` (Stream C).
- A web dashboard for merchants to manage their relay-hosted
  installation. CLI is the only interaction surface for v0.6.0.
- Operator UI for the maintainer. Monitoring + abuse controls go through
  plain logs + one emergency CLI script in v0.6.0.
- Stream B (Nexus payment wiring) in parallel. Stream B is deferred
  until Stream A ships — merchants install via relay, see
  `supported_payments: []` on their published skill, and wait for a
  later release to enable a rail. The relay's `skill.md` auto-emit
  does not depend on payment providers.

## 3. Architecture

### 3.1 Install flow

```
┌──────────────┐                          ┌───────────────────────────┐
│  Merchant's  │                          │ api.siliconretail.com     │
│     CLI      │                          │   /relayer/*              │
└──────┬───────┘                          └────────────┬──────────────┘
       │  POST /relayer/pair/new {shop, connector_url} │
       ├──────────────────────────────────────────────▶│
       │                                               │ issue pair_code
       │                                               │ state = pair_code
       │  ◀──{pair_code, install_url, poll_url, ttl}───┤
       │                                               │
       │  open browser → install_url                   │
       │  ▶ merchant approves on Shopify               │
       │                                               │
       │                            ┌──────────────────┴─────────────────┐
       │                            │  Shopify redirects:                │
       │                            │  GET /relayer/auth/shopify/callback│
       │                            │  ?code=...&state=<pair_code>       │
       │                            │  &hmac=...&shop=...                │
       │                            └──────────────────┬─────────────────┘
       │                                               │ verify HMAC
       │                                               │ look up pair
       │                                               │ exchange code→tok
       │                                               │ mint storefront tok
       │                                               │ store tokens in
       │                                               │ pair session keyed
       │                                               │ by pair_code
       │                                               │
       │  GET /relayer/pair/poll?code=<pair_code>      │
       ├─(every 2s)──────────────────────────────────▶│
       │  ◀──{status: "pending"}───────────────────────┤ (until callback)
       │                                               │
       │  GET /relayer/pair/poll (after callback)      │
       ├──────────────────────────────────────────────▶│
       │  ◀──{status: "ready", access_token,           │
       │      storefront_token, scopes, refresh_token, │
       │      token_expires_at, relay_secret}──────────┤
       │                                               │
       │  write tokens + relay_secret to local SQLite  │
       │  delete pair session                          │
       │                                               │
       │  POST /relayer/pair/consume?code=...          │
       ├──────────────────────────────────────────────▶│
       │                                               │ purge pair, store
       │                                               │ shop_domain →
       │                                               │ connector_url in
       │                                               │ installation_registry
       │                                               │ (for GDPR forward +
       │                                               │  future refresh)
       │  ◀──{ok: true}────────────────────────────────┤
```

**Key properties:**

- `state` = `pair_code` — the same opaque 32-byte hex the CLI generated.
  Shopify's OAuth callback echoes it back; the relay uses it to match
  the inbound callback with the CLI that triggered it. No shared secret
  leaks to the merchant.
- Pair sessions have a hard 10-minute TTL. If the merchant doesn't
  approve in time, `/pair/poll` returns `status: expired` and the CLI
  tells them to re-run `acc init`.
- Tokens live on the relay **only** between the Shopify callback and
  the CLI's `/pair/consume`. After consume, pair session is purged; the
  only durable record is `shop_domain → connector_url` mapping + (for
  expiring tokens) encrypted `refresh_token`.

### 3.2 Token refresh flow (expiring tokens only)

Shopify apps created after 2024-Q4 issue offline tokens that expire.
Without a refresh path, those merchants' connectors would stop working
after the token lifetime (~24h). The relay hosts `client_secret` and
can exchange the stored `refresh_token` for a new access token.

```
┌──────────────┐                          ┌──────────────────────┐
│  Merchant    │                          │ api.siliconretail.com│
│  connector   │                          │     /relayer/*       │
└──────┬───────┘                          └──────────┬───────────┘
       │ (detect: token_expires_at within 1h)        │
       │                                             │
       │ POST /relayer/refresh {shop, refresh_token} │
       ├────────────────────────────────────────────▶│
       │                                             │ POST Shopify
       │                                             │ /admin/oauth/access_token
       │                                             │ with client_secret
       │                                             │ + refresh_token
       │                                             │
       │ ◀─{access_token, refresh_token,             │
       │    token_expires_at}────────────────────────┤
       │                                             │
       │ update local SQLite                         │
       │ update installation-store.tokenExpiresAt    │
```

Relay can rotate the `refresh_token` client-side; each successful
refresh returns a new one. Merchant connector always writes both back
to SQLite atomically.

### 3.3 GDPR webhook forwarding flow

Shopify's mandatory compliance webhooks
(`customers/data_request`, `customers/redact`, `shop/redact`) are
configured once per Partners app (single URL). The relay receives them
and forwards to the right merchant connector using the persistent
`shop_domain → connector_url` mapping.

```
┌──────────┐     POST /relayer/webhooks/gdpr/<topic>         ┌──────────┐
│ Shopify  ├────────────────────────────────────────────────▶│  Relay   │
└──────────┘  HMAC-signed with client_secret                 └────┬─────┘
                                                                  │ verify HMAC
                                                                  │ look up
                                                                  │ shop→url
                                                                  ▼
                                                          shop domain
                                                          lookup hit?
                                                             │
                                                   ┌─────────┴─────────┐
                                                   │                   │
                                                   ▼                   ▼
                                             found                 not found
                                               │                     │
                                               ▼                     ▼
                                      forward to merchant     log + 200 OK
                                      connector's           (uninstalled, but
                                      /webhooks/gdpr/<t>     Shopify still
                                                             retries — must
                                                             always 2xx)
```

**Critical:** the relay must return 2xx to Shopify within ~5s regardless
of merchant-connector reachability. If the merchant is offline, log the
event to a dead-letter queue and retry forwarding later. Shopify will
not retry a 2xx forever; a missed GDPR forward is a compliance incident
logged under the relay operator's audit trail.

## 4. HTTP API contract

All endpoints are unauthenticated at the HTTP layer; individual methods
rely on Shopify's HMAC (callback + GDPR webhooks) or on the
merchant-held `refresh_token` (acting as a capability).

All paths below are rooted at `https://api.siliconretail.com/relayer`.
The marketplace's own routes (e.g. `POST /v1/submissions`) live as
siblings under the same domain; the relay is mounted behind the same
reverse proxy via path-routing on `/relayer/*`.

### `POST /relayer/pair/new`

**Request:**
```json
{
  "shop_domain": "myshop.myshopify.com",
  "connector_url": "https://acc.myshop.com"
}
```

- `shop_domain` — merchant's Shopify domain, ends in `.myshopify.com`,
  lowercased. Validation: matches `/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/`.
- `connector_url` — merchant's self-hosted ACC public URL, must be
  `https://`. Used later for GDPR forwarding + capacity decisions. Not
  verified reachable here (CLI can pair from a laptop before the connector
  is publicly up; connector comes online after install).

**Response 200:**
```json
{
  "pair_code": "a3f2b8...",          // 32-byte hex
  "install_url": "https://myshop.myshopify.com/admin/oauth/authorize?client_id=...&scope=...&redirect_uri=...&state=<pair_code>",
  "poll_url": "https://api.siliconretail.com/relayer/pair/poll?code=<pair_code>",
  "expires_in": 600
}
```

**Response 429:** rate-limited (10/min/IP in MVP; swap for Cloudflare
Turnstile when abuse materializes).

**Response 503:** `{"error": "capacity_exhausted"}` when approaching the
50-store cap (warn at 45, hard-stop at 50).

### `GET /relayer/pair/poll?code=<pair_code>`

**Response 200 (pending):**
```json
{ "status": "pending", "expires_in": 430 }
```

**Response 200 (ready):**
```json
{
  "status": "ready",
  "shop_domain": "myshop.myshopify.com",
  "access_token": "shpat_...",
  "storefront_token": "...",
  "scopes": ["read_products", "read_inventory", "read_orders", "write_orders"],
  "refresh_token": null,              // null for non-expiring offline tokens
  "token_expires_at": null            // unix ms; null for non-expiring
}
```

**Response 410:** `{"status": "expired"}` — TTL hit before callback.

**Response 404:** `{"status": "unknown"}` — pair_code was never issued or
already consumed.

### `POST /relayer/pair/consume`

**Request:**
```json
{ "pair_code": "a3f2b8..." }
```

**Response 200:** `{"ok": true}`. Purges the in-memory pair session (so
a replayed `/pair/poll` returns 404). Idempotent.

### `GET /relayer/auth/shopify/callback`

Shopify-signed redirect. Query params: `code`, `state`, `hmac`, `shop`,
`timestamp`. Relay-side:

1. Verify `hmac` with `client_secret`.
2. Verify `timestamp` is within ±5min of now.
3. Look up pending pair session by `state`.
4. Exchange `code` for token at Shopify's token endpoint using
   `client_secret`.
5. Mint a Storefront token via `storefrontAccessTokenCreate` (best-
   effort, non-fatal on failure).
6. Persist pair session (ready).
7. Render an HTML "You can close this tab" success page.

### `POST /relayer/refresh`

**Request:**
```json
{
  "shop_domain": "myshop.myshopify.com",
  "refresh_token": "shprt_..."
}
```

**Response 200:**
```json
{
  "access_token": "shpat_...",
  "refresh_token": "shprt_...",      // rotated
  "token_expires_at": 1712598400000
}
```

**Response 401:** `{"error": "invalid_refresh_token"}` — forwards
Shopify's refusal. The connector should treat this as a signal to
trigger a full re-install (`acc shopify connect` via the CLI).

Auth: anyone holding a valid `refresh_token` can call this; the
`refresh_token` is itself the secret. Rate-limit to 60/hr/shop to catch
buggy connectors stuck in refresh loops.

### `POST /relayer/webhooks/gdpr/:topic`

`:topic` ∈ `{customers_data_request, customers_redact, shop_redact}`.
HMAC-signed with `client_secret`. Relay verifies signature, looks up
`shop_domain → connector_url`, forwards the request body to
`{connector_url}/webhooks/gdpr/{topic}` within 5 seconds. Returns 2xx to
Shopify unconditionally; queue for retry if forwarding fails.

## 5. Data model

Two persistent stores + one in-memory TTL cache.

### 5.1 In-memory: pair sessions

`Map<pair_code, PairSession>` with TTL-based eviction. Optional spill to
SQLite on graceful shutdown so restarts don't orphan in-flight installs.
Each record:

```typescript
interface PairSession {
  pairCode: string;
  shopDomain: string;
  connectorUrl: string;
  createdAt: number;              // ms
  expiresAt: number;              // ms
  status: "pending" | "ready" | "consumed";
  // Populated only after successful callback
  accessToken?: string;
  storefrontToken?: string | null;
  scopes?: readonly string[];
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
}
```

### 5.2 Durable: installation registry

The long-lived record of which shops installed via this relay. Table
`relay_installations`:

```sql
CREATE TABLE relay_installations (
  shop_domain       TEXT PRIMARY KEY,
  connector_url     TEXT NOT NULL,
  installed_at      INTEGER NOT NULL,
  uninstalled_at    INTEGER,
  refresh_token_enc TEXT,          -- AES-256-GCM, key from RELAY_ENC_KEY
  scopes            TEXT NOT NULL, -- comma-separated
  last_refresh_at   INTEGER
);
CREATE INDEX relay_installations_active ON relay_installations (shop_domain) WHERE uninstalled_at IS NULL;
```

Encryption key `RELAY_ENC_KEY` is a 32-byte hex value in relay's env;
different from `ACC_ENCRYPTION_KEY` on any merchant's connector.

### 5.3 Dead-letter queue (for GDPR forwarding retries)

Table `relay_gdpr_dlq`:

```sql
CREATE TABLE relay_gdpr_dlq (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain       TEXT NOT NULL,
  topic             TEXT NOT NULL,
  payload           TEXT NOT NULL,      -- raw JSON body
  shopify_hmac      TEXT NOT NULL,      -- preserved so forward can re-sign
  received_at       INTEGER NOT NULL,
  attempt_count     INTEGER DEFAULT 0,
  next_retry_at     INTEGER NOT NULL,
  forwarded_at      INTEGER,
  last_error        TEXT
);
```

Simple exponential-backoff worker: 1m → 5m → 30m → 2h → 12h → give up +
log audit event. The forwarder preserves Shopify's original HMAC so
the merchant's connector can independently verify (it already has the
shared-app `client_secret` via public Partners app config — wait, no,
in the shared-relay scenario the merchant does NOT have `client_secret`.
Need to think about this).

**Open design question — GDPR forwarding auth:** how does the merchant
connector verify that a GDPR webhook the relay forwards genuinely came
from Shopify? Two options:

- **(a)** Relay re-signs the forwarded body with a per-shop secret the
  merchant received during `/pair/consume`. Adds a `relay_secret` field
  to the pair-complete payload; merchant stores it alongside tokens.
- **(b)** Relay wraps the original Shopify HMAC + timestamp in a new
  signed envelope; merchant's connector trusts the relay's public key
  (bootstrapped at install time).

Option (a) is simpler. Go with (a) unless we discover it fails a
compliance checklist.

## 6. Security

### 6.1 Trust model

- **Merchant trusts the relay operator to:** hold `client_secret` in
  confidence, not impersonate the merchant on Shopify, forward GDPR
  webhooks faithfully.
- **Merchant does NOT trust the relay with:** order data, product
  catalog, customer PII at runtime, payments. None of these flow
  through the relay.
- **Relay operator trusts the merchant's connector URL is correct.**
  Wrong `connector_url` means GDPR webhooks get forwarded to the wrong
  place; acceptable because the merchant who supplied the URL owns both
  sides.

### 6.2 Secrets on the relay

- `SHOPIFY_CLIENT_ID` (non-sensitive; visible in all OAuth URLs)
- `SHOPIFY_CLIENT_SECRET` (the big secret; never leaves the relay
  process)
- `RELAY_ENC_KEY` (32-byte AES-256 key for `refresh_token_enc`)
- `DATABASE_URL` (Postgres credentials)
- All loaded from env; never logged; validated at startup.

Leak blast radius: if the relay's filesystem or env is compromised,
**every installed shop's OAuth session is at risk** — attacker can refresh
tokens, read store data via Admin API. Mitigation: single-purpose host,
no other services colocated, filesystem encrypted at rest, rotate
`SHOPIFY_CLIENT_SECRET` in Partners + force all merchants to re-install
if compromise is suspected.

### 6.3 Rate limiting

- `/pair/new` — 10/min per source IP, 100/hour per IP. Refuse
  anonymous IPs at the WAF edge (Cloudflare Turnstile challenge).
- `/pair/poll` — unlimited (clients poll every 2s normally).
- `/refresh` — 60/hr per `shop_domain`.
- `/webhooks/gdpr/*` — no rate limit (Shopify expects 2xx; backpressure
  handled via DLQ).

### 6.4 HMAC timing-safe comparison

All HMAC verification in relay uses `crypto.timingSafeEqual`. No
string `===` comparisons on auth bytes. Reuse the connector's existing
`verifyCallbackHmac` helper (already does this) — extract to a shared
package if relay can't depend directly on `@acc/connector/shopify-oauth`.

## 7. Operational concerns

### 7.1 50-store capacity

Shopify's Custom Distribution model caps at 50 installs per app.
Monitoring:

- Count `relay_installations WHERE uninstalled_at IS NULL` on each
  `/pair/new`.
- Warn at 45/50 (log, optional Slack/PagerDuty webhook).
- Hard-stop at 50: `/pair/new` returns 503 with a user-facing message
  pointing to the per-merchant Partners flow as the overflow path.
- Operator can manually purge abandoned installs (not yet had an OAuth
  completion in >30 days) via a one-off SQL/script.

At 50 merchants the operator must either (a) submit the app to Shopify
App Store review, or (b) accept the cap as a soft cap on Silicon
Retail's ecosystem size.

### 7.2 Uninstall detection

Shopify's `app/uninstalled` webhook is a **standard app-specific webhook**
the relay must register per-shop after each install. When received, mark
`relay_installations.uninstalled_at = now()`. This frees up a slot for a
future `/pair/new` and stops the GDPR forward.

### 7.3 Logging

Structured JSON logs to stdout:

```json
{"ts":"2026-04-18T10:00:00Z","lvl":"info","op":"pair.new","shop":"foo.myshopify.com","pair_code":"a3f2b8...","connector_url":"https://acc.foo.com"}
{"ts":"...","lvl":"info","op":"oauth.callback.ok","shop":"foo.myshopify.com","scopes":4,"refresh_enabled":true}
{"ts":"...","lvl":"warn","op":"gdpr.forward.dlq","shop":"foo.myshopify.com","topic":"customers_redact","attempt":3,"err":"ECONNREFUSED"}
```

Never log `access_token`, `refresh_token`, `client_secret`, or raw
webhook payloads (they may contain PII per Shopify's schema). Hash
pair codes when logging them.

### 7.4 Health and metrics

- `GET /health` — returns 200 if DB reachable + Shopify OAuth endpoint
  reachable.
- `GET /metrics` — Prometheus text format: active_pairs_gauge,
  installs_completed_counter, refresh_calls_counter, gdpr_forward_errors.
- Alerting (configured by operator): sustained dlq backlog > 10,
  refresh failure rate > 5%, capacity > 45.

### 7.5 Deployment

The relay deploys as a sibling service to the marketplace API, both
behind the same `api.siliconretail.com` reverse proxy.

Requirements:

- Same Postgres instance as the marketplace (shared DB cluster, separate
  schema: `relayer_*` tables). ~20 MB for 50 shops + DLQ; negligible
  next to the marketplace's own storage.
- 512 MB RAM for the relay process (separate from the marketplace's
  process; different failure domain).
- Reverse proxy (nginx / Caddy / Cloudflare) routes `/relayer/*` → relay
  service on localhost; everything else on `api.siliconretail.com` →
  marketplace service.
- Cloudflare in front for TLS termination + DDoS protection + HTTP/2
  keepalive on `/relayer/pair/poll` long-polling.

Deployment artifact: a Dockerfile in `services/relayer/` of the private
`acc-marketplace` repo. Infrastructure-as-code lives with the
marketplace's existing deploy tooling. No public Dockerfile ships — the
protocol spec is public, the specific implementation is not.

## 8. CLI integration

### 8.1 New flag: `--via=siliconretail`

```bash
acc init shopify --via=siliconretail
```

When set, the wizard replaces step 7 (Shopify Partners creds) with a
pair/poll interaction. Prompts:

1. Shop domain (validated `*.myshopify.com`)
2. POST `/pair/new` → get install URL
3. Print URL + ASCII box (existing `ui.highlightUrl`)
4. `Press Enter to open in browser (Ctrl+C to abort)`
5. `openBrowser(installUrl)` + poll `/pair/poll` every 2s with a
   countdown spinner (existing `ui.spinner`)
6. On `status: ready` → write tokens to local SQLite installation-store
   (encrypted with merchant's `ACC_ENCRYPTION_KEY`) → POST
   `/pair/consume` to release relay state
7. Write `.env`:
   ```
   ACC_INSTALL_RELAY_URL=https://api.siliconretail.com/relayer
   SHOPIFY_STORE_URL=https://<shop>.myshopify.com
   SHOPIFY_CLIENT_ID=relay-hosted
   SHOPIFY_CLIENT_SECRET=
   ACC_RELAY_SECRET=<per-shop value from /pair/poll response>
   ```
   Empty `SHOPIFY_CLIENT_SECRET` is a marker: connector detects it +
   routes refresh via `ACC_INSTALL_RELAY_URL` instead of calling
   Shopify directly. `ACC_RELAY_SECRET` is the per-shop HMAC key the
   connector uses to verify GDPR webhooks forwarded from the relay
   (§5.3 option a).

Without the flag, step 7 runs the existing per-merchant Partners path.

### 8.2 Connector refresh worker

When `ACC_INSTALL_RELAY_URL` is set and any row in
`shopify_installations` has a non-null `token_expires_at`, the connector
runs a background worker:

- Every 15 minutes: SELECT rows with `token_expires_at - now() < 1h`.
- For each: POST `${ACC_INSTALL_RELAY_URL}/refresh` with
  `{shop_domain, refresh_token}`.
- On 200: UPDATE the row with new access token + refresh token +
  expiry.
- On 401: mark the row `uninstalled_at = now()` and log — forces the
  merchant to re-run `acc shopify connect --via=siliconretail`.

### 8.3 Wizard step changes summary

Shared-relay variant of step 7:
- label: `7/10 Shopify Partners creds (via Silicon Retail)`
- replaces interactive Partners cred prompts with pair/poll
- step 8 (SQLite migration) still runs — only the contents differ
- step 9 + 10 unchanged

## 9. Milestones

Each milestone is independently mergeable and adds a testable surface.

### M1. Relay core + public protocol spec (1 week)

**Private repo (`acc-marketplace`):**
- New `services/relayer/` with HTTP server + three routes:
  `/relayer/pair/new`, `/relayer/pair/poll`, `/relayer/auth/shopify/callback`
- In-memory `PairStore` with TTL
- Shopify OAuth primitives: HMAC verification + code→token exchange.
  These are copied from `@acc/connector/shopify-oauth` (public repo) —
  the private server doesn't depend on the public package at runtime
  so that a future connector version bump doesn't force a relay redeploy.
- Unit tests: HMAC verification, pair TTL, code→token happy path +
  failure modes.
- Dockerfile in `services/relayer/` wired into the marketplace's
  existing deploy pipeline.
- No DB yet; memory-only pair sessions.

**Public repo (`Agentic-Commerce-Connector`):**
- `docs/spec/relayer-protocol.md` — normative spec for the pair/poll +
  refresh protocol. HTTP endpoints, request/response schemas, HMAC
  scheme, pair TTL semantics, error codes. This is what any sibling
  operator implements if they want their own relay.
- Ships in the same Phase 2 release as the connector CLI changes.

### M2. CLI `--via=siliconretail` flag (3 days)

**Public repo only:**
- Parse `--via` in `init.ts`; accept values `siliconretail` (points at
  `api.siliconretail.com/relayer`) or a custom URL (for sibling
  operators running their own relay per the protocol spec from M1).
- Write the alt step 7 flow (or a step 7b wrapper) that calls the
  pair/poll endpoints defined by the spec.
- Default relay URL is configurable via `ACC_DEFAULT_RELAY_URL` env at
  build time so the public binary points at Silicon Retail but a fork
  can swap it without code changes.
- Integration test: run CLI against a local relay container (served
  from the private repo's Dockerfile); assert tokens land in merchant
  SQLite.
- Documentation: README Quick Start adds the alt install block;
  MERCHANT_ONBOARDING Appendix links to the protocol spec.

### M3. Durable installation registry + `/pair/consume` (3 days)

**Private repo only:**
- Postgres-backed `relay_installations` table (same cluster as
  marketplace, schema `relayer_*`).
- `/relayer/pair/consume` purges pair cache + persists registry row.
- Encrypted `refresh_token_enc` storage — AES-256-GCM with
  `RELAY_ENC_KEY` loaded from the marketplace's secret manager.
- Per-shop `relay_secret` generated at consume time and persisted in
  the registry; returned to the CLI in the final `/pair/poll` response
  so the merchant's `.env` picks it up (§5.3 option a).

### M4. Token refresh (`/relayer/refresh` + connector worker) (4 days)

**Private repo:** relay route — call Shopify's refresh endpoint, rotate
stored `refresh_token_enc`, return new access token + new expiry.

**Public repo:** connector worker —

- Runs every 15 minutes (no cron state; just `setInterval` scoped to
  the `acc start` process lifetime; unreferenced via `unref()` so it
  doesn't hold the process open).
- On each tick: SELECT rows with `token_expires_at - now() < 1h`.
- For each: POST `${ACC_INSTALL_RELAY_URL}/refresh` with
  `{shop_domain, refresh_token}`.
- On 200: UPDATE the row atomically with new access token + refresh
  token + expiry.
- On 401: mark the row `uninstalled_at = now()` and log — forces the
  merchant to re-run `acc shopify connect --via=siliconretail`.

Unit tests on both sides: successful refresh, token rotation, 401
handling, deadline-window math.

### M5. GDPR webhook forwarding (4 days)

**Private repo:**
- `POST /relayer/webhooks/gdpr/:topic` route with Shopify HMAC verify.
- Per-shop lookup in `relayer_installations`, forward body to
  `{connector_url}/webhooks/gdpr/{topic}`.
- Relay re-signs the forwarded body with the per-shop `relay_secret`
  (HMAC-SHA256), attaches as `X-ACC-Relay-Signature` header +
  `X-ACC-Relay-Timestamp` for replay protection.
- `relayer_gdpr_dlq` table + exponential-backoff retry worker
  (1m → 5m → 30m → 2h → 12h → audit-log + drop).
- Returns 2xx to Shopify unconditionally (compliance invariant).

**Public repo:**
- Connector's existing `/webhooks/gdpr/*` handlers accept the
  relay-signed envelope as an additional valid source: if
  `X-ACC-Relay-Signature` is present, verify with `ACC_RELAY_SECRET`
  from `.env`; otherwise fall back to Shopify-direct HMAC verification
  (for non-relay installs).

### M6. Ops polish + launch (5 days)

**Private repo:**
- `/relayer/health` (liveness + DB ping) + `/relayer/metrics` (Prom
  text format: active_pairs, installs_completed, refresh_calls,
  gdpr_forward_errors).
- Capacity monitoring: warn at 45/50 in structured logs; hard-stop at
  50 returning 503 from `/pair/new` with pointer to the per-merchant
  Partners fallback.
- Uninstall webhook handling: mark `uninstalled_at = now()` to free a
  slot + cancel any pending refresh.
- Load test: 50 concurrent `/relayer/pair/new` + 50 sustained
  `/relayer/pair/poll` long-polls, assert no goroutine / connection
  leaks, p99 latency targets.
- Deploy to `api.siliconretail.com/relayer` via the marketplace's
  deploy pipeline; reverse proxy path-routing wired.
- Register Shopify Partners app under the "Silicon Retail" brand;
  fill privacy policy + support URLs pointing at siliconretail.com.

**Solo-ops runbook** (required, new in v0.6.0 since @ciphertang is the
only on-call):

- `docs/ops/relayer-runbook.md` (private repo). Covers:
  - How to read `journalctl -u relayer` logs and what each structured
    event means.
  - Top 5 failure modes + diagnosis:
    1. Shopify returns 401 on token exchange (client_secret rotated?)
    2. DLQ backlog climbing (merchant connector down?)
    3. Pair session expires before poll returns ready (network
       latency? CLI bug?)
    4. Capacity at 50 (list of stale installs to purge vs. start App
       Store submission)
    5. Database connection pool exhausted (marketplace and relay
       share; bump pool size)
  - Emergency procedures: rotate `SHOPIFY_CLIENT_SECRET` (updates
    Partners + forces all merchants re-install); revoke a specific
    merchant's tokens (malicious actor case); purge all pair sessions
    + clear DLQ.
  - How to manually run `/relayer/refresh` for one shop from a
    maintenance shell (bypass the connector-side worker for testing).

**Public repo:**
- DPA template: `docs/legal/DPA-silicon-retail-relay.md` — merchant
  can self-serve, no need to contact operator.
- Tag connector `v0.6.0`, update README with the alt install path and
  prominent "runtime doesn't touch the relay" reassurance.

**Total estimate: ~4 weeks one person.** (M1 1wk + M2 3d + M3 3d + M4 4d + M5 4d + M6 5d ≈ 24 working days.)

## 10. Risks and open questions

### 10.1 Known risks

- **50-store cap materializes before App Store listing is ready.**
  Mitigation: capacity alerting at 45; per-merchant Partners fallback
  is always available.
- **Shopify changes OAuth URL formats / HMAC scheme.** Low probability
  but high impact (breaks all relay installs). Covered by unit tests
  against real Shopify OAuth spec + a manual re-verification after
  each Shopify quarterly release.
- **DPA not in place by launch.** Hard blocker for EU merchants.
  Mitigation: legal review on M6 critical path, not last-minute.
- **Relay DoS via `/pair/new` spam consuming Partners app's install
  slots.** Mitigation: rate limit + Cloudflare Turnstile + abandoned-
  pair cleanup.

### 10.2 Open questions — resolved 2026-04-19

All five questions resolved by the project owner before M1 kickoff.

1. **Stream A / Stream B sequencing — decided: serial, A first.**
   Stream B (Nexus payment wiring) is deferred until Stream A ships.
   Merchants who install via the relay publish a skill.md with
   `supported_payments: []` and wait for a later release to enable
   a rail. No parallel work on payment providers during v0.6.0.
2. **Repo location — decided: private `acc-marketplace` repo.** Server
   implementation lives in `services/relayer/`; the protocol spec
   (`docs/spec/relayer-protocol.md`) ships in the public
   `Agentic-Commerce-Connector` repo so the wire protocol is auditable
   and any sibling operator can implement a compatible relay. No
   public Dockerfile / source for the server.
3. **GDPR forwarding auth — decided: (a), per-shop `relay_secret`.**
   Delivered in the final `/pair/poll` response; stored in merchant's
   `.env` as `ACC_RELAY_SECRET`; used by relay to HMAC-sign forwarded
   GDPR bodies via `X-ACC-Relay-Signature`.
4. **Refresh cadence — decided: 15 minutes.** Connector-side worker
   runs `setInterval(15 * 60 * 1000).unref()` scoped to `acc start`
   process lifetime.
5. **On-call — decided: @ciphertang (solo).** M6 scope expanded by
   +2 days for `docs/ops/relayer-runbook.md` (in the private repo)
   covering top-5 failure modes, emergency procedures, and one-off
   maintenance commands.

## 11. Entry criteria

Before M1 kickoff:

- [x] Phase 1 (feat/binary-install) merged to main + `v0.4.0` tagged (2026-04-19)
- [ ] At least one pilot merchant has run Phase 1 end-to-end against a
      real Shopify store (validating that the per-merchant path works
      before we add a second path that depends on the same connector
      runtime)
- [ ] Silicon Retail Shopify Partners app created with the shared
      Custom Distribution configuration (App URL, Support URL,
      Privacy Policy URL all under `siliconretail.com`)
- [ ] `api.siliconretail.com` reverse proxy configured to path-route
      `/relayer/*` to the relay service (sibling to the marketplace
      API on the same domain + TLS cert)
- [ ] DPA template drafted for legal review (can run in parallel with
      M1)
- [x] Open questions §10.2 all resolved (2026-04-19)

## 12. Out-of-scope for v0.6.0

- Web dashboard for the maintainer to see active installs
- Per-merchant billing / usage tracking through the relay
- Multi-region relay deployment
- OAuth scope upgrades via relay (merchant-initiated re-install still
  requires re-running `acc init shopify --via=siliconretail`)
- Relay code audit by an external security firm (deferred to v0.7+)
