# Agentic Commerce Connector (ACC)

> Open-source **UCP/1.0 data-layer wrapper** for traditional e-commerce, plus
> a publishable **skill toolchain** that lets AI agents discover and transact
> with any merchant who self-deploys this connector.

[![UCP Version](https://img.shields.io/badge/UCP-2026--04--08-brightgreen)](https://ucp.dev/specification/overview)
[![License](https://img.shields.io/badge/license-MIT-blue)]()

## What this is

A merchant installs ACC in front of their existing storefront (Shopify /
WooCommerce / …). ACC exposes a standardized **UCP/1.0** surface that AI
agents understand, and emits a **signed skill package** that a merchant can
publish so user agents can discover and consume the endpoint.

```
 AI User Agent ──learns once──▶ Skill package (signed, from marketplace)
       │
       ▼  direct HTTP, UCP/1.0
 ┌────────────────────────────────┐
 │  ACC Connector                 │
 │  /ucp/v1/discovery             │
 │  /ucp/v1/search                │
 │  /ucp/v1/checkout-sessions     │
 │  /ucp/v1/orders                │
 │  /auth/shopify/{install,callback}
 │  /admin/shopify                │
 │  /.well-known/acc-skill.md     │
 └──────────┬─────────────────────┘
  CatalogAdapter · MerchantAdapter · PaymentProvider
            │
 Shopify · WooCommerce · Nexus stablecoins · …
```

## Repo layout (npm workspaces)

```
packages/
  connector/     @acc/connector    UCP façade + Shopify OAuth + adapters
  skill-spec/    @acc/skill-spec   Normative spec + EIP-712 + JCS + schemas
  cli/           @acc/cli          'acc' — init wizard, shopify, wallet,
                                   publish, skill (legacy 'acc-skill' alias)
docs/
  MERCHANT_ONBOARDING.md           Step-by-step merchant setup guide
  CLI.md                           Full command reference for 'acc'
  SKILL_SPEC.md                    Normative protocol spec
  plans/                           Design + execution plans
```

The **marketplace** that hosts published skill packages lives in a **separate
private repo** (`acc-marketplace`) and depends on `@acc/skill-spec` via npm.
Anyone can build a compatible marketplace against the public spec.

## Quick Start

Shopify merchants currently run the **self-hosted Partners** flow:
you register your own Shopify Partners account and hold your own
`client_secret`. ~10-minute one-time setup via
[docs/SHOPIFY_PARTNERS_SETUP.md](./docs/SHOPIFY_PARTNERS_SETUP.md).

A zero-setup "Silicon Retail relayer" track is planned for Stream B
(see [plan doc](./docs/plans/2026-04-19-stream-b-saas-relayer-gateway.md)).
The install-time relayer shipped in v0.5.0 has been removed from the
wizard pending that rearchitecture.

You also need a public HTTPS endpoint for the connector (Render, Fly,
a VPS behind Caddy/nginx, or Cloudflare Tunnel — anything that serves
HTTPS).

### 1. Install the binary

```bash
curl -fsSL https://raw.githubusercontent.com/SELFVIBECODING/Agentic-Commerce-Connector/main/install.sh | sh
```

Installs `acc` into `~/.acc/bin/`. Zero dependencies — no Node, no git,
no build toolchain. Works on macOS (arm64 + x64) and Linux (x64 + arm64).

To upgrade later: `acc upgrade`.

### 2. Configure for your store

```bash
# 10-step interactive wizard — creates ~/.acc/ (or ./acc-data/ if run from
# a repo checkout) with config.json, .env, encryption key, signer wallet,
# Shopify Partners creds, SQLite schema, skill.md.
acc init shopify

# Boot the connector. Listens on PORTAL_PORT (default 10000). Your reverse
# proxy should forward your public domain → 127.0.0.1:10000.
acc start
```

### 3. Connect your Shopify store

```bash
# Prints the install URL (+ QR code) and polls until the shop completes
# OAuth. Run from any machine that can reach your acc-data/ directory.
acc shopify connect --shop=<your-store>.myshopify.com
```

### 4. Publish your skill to the marketplace

```bash
$EDITOR ~/.acc/skill/acc-skill.md   # or ./acc-data/skill/acc-skill.md
acc publish
```

### Diagnostics

```bash
acc doctor        # check data-dir, config, keys, portal reachability
acc version       # show installed version + commit
acc help          # show all commands
```

Full walkthrough: [docs/MERCHANT_ONBOARDING.md](./docs/MERCHANT_ONBOARDING.md).
All CLI commands: [docs/CLI.md](./docs/CLI.md).

### One-command VPS deploy

If you have a fresh Debian/Ubuntu VPS and a hostname pointed at it, this
sets up the system user, binary, reverse proxy (nginx or Caddy), TLS via
Let's Encrypt, systemd unit, and runs the wizard — in one shot:

```bash
curl -fsSL https://raw.githubusercontent.com/SELFVIBECODING/Agentic-Commerce-Connector/main/deploy/scripts/install-server.sh | \
  ACC_PUBLIC_HOSTNAME=acc.mystore.com sudo bash
```

### Alternative: build from source

Developers can still clone and run via Node:

```bash
git clone https://github.com/SELFVIBECODING/Agentic-Commerce-Connector.git
cd Agentic-Commerce-Connector
npm install && npm run build
npx acc init shopify
npm --workspace packages/connector start
```

### Docker

```bash
docker compose up -d
```

## Why this shape

- **Self-host first.** Merchants own their data; ACC is just a translator.
- **Wallet-based identity.** Skill packages are EIP-712 signed by the
  merchant's wallet. No account system, no central gatekeeper for the
  protocol layer.
- **Open platform.** The spec (`@acc/skill-spec`) is MIT. Anyone can build
  a marketplace, client SDK, or compatible merchant tool against it.
- **Marketplace is off-path.** Once a user agent has learned a skill, it talks
  directly to the merchant connector. No proxy, no marketplace dependency at
  runtime.

## Status

- `packages/connector/` — UCP façade, Shopify adapter with full OAuth install
  flow (HMAC + state + token exchange + storefront token mint + webhook
  register), WooCommerce adapter, Nexus payment provider, AES-256-GCM
  at-rest token encryption, SQLite + Postgres installation stores.
- `packages/skill-spec/` — v0.1 types, EIP-712 typed data, JCS canonicalisation,
  JSON Schemas. Spec doc at `packages/skill-spec/SPEC.md`.
- `packages/cli/` — `acc` binary shipped: init (10-step wizard: payment
  menu + category multi-select + self-hosted Shopify Partners install),
  shopify connect, start, doctor, upgrade, wallet (show/new/import),
  publish (zero-arg), skill init, version, help. Deferred: `acc
  stop/status`, `acc skill edit`, `acc shopify status/disconnect`.

## Documentation

- Merchant onboarding: [docs/MERCHANT_ONBOARDING.md](./docs/MERCHANT_ONBOARDING.md)
- CLI reference: [docs/CLI.md](./docs/CLI.md)
- Skill spec: [docs/SKILL_SPEC.md](./docs/SKILL_SPEC.md)
- UCP compliance notes: [docs/ucp-compliance.md](./docs/ucp-compliance.md)
- Design + execution plans: [docs/plans/](./docs/plans/)

## License

MIT.
