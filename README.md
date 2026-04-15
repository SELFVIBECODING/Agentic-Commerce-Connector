# Agentic Commerce Connector

> **UCP/1.0-native** middleware that bridges AI agents to any e-commerce platform, with stablecoin payments.

[![UCP Version](https://img.shields.io/badge/UCP-2026--04--08-brightgreen)](https://ucp.dev/specification/overview)
[![License](https://img.shields.io/badge/license-MIT-blue)]()

Open-source service that exposes the [Universal Commerce Protocol (UCP)](https://ucp.dev) to AI agents (via MCP or HTTP) and adapts it to any e-commerce platform through a pluggable adapter layer. Ships with Shopify + WooCommerce out of the box, and with Nexus Protocol stablecoin payments (USDC / XSGD via EIP-712 + escrow).

```
  AI Agent (MCP / UCP-HTTP)
         │
         ▼  UCP/1.0 façade
 ┌────────────────────────────┐
 │  /ucp/v1/discovery         │
 │  /ucp/v1/search            │
 │  /ucp/v1/checkout-sessions │
 │  /ucp/v1/orders            │
 └──────────┬─────────────────┘
            │
  CatalogAdapter + MerchantAdapter   (platform-neutral)
            │
  PaymentProvider  ← NexusPaymentProvider (NUPS/1.5)
            │
  Shopify REST/GraphQL  ·  WooCommerce REST v3
```

## Features

- **UCP/1.0 native** — exposes the full Discovery / Search / Checkout / Order surface under `/ucp/v1/*`, schema-validated against the public spec.
- **Multi-platform** — Shopify (Storefront + Admin GraphQL), WooCommerce (REST v3), extensible to any platform via two small interfaces.
- **Stablecoin payments** — USDC / XSGD via Nexus Protocol (EIP-712 quote + on-chain escrow + gasless checkout). Advertised in UCP `discovery.payment_handlers`.
- **Dual interface** — UCP-HTTP for native UCP agents + MCP tools for Claude / Cursor / Copilot.
- **Stateless cart tokens** — HMAC-signed, 15-min TTL; no cookies, no session store needed for middle-tier.

## Quick Start

```bash
# Clone
git clone https://github.com/example/agentic-commerce-connector.git
cd agentic-commerce-connector

# Configure
cp .env.example .env
# Set PLATFORM=shopify or PLATFORM=woocommerce and fill in credentials.
# Generate a cart-token secret with: openssl rand -hex 32

# Install & build
npm install
npm run build

# Run
npm start
```

### Docker

```bash
docker compose up -d
```

The service starts on port 10000 with UCP, MCP, legacy REST, and webhook endpoints.

## Configuration

Environment variables are **split by concern** so you don't have to read the whole file to get one thing running. Pick your platform + payment provider, compose a `.env` from the relevant pieces:

```bash
# Shopify + Nexus
cat env-examples/base.env \
    env-examples/shopify.env \
    env-examples/nexus.env > .env

# WooCommerce + Nexus
cat env-examples/base.env \
    env-examples/woocommerce.env \
    env-examples/nexus.env > .env

# Then edit .env with your real values
```

Every variable has a comment above it explaining **where to obtain it** (Shopify admin path, WooCommerce settings path, Nexus registration, etc.).

| File | Required? | Scope |
|---|---|---|
| [`env-examples/base.env`](env-examples/base.env) | Always | Port, DB, merchant DID, UCP cart-token secret |
| [`env-examples/shopify.env`](env-examples/shopify.env) | If `PLATFORM=shopify` | Shopify Storefront + Admin tokens |
| [`env-examples/woocommerce.env`](env-examples/woocommerce.env) | If `PLATFORM=woocommerce` | WooCommerce REST v3 credentials |
| [`env-examples/nexus.env`](env-examples/nexus.env) | If `PAYMENT_PROVIDER=nexus` | NUPS signer + payout address + RPC |

See [`env-examples/README.md`](env-examples/README.md) for security notes and `.env.example` for a single-file fallback.

## API

### UCP/1.0 endpoints (primary)

| Method | Path | Description |
|---|---|---|
| GET | `/ucp/v1/discovery` | Capabilities, store meta, payment handlers |
| POST | `/ucp/v1/search` | Product search (structured query) |
| GET | `/ucp/v1/products/:handle` | Product detail |
| POST | `/ucp/v1/checkout-sessions` | Create session, returns `cart_token` |
| GET | `/ucp/v1/checkout-sessions/:id` | Retrieve session (Bearer: cart_token) |
| POST | `/ucp/v1/checkout-sessions/:id/complete` | Finalize, returns `continue_url` |
| GET | `/ucp/v1/orders/:id` | Order status / attribution |

Authenticate session-scoped calls with the `cart_token` returned by create:

```
Authorization: Bearer <cart_token>
# or
X-UCP-Cart-Token: <cart_token>
```

See [docs/ucp-compliance.md](docs/ucp-compliance.md) for the full compliance matrix.

### MCP tools

`search_products` · `get_product` · `create_checkout` · `check_checkout_status` — all backed by the same UCP handlers.

### Legacy REST (deprecated)

`/api/v1/*` routes are retained for backwards compatibility and will be removed in `v1.0.0`.

## Adding a New E-commerce Adapter

Implement two interfaces in `src/adapters/<platform>/`:

```typescript
interface CatalogAdapter {
  searchProducts(query, first?, after?): Promise<ProductSearchResult>
  listProducts(first?, after?): Promise<ProductSearchResult>
  getProduct(handle): Promise<CommerceProduct | null>
  getVariantPrices(variantIds): Promise<readonly CommerceVariant[]>
  getStoreMeta(): Promise<StoreMeta>
}

interface MerchantAdapter {
  createOrder(session, opts?): Promise<OrderCreateResult>
  markOrderPaid(platformOrderId, txHash): Promise<void>
  cancelOrder(platformOrderId, reason?): Promise<void>
  hasExistingOrder(sessionId): Promise<boolean>
}
```

Wire the factory into [src/server.ts](src/server.ts) `createAdaptersForConfig`. The UCP façade automatically maps your adapter data to the UCP wire format via [src/ucp/mappers.ts](src/ucp/mappers.ts).

## Adding a New Payment Provider

Implement `PaymentProvider` in `src/payment/<provider>/`:

```typescript
interface PaymentProvider {
  buildQuote(params): Promise<PaymentQuote>
  submitToPaymentNetwork(quote): Promise<{ checkoutUrl, paymentGroupId }>
  confirmFulfillment(paymentId): Promise<void>
  verifyWebhook(rawBody, signature, timestamp): VerifyResult
}
```

Providers also expose a `describe()` returning a UCP `payment_handler` descriptor; the façade advertises it in `/ucp/v1/discovery`.

## Architecture

```
src/
  ucp/                # UCP/1.0 façade (types, mappers, routes, cart tokens)
  adapters/
    shopify/          #   Shopify Storefront + Admin GraphQL
    woocommerce/      #   WooCommerce REST v3
  payment/
    types.ts          # PaymentProvider interface
    nexus/            #   Nexus Protocol (EIP-712 + escrow + NUPS/1.5)
  services/           # Platform-agnostic core logic
```

## Acknowledgments

- [Universal Commerce Protocol (UCP)](https://github.com/Universal-Commerce-Protocol/ucp) — the open protocol we implement
- [ucp-connect-woocommerce](https://github.com/joellobo1234/ucp-connect-woocommerce) — reference plugin for endpoint shape

## License

MIT
