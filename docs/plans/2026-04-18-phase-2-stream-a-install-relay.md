# Phase 2 Stream A — Silicon Retail install relay

**Status:** Draft, not yet implemented
**Author:** @ciphertang
**Date:** 2026-04-18
**Target ship:** `v0.6.0`

## 1. Summary

Add an **optional install path** for merchants who can't (or don't want to)
register their own Shopify Partners account. A maintainer-hosted relay
(`install.siliconretail.com`) holds a single shared Partners app's
`client_secret`, handles Shopify's OAuth callback, and hands freshly-minted
access tokens to the merchant's self-hosted ACC connector via a short-lived
pair session.

**Runtime remains relay-free.** Once the pair session completes, the
merchant's connector talks to Shopify Admin/Storefront APIs directly with
its own access token. Silicon Retail participates only during install and
(for 2024-Q4+ expiring tokens) periodic refresh.

## 2. Goals and non-goals

**Goals:**

- Merchant onboarding time drops from ~25 min (Partners setup + filling
  GDPR webhook URLs + privacy policy) to ~3 min (type shop domain, click
  one link, wait for CLI to confirm).
- Zero new trust placed on Silicon Retail at runtime — a merchant whose
  connector finished installing can survive the relay going offline
  permanently (for non-expiring offline tokens) or for the duration of a
  single access-token lifetime (for expiring tokens).
- Relay code lives in the public monorepo (`packages/install-relay/`) —
  any ecosystem operator can fork + self-deploy, there is no "closed"
  tier.
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

## 3. Architecture

### 3.1 Install flow

```
┌──────────────┐                          ┌─────────────────────────┐
│  Merchant's  │                          │   install.siliconretail │
│     CLI      │                          │     (maintainer host)   │
└──────┬───────┘                          └────────────┬────────────┘
       │  POST /pair/new {shop, connector_url}         │
       ├──────────────────────────────────────────────▶│
       │                                               │ issue pair_code
       │                                               │ state = pair_code
       │  ◀──{pair_code, install_url, poll_url, ttl}───┤
       │                                               │
       │  open browser → install_url                   │
       │  ▶ merchant approves on Shopify               │
       │                                               │
       │                                ┌──────────────┴──────────────┐
       │                                │  Shopify redirects:         │
       │                                │  GET /auth/shopify/callback │
       │                                │  ?code=...&state=<pair_code>│
       │                                │  &hmac=...&shop=...         │
       │                                └──────────────┬──────────────┘
       │                                               │ verify HMAC
       │                                               │ look up pair
       │                                               │ exchange code→tok
       │                                               │ mint storefront tok
       │                                               │ store tokens in
       │                                               │ pair session keyed
       │                                               │ by pair_code
       │                                               │
       │  GET /pair/poll?code=<pair_code>              │
       ├─(every 2s)──────────────────────────────────▶│
       │  ◀──{status: "pending"}───────────────────────┤ (until callback)
       │                                               │
       │  GET /pair/poll (after callback)              │
       ├──────────────────────────────────────────────▶│
       │  ◀──{status: "ready", access_token,           │
       │      storefront_token, scopes, refresh_token, │
       │      token_expires_at}────────────────────────┤
       │                                               │
       │  write tokens to local SQLite                 │
       │  delete pair session                          │
       │                                               │
       │  POST /pair/consume?code=...                  │
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
┌──────────────┐                          ┌──────────────────┐
│  Merchant    │                          │  install.silicon │
│  connector   │                          │      retail      │
└──────┬───────┘                          └────────┬─────────┘
       │ (detect: token_expires_at within 1h)      │
       │                                           │
       │ POST /refresh {shop, refresh_token}       │
       ├──────────────────────────────────────────▶│
       │                                           │ POST Shopify
       │                                           │ /admin/oauth/access_token
       │                                           │ with client_secret
       │                                           │ + refresh_token
       │                                           │
       │ ◀─{access_token, refresh_token,           │
       │    token_expires_at}──────────────────────┤
       │                                           │
       │ update local SQLite                       │
       │ update installation-store.tokenExpiresAt  │
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
┌──────────┐     POST /webhooks/gdpr/<topic>                 ┌──────────┐
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

### `POST /pair/new`

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
  "poll_url": "https://install.siliconretail.com/pair/poll?code=<pair_code>",
  "expires_in": 600
}
```

**Response 429:** rate-limited (10/min/IP in MVP; swap for Cloudflare
Turnstile when abuse materializes).

**Response 503:** `{"error": "capacity_exhausted"}` when approaching the
50-store cap (warn at 45, hard-stop at 50).

### `GET /pair/poll?code=<pair_code>`

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

### `POST /pair/consume`

**Request:**
```json
{ "pair_code": "a3f2b8..." }
```

**Response 200:** `{"ok": true}`. Purges the in-memory pair session (so
a replayed `/pair/poll` returns 404). Idempotent.

### `GET /auth/shopify/callback`

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

### `POST /refresh`

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

### `POST /webhooks/gdpr/:topic`

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

Host: single VPS (Render / Fly / DigitalOcean) behind Cloudflare.
Requirements:

- Postgres 14+ (~20 MB for 50 shops + DLQ)
- 512 MB RAM minimum
- Public HTTPS on `install.siliconretail.com` — Cloudflare handles TLS
  termination + DDoS
