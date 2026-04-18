# Merchant Onboarding — Shopify → Connector → Silicon Retail Marketplace

**Audience:** Shopify store owners who want AI agents to be able to browse and buy from their store via the Agentic Commerce Connector (ACC), and who want their store listed in the Silicon Retail Marketplace.

**Outcome after this doc:**
1. Your Shopify store is connected to a self-hosted ACC connector via OAuth.
2. Agents can hit your store through the connector's UCP/1.0 endpoint.
3. Your store is registered in the marketplace via an EIP-712-signed skill package.
4. Future updates (catalog changes, new payment methods, new contact info) are published with a single command.

---

## 0 · Prerequisites

| You need | Why | Where |
|---|---|---|
| A Shopify store (any plan) | Source of products / checkout | `myshop.myshopify.com` |
| A Shopify Partners account (free) + configured app | To issue OAuth credentials | Follow **[SHOPIFY_PARTNERS_SETUP.md](./SHOPIFY_PARTNERS_SETUP.md)** — ~10 minutes, one-time |
| A host for the ACC connector | Must have **public HTTPS** | Render / Fly / your own VPS + Cloudflare Tunnel |
| A wallet you control | Sign marketplace submissions | MetaMask / any EOA; keep the private key safe |

> **Payment rails.** Phase 1 ships without any payment provider wired end-to-end. `acc init` step 6 records your selection (currently only "none") and the published skill advertises `supported_payments: []`. Nexus/PlatON, Stripe, and x402 support arrive in upcoming releases — a payout wallet isn't needed until then.

Local-only testing is possible using `ngrok` / Cloudflare Tunnel for the HTTPS callback, or by using the manual-token fallback (see §A).

**Do the Partners setup first.** `acc init shopify` will ask for the
`client_id` and `client_secret` that only exist after you've configured
a Partners app with your connector's URLs. The [SHOPIFY_PARTNERS_SETUP](./SHOPIFY_PARTNERS_SETUP.md)
doc walks through it in ~10 minutes; doing it later means interrupting the
wizard mid-flow.

---

## Part 1 · Install and configure the connector

### 1.1 Deploy ACC

Two paths, pick whichever matches your infra:

**Path A — Binary install on any host with public HTTPS (recommended):**

```bash
curl -fsSL https://www.siliconretail.com/install.sh | sh
```

Installs `acc` to `~/.acc/bin/`. Zero deps. You're responsible for
putting a public HTTPS reverse proxy in front of port 10000.

**Path B — One-command VPS deploy (fresh Debian/Ubuntu box):**

```bash
curl -fsSL https://www.siliconretail.com/install-server.sh | \
  ACC_PUBLIC_HOSTNAME=acc.myshop.com sudo bash
```

Handles the system user, binary, nginx/Caddy, Let's Encrypt TLS, systemd,
and the init wizard in one shot.

**Path C — Build from source (dev):** `git clone` + `npm install && npm run build`.

In all three cases, note the public URL — we'll call it `ACC_URL` below,
e.g. `https://acc.myshop.com`.

### 1.2 Create your Shopify Partners app

Follow **[SHOPIFY_PARTNERS_SETUP.md](./SHOPIFY_PARTNERS_SETUP.md)** — ~10
minutes. The doc walks through:

- Creating a free Partners account
- Creating a Custom Distribution app (no App Store review required)
- Configuring App URL + redirect URL to match your `ACC_URL`
- Setting API scopes (`read_products`, `read_inventory`, `read_orders`, `write_orders`)
- Configuring the three mandatory GDPR webhook URLs
- Filling Privacy Policy + Support URLs
- Copying out `client_id` + `client_secret`

You'll paste those two credentials into the wizard in §1.3.

### 1.3 Run `acc init shopify` (one-shot wizard)

If you used Path A or C, run from your preferred working directory:

```bash
acc init shopify
```

Path B runs this for you during the server bootstrap.

The 10-step wizard:

