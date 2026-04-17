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
| A Shopify Partners account (free) | To create the OAuth app | `partners.shopify.com` |
| A host for the ACC connector | Must have **public HTTPS** | Render / Fly / your own box + Cloudflare Tunnel |
| A wallet you control | Sign marketplace submissions | MetaMask / any EOA; keep the private key safe |
| A stable HTTPS URL for the skill file | Marketplace fetches it | your domain, GitHub Pages, R2, etc. |

Local-only testing is possible using `ngrok` / Cloudflare Tunnel for the HTTPS callback, or by using the manual-token fallback (see §A).

---

## Part 1 · Install and configure the connector

### 1.1 Deploy ACC

Clone and deploy the public connector:

```bash
git clone https://github.com/<org>/Agentic-Commerce-Connector.git
cd Agentic-Commerce-Connector
```

Pick a hosting target (Render template: `render.yaml`; Docker: `docker-compose.yml`). After deploy, note the public URL — we'll call it `ACC_URL` below, e.g. `https://acc.myshop.com`.

### 1.2 Create a Shopify Custom-Distribution app

In the Partners portal → **Apps → Create app → Create app manually**:

- **App URL:** `${ACC_URL}/admin/shopify`
- **Allowed redirection URL(s):** `${ACC_URL}/auth/shopify/callback`
- **API scopes:** `read_products`, `read_inventory`, `write_orders`, `read_orders` (optional: `write_draft_orders`).

Copy the generated `client_id` and `client_secret`.

### 1.3 Run `acc init` (one-shot wizard)

From the cloned repo:

```bash
npm install && npm run build
npx acc init
```

The 8-step wizard:

1. **Preflight** — checks Node ≥ 20 and `better-sqlite3`.
2. **Data directory** — creates `./acc-data/{keys,skill,db}` with 0700 perms.
3. **Public URL** — prompts for `${ACC_URL}` (your public HTTPS), stored as `SELF_URL`.
4. **Encryption key** — generates a 32-byte AES-256 key at `acc-data/keys/enc.key` (0600) and mirrors to `.env: ACC_ENCRYPTION_KEY`.
5. **Marketplace signer** — generate a new EOA, import an existing `0x…` hex key, or skip. Writes `acc-data/keys/signer.key` (0600). Optional at-rest encryption via `--encrypt-signer`.
6. **Shopify Partners** — opens `partners.shopify.com` in your browser (or prints the URL if headless) and collects `client_id` / `client_secret` into `.env`.
7. **SQLite migration** — creates `acc-data/db/acc.sqlite` with the `shopify_installations` table.
8. **Skill template** — writes `acc-data/skill/acc-skill.md` ready for editing.

Finale prints `config.json` summary + the install link + next-step pointer.

**Re-running:** `acc init` detects an existing `acc-data/config.json` and offers: keep-as-is / update-shopify-creds-only / start-over (backs up old config) / cancel.

### 1.4 Connect your Shopify store

Start the connector first:

```bash
npm --workspace packages/connector start
```

Then either:

- **Interactive:** `npx acc shopify connect --shop=<your-store>.myshopify.com` — prints the install URL + a terminal QR code, and polls the local SQLite store until the shop completes install.
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

## Part 2 · Prepare your skill package

A **skill package** is a single Markdown file with YAML frontmatter. The frontmatter is what the marketplace indexes; the body is freeform documentation for humans and agents.

### 2.1 Generate a template

From the connector repo (or any install of `@acc/cli`):

If you ran `acc init`, the template is already at `acc-data/skill/acc-skill.md`. To regenerate elsewhere:

```bash
npx acc skill init --out ./acc-skill.md
```

### 2.2 Fill in the frontmatter

Edit `acc-skill.md`:

```yaml
---
name: My Store
description: Short one-line pitch for the marketplace listing (<= 280 chars).
skill_id: my-store-v1
categories: [apparel]
supported_platforms: [shopify]
supported_payments: [stripe, x402]
health_url: https://acc.myshop.com/health
tags: [streetwear, agent-ready]
website_url: https://myshop.com
---

# My Store

Freeform markdown describing what this merchant exposes to agents:

- Catalog browse, checkout, order status
- Shopify storefront backed by the ACC UCP/1.0 façade at https://acc.myshop.com/ucp/v1
- Support: support@myshop.com
```

The `skill_id` is the stable identity across versions — keep it constant through updates. Everything else can change between submissions.

### 2.3 Host the file over HTTPS

The marketplace never stores the skill — it only stores a pointer and a content hash. Host the file on a URL you control. Common choices:

- `https://myshop.com/.well-known/acc-skill.md` — static file on your website
- GitHub Pages / Cloudflare R2 / any CDN
- A route served directly by the connector at `${ACC_URL}/.well-known/acc-skill.md`

The URL must be stable; if you move it, you publish a new version pointing at the new URL.

---

## Part 3 · Register in the marketplace

There is **no separate registration step**. The first EIP-712-signed submission the marketplace receives from your wallet is the registration. Subsequent submissions with the same `skill_id` are updates.

### 3.1 Publish

Zero-arg mode (recommended — reads `acc-data/config.json` + `keys/signer.key`):

```bash
npx acc publish
```

Or with explicit flags (for non-default configurations):

```bash
npx acc publish ./acc-skill.md \
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
npx acc-skill publish ./acc-skill.md \
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