- `/pair/poll` benefits from HTTP/2 keepalive; Cloudflare does that
  automatically

Dockerfile ships as part of the subpackage for anyone who wants to
self-host a sibling relay.

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
   ACC_INSTALL_RELAY_URL=https://install.siliconretail.com
   SHOPIFY_STORE_URL=https://<shop>.myshopify.com
   SHOPIFY_CLIENT_ID=relay-hosted
   SHOPIFY_CLIENT_SECRET=
   ```
   Empty `SHOPIFY_CLIENT_SECRET` is a marker: connector detects it +
   routes refresh via `ACC_INSTALL_RELAY_URL` instead of calling
   Shopify directly.

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

### M1. Relay core: `/pair/new`, `/pair/poll`, `/auth/shopify/callback` (1 week)

- New `packages/install-relay/` with server + routes
- In-memory `PairStore` with TTL
- Reuse `verifyCallbackHmac` and `exchangeCodeForToken` from
  `@acc/connector/shopify-oauth` via the new package export
- Unit tests: HMAC verification, pair TTL, code→token happy path +
  failure modes
- Dockerfile + docker-compose for local dev
- No DB yet; memory-only

### M2. CLI `--via=siliconretail` flag (3 days)

- Parse the flag in `init.ts`
- Write the alt step 7 flow (or a step 7b wrapper)
- Integration test: run CLI against a local relay container; assert
  tokens land in merchant SQLite
- Documentation pass: README Quick Start adds the alt install block

### M3. Durable installation registry + `/pair/consume` (3 days)

- Postgres/SQLite-backed `relay_installations` table
- `pair/consume` purges pair cache + persists registry row
- Encrypted `refresh_token_enc` storage

### M4. Token refresh (`/refresh` + connector worker) (4 days)

- Relay route: call Shopify refresh endpoint, rotate stored
  `refresh_token_enc`, return new access token
- Connector worker: scheduled check, call relay, update local
  SQLite row atomically
- Unit tests: successful refresh, rotation, 401 handling

### M5. GDPR webhook forwarding (4 days)

- `POST /webhooks/gdpr/:topic` route with HMAC verify
- Per-shop lookup + forward
- DLQ table + exponential-backoff retry worker
- Relay re-signs with per-shop `relay_secret` (delivered in
  `/pair/consume` response; merchant stores)
- Connector's existing `/webhooks/gdpr/*` handlers accept the new
  relay-signed envelope as an additional valid source

### M6. Ops polish + launch (3 days)

- `/health` + `/metrics`
- Capacity monitoring at 45/50 with warn log
- Uninstall webhook handling → free slot
- DPA template (`docs/legal/DPA-relay.md`)
- Load test: 50 concurrent `/pair/new` + 50 sustained `/pair/poll`
  loops, assert no leaks
- Deploy relay to `install.siliconretail.com`
- Register Partners app under "Silicon Retail", fill privacy policy +
  support URL
- Tag connector `v0.6.0`, update README with the alt install path

**Total estimate: ~4 weeks one person.**

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

### 10.2 Open questions for resolution before M1 starts

1. Does Nexus, Phase 2 Stream B, land before or after Stream A? If
   before, Stream A's `skill.md` auto-emit includes `nexus-platon`
   in `supported_payments`; if after, Stream A ships with empty
   `supported_payments` until Stream B backfills. **Recommendation:
   Stream A and B in parallel.**
2. Public repo vs. private? **Recommendation: `packages/install-relay/`
   in the public monorepo.** Transparent code + anyone can self-host
   a sibling relay.
3. GDPR forwarding auth: option (a) per-shop relay_secret vs. option
   (b) relay's public-key envelope? **Recommendation: (a)**.
4. Refresh cadence on the connector side: wake every 15 min (simple)
   vs. wake exactly at `expires_at - 1h` (precise)? **Recommendation:
   15 min; simpler, no cron state.**
5. Who owns on-call for the relay in prod? If it's just @ciphertang,
   documentation for solo ops (diagnostic runbooks) needs to be in M6
   scope.

## 11. Entry criteria

Before M1 kickoff:

- [ ] Phase 1 (feat/binary-install) merged to main + `v0.4.0` tagged
- [ ] At least one pilot merchant has run Phase 1 end-to-end against a
      real Shopify store (validating that the per-merchant path works
      before we add a second path that depends on the same connector
      runtime)
- [ ] Silicon Retail Shopify Partners app created with the shared
      Custom Distribution configuration (App URL, Support URL,
      Privacy Policy URL all under `siliconretail.com`)
- [ ] `install.siliconretail.com` DNS + TLS provisioned (Cloudflare
      Origin Rule to Render service, or equivalent)
- [ ] DPA template drafted for legal review (can run in parallel with
      M1)
- [ ] Open questions §10.2 all resolved

## 12. Out-of-scope for v0.6.0

- Web dashboard for the maintainer to see active installs
- Per-merchant billing / usage tracking through the relay
- Multi-region relay deployment
- OAuth scope upgrades via relay (merchant-initiated re-install still
  requires re-running `acc init shopify --via=siliconretail`)
- Relay code audit by an external security firm (deferred to v0.7+)