1. **Preflight** — runtime checks.
2. **Data directory** — creates `~/.acc/{keys,skill,db}` (binary install) or `./acc-data/{...}` (source install) with 0700 perms.
3. **Public URL** — prompts for `${ACC_URL}` (your public HTTPS), stored as `SELF_URL`.
4. **Encryption key** — generates a 32-byte AES-256 key at `keys/enc.key` (0600) and mirrors to `.env: ACC_ENCRYPTION_KEY`.
5. **Marketplace signer** — generate a new EOA, import an existing `0x…` hex key, or skip. Writes `keys/signer.key` (0600). Optional at-rest encryption via `--encrypt-signer`.
6. **Payment methods** — asks which payment rails your storefront accepts. Phase 1 ships with only one option: **"No payment methods yet"**. Writes `PAYMENT_PROVIDER=none` to `.env`; the published skill advertises `supported_payments: []`. Additional rails (Nexus/PlatON, Stripe, x402) arrive in future releases — re-run `acc init` (choice `b`) when they land to pick one.
7. **Shopify Partners creds** — prints the exact App URL / redirect URL / scopes you should have pasted into Partners (sanity check), then prompts for `client_id` + `client_secret`.
8. **SQLite migration** — creates `db/acc.sqlite` with the `shopify_installations` table.
9. **Categories (multi-select)** — pick one or more from the Silicon Retail taxonomy: **Fashion / Electronics / Books / Home / Food / Services / Digital / Travel**. Type comma-separated letters (e.g. `a,c,h` → Fashion, Books, Travel). Order is preserved by catalog position (not input order) so the published frontmatter is deterministic.
10. **Skill template** — writes `skill/acc-skill.md` with your selected categories and auto-derived name/URLs. Auto-served at `${ACC_URL}/.well-known/acc-skill.md` (see Part 2).

Finale prints `config.json` summary + next-step pointer.

**Re-running:** `acc init shopify` detects an existing `config.json` and offers: keep-as-is / update-Shopify-creds-only / start-over (backs up old config) / cancel.

### 1.4 Connect your Shopify store

Start the connector first:

```bash
acc start
```

Then either:

- **Interactive:** `acc shopify connect --shop=<your-store>.myshopify.com` — prints the install URL + a terminal QR code, and polls the local SQLite store until the shop completes install.
- **Manual:** visit `${ACC_URL}/auth/shopify/install?shop=<your-store>.myshopify.com` in any browser.

You'll be redirected to Shopify's consent screen. Approve the scopes. On callback the connector will:

1. Verify the HMAC signature and `state` nonce.
2. Exchange the authorization `code` for an offline `access_token`.
3. Call `storefrontAccessTokenCreate` to mint a Storefront API token.
4. Register the `app/uninstalled` webhook (plus the GDPR-mandatory webhooks).
5. Persist everything (encrypted) into `shopify_installations`.

Confirm at `${ACC_URL}/admin/shopify` — you should see **Connected to `<shop>`** with the granted scopes listed.

### 1.5 Smoke-test the UCP façade

```bash
curl ${ACC_URL}/ucp/v1/skills
curl ${ACC_URL}/ucp/v1/catalog/search?q=<term>
```

If those return real products from your Shopify store, the connector is live.

---

## Part 2 · Your skill package is already live

Because your connector is already running on public HTTPS, it **hosts the
skill file itself** — no separate static site, GitHub Pages, or CDN
setup. `acc init shopify` at step 8 wrote a publish-ready template to
`acc-data/skill/acc-skill.md` (or `~/.acc/skill/acc-skill.md` for the
binary install), and the connector serves it at:

```
${ACC_URL}/.well-known/acc-skill.md
```

Verify:

```bash
curl ${ACC_URL}/.well-known/acc-skill.md
```

You should see the auto-generated markdown back. That URL is what
`acc publish` submits to the marketplace in Part 3 — no hosting step for you.

### 2.1 Auto-filled fields (no action needed)

The template at step 8 derives these from `config.json` + the platform
you picked, so they're already correct and stable across re-runs:

| Field | Auto-filled from |
|---|---|
| `name` | Hostname-derived (e.g. `https://acc.myshop.com` → "Myshop") |
| `skill_id` | Stable id derived from hostname (e.g. `myshop-acc`) |
| `supported_platforms` | The platform you chose in step 1 (e.g. `["shopify"]`) |
| `supported_payments` | Conservative default for your platform (e.g. `["shopify_payments"]`) |
| `health_url` | `${ACC_URL}/health` |
| `website_url` | Derived from the root domain of `${ACC_URL}` |

The body already links every `ucp/v1/*` endpoint and the skill URL itself.

### 2.2 Optional polish

If you want a punchier marketplace listing, open the file and tweak
these fields — nothing else is required:

- `description` — the one-line pitch buyers' agents show before browsing
- `categories` — e.g. `[apparel]`, `[electronics]`, `[food]`
- `tags` — free-form discovery hints, e.g. `[streetwear, made-in-usa]`
- `website_url` — your customer-facing storefront if different from what was derived

Re-run `acc publish` after any edit to refresh the marketplace's stored hash.

### 2.3 Advanced: host somewhere else

Most merchants should stop here — the connector's `/.well-known/`
endpoint is sufficient. If you have a specific reason to host the skill
file on a different URL (e.g. your marketing domain handles caching
better, or you want the skill file under `https://myshop.com/…` for brand
reasons), override it on publish:

```bash
acc publish --url=https://myshop.com/.well-known/acc-skill.md
```

You become responsible for keeping that URL's bytes in sync with the
connector's `/.well-known/acc-skill.md`. The marketplace verifies the
SHA-256 hash on its next refetch and surfaces a warning if they drift.

---

## Part 3 · Register in the marketplace

There is **no separate registration step**. The first EIP-712-signed submission the marketplace receives from your wallet is the registration. Subsequent submissions with the same `skill_id` are updates.

### 3.1 Publish

Zero-arg mode (recommended — reads `acc-data/config.json` + `keys/signer.key`):

```bash
acc publish
```

Or with explicit flags (for non-default configurations):

```bash
acc publish ./acc-skill.md \
  --url=https://myshop.com/.well-known/acc-skill.md \
  --registry=https://api.siliconretail.com \
  --private-key=0x<your-wallet-private-key>
```

Under the hood the CLI:

1. Reads and validates the frontmatter (`parseSkillMd`).
2. Computes `sha256` of the exact bytes of the file (`computeSkillSha256`).
3. Constructs a `MarketplaceSubmission` payload binding `{ wallet, skill_id, skill_url, skill_sha256, nonce, submitted_at }`.
4. Signs it with EIP-712 typed data using your wallet.
5. `POST`s `{ payload, signature }` to `${registry}/v1/submissions`.

On success you'll see:

```
Published "My Store" (my-store-v1)
  url:    https://myshop.com/.well-known/acc-skill.md
  sha256: 9f2a...
  wallet: 0x1234...
```

The marketplace then:
- Recovers the signer address from the signature.
- Fetches `skill_url`, re-hashes the bytes, and compares to `skill_sha256`.
- If hashes match, writes `{ skill_id, wallet, url, sha256, frontmatter }` into the directory index.

First submission ⇒ your wallet is implicitly registered. No email, no account, no password.

### 3.2 Verify the listing

Browse `https://siliconretail.com` and search for `skill_id` or `name`. The read-only web surface should show your store with the fields from your frontmatter. The connector's UCP endpoint is what agents actually call; the marketplace is only the signpost that tells them where to look.

---

## Part 4 · Updates

Any change — new products, new payment method, contact update, site rebrand — follows the same command. The flow is:

1. Edit `acc-skill.md` (or the data it points at).
2. Re-upload the hosted file so the bytes at `skill_url` change.
3. Run `acc-skill publish` again with the same `skill_id`.

Because the payload includes a fresh `nonce` and `submitted_at`, the marketplace accepts it as a new version. Because the signature must come from the same wallet that originally registered `skill_id`, nobody else can overwrite your entry.

```bash
# After editing acc-skill.md and re-hosting it
acc publish ./acc-skill.md \
  --url=https://myshop.com/.well-known/acc-skill.md \
  --registry=https://api.siliconretail.com \
  --private-key=0x...
```

### 4.1 Automating updates from CI

For an update cadence tied to your store (e.g. republish on every Shopify catalog change), wire a CI job:

```yaml
# .github/workflows/republish-skill.yml  (example)
on:
  schedule: [{ cron: "0 3 * * *" }]        # nightly
  workflow_dispatch:
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm i -g @acc/cli
      - run: |
          acc-skill publish ./acc-skill.md \
            --url=https://myshop.com/.well-known/acc-skill.md \
            --registry=https://api.siliconretail.com \
            --private-key=${{ secrets.ACC_SIGNER_KEY }}
```

Store `ACC_SIGNER_KEY` in your CI secret store. Use a wallet dedicated to signing (not your main treasury) so the blast radius of a leak is limited to "attacker can republish your own entry."

### 4.2 De-listing

Submit with `action: "delist"` (planned) or stop hosting the file at `skill_url` — the marketplace surfaces a broken-link state on its next integrity check.

---

## Part 5 · Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Install redirect loops | `SHOPIFY_OAUTH_REDIRECT` mismatch between `.env` and Partners config | Make them byte-identical, including trailing slash |
| `HMAC mismatch` on callback | `client_secret` wrong or truncated | Re-copy from Partners; watch for trailing whitespace |
| `invalid_request` on token exchange | `redirect_uri` doesn't match one of the allowed URLs | Add it in Partners → App configuration |
| `ACC_ENCRYPTION_KEY missing` on boot | OAuth mode requires it | `openssl rand -hex 32` and set it |
| Callback page 400 when running locally | Shopify rejects non-HTTPS redirect | Use Cloudflare Tunnel / `ngrok http 3000`, or fall back to Shape A (§A) |
| Marketplace returns `HASH_MISMATCH` | Bytes at `skill_url` differ from signed hash | Re-upload the exact file you signed, or re-sign after uploading |
| Marketplace returns `UNAUTHORIZED_WALLET` | You're publishing with a different wallet than registered | Use the original wallet, or sign a wallet-rotation payload (planned) |
| `/admin/shopify` shows scope-drift warning | Connector code needs more scopes than the install granted | Click **Reinstall to upgrade scopes** |

---

## Appendix A · Manual-token fallback (no OAuth)

If you can't put the connector on public HTTPS yet, use Shopify's **Develop apps → Custom app** path:

1. In Shopify admin → **Settings → Apps → Develop apps → Create an app**.
2. Toggle Admin scopes (`read_products`, `read_inventory`, `write_orders`, `read_orders`) and Storefront scopes (`unauthenticated_read_product_listings`, etc.).
3. Install the app on your store.
4. Copy the Admin API access token and Storefront API access token.
5. Set in `.env`:

   ```dotenv
   SHOPIFY_STORE_URL=https://myshop.myshopify.com
   SHOPIFY_ADMIN_TOKEN=shpat_...
   SHOPIFY_STOREFRONT_TOKEN=...
   # leave SHOPIFY_CLIENT_ID empty — config loader picks manual mode
   ```

Part 2 and Part 3 (skill package and marketplace publish) are unchanged — they're independent of how the connector acquired its Shopify credentials.

---

## Appendix B · How the pieces relate

```
┌─────────────────┐   OAuth offline token    ┌─────────────────┐
│  Shopify store  │ ────────────────────────▶│  ACC connector  │
└─────────────────┘                          │   (self-host)   │
                                             └────────┬────────┘
                                                      │ UCP/1.0 façade
                                                      │ @ ${ACC_URL}/ucp/v1
                                                      ▼
                                             ┌─────────────────┐
                                             │   AI agent(s)   │
                                             └────────▲────────┘
                                                      │ 1. look up
                                                      │
┌─────────────────┐  EIP-712 signed pointer  ┌────────┴────────┐
│    Your wallet  │ ────────────────────────▶│   Marketplace   │
└─────────────────┘                          │ siliconretail.* │
                                             └─────────────────┘
```

- **Shopify ↔ Connector:** OAuth once, scope upgrades via reinstall link.
- **Connector ↔ Agent:** UCP/1.0 REST at your own domain; marketplace is not in the runtime path.
- **Wallet ↔ Marketplace:** signed submissions; first signature = registration, later signatures = updates. Marketplace is a signpost, not a gateway.

## See also

- [docs/plans/2026-04-16-shopify-oauth-design.md](plans/2026-04-16-shopify-oauth-design.md) — OAuth flow design and security considerations.
- [docs/SKILL_SPEC.md](SKILL_SPEC.md) — skill package frontmatter schema.
- [docs/ucp-compliance.md](ucp-compliance.md) — UCP/1.0 conformance of the connector.
