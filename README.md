# Agentic Commerce Connector

> Bridge AI agents to any e-commerce platform with stablecoin payments.

Open-source middleware that connects AI agents (via MCP or HTTP) to e-commerce platforms through a universal adapter layer, with built-in stablecoin payment support.

```
Any AI Agent (MCP / HTTP)
        |
        v
+-----------------------------+
|  Agentic Commerce Connector |
|                             |
|  Commerce Adapters          |   Shopify / WooCommerce / OpenCart / ...
|  Payment Provider           |   Nexus Protocol (EIP-712 + Escrow + USDC)
|  Core Services              |   Checkout / Rate / Order / Reconciler
+-----------------------------+
```

## Features

- **Multi-platform** — Shopify (Storefront + Admin GraphQL), WooCommerce (REST API), extensible to any platform
- **Stablecoin payments** — USDC via Nexus Protocol (escrow + gasless checkout)
- **Dual interface** — MCP tools for AI agents + HTTP REST API for direct integration
- **Adapter pattern** — Add new e-commerce platforms by implementing two interfaces (`CatalogAdapter` + `MerchantAdapter`)
- **Payment provider abstraction** — Nexus is the default; architecture supports additional providers

## Quick Start

```bash
# Clone
git clone https://github.com/example/agentic-commerce-connector.git
cd agentic-commerce-connector

# Configure
cp .env.example .env
# Edit .env with your platform credentials and payment config

# Install & build
npm install
npm run build

# Run
npm start
```

The service starts on port 10000 with both MCP and HTTP endpoints.

### Docker

```bash
docker compose up -d
```

## Configuration

Set `PLATFORM` to choose your e-commerce backend and `PAYMENT_PROVIDER` for the payment method.

| Variable | Description | Default |
|---|---|---|
| `PLATFORM` | E-commerce platform (`shopify` or `woocommerce`) | `shopify` |
| `PAYMENT_PROVIDER` | Payment protocol (`nexus`) | `nexus` |
| `PORTAL_PORT` | HTTP server port | `10000` |
| `MERCHANT_DID` | Merchant identity for payment provider | — |

See [.env.example](.env.example) for the full list.

## API

### MCP Tools

| Tool | Description |
|---|---|
| `search_products` | Search products by keyword |
| `get_product` | Get product details by handle |
| `create_checkout` | Create a checkout session with line items |
| `check_checkout_status` | Check payment and order status |

### HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/products?q=...` | Search products |
| `GET` | `/api/v1/products/:handle` | Product details |
| `POST` | `/api/v1/checkout` | Create checkout session |
| `GET` | `/api/v1/checkout/:sessionId` | Checkout status |
| `POST` | `/webhook` | Payment event callback |
| `GET` | `/health` | Health check |

## Adding a New E-commerce Adapter

Implement two interfaces in `src/adapters/<platform>/`:

```typescript
// CatalogAdapter — read product data
interface CatalogAdapter {
  searchProducts(query: string, first?: number, after?: string | null): Promise<ProductSearchResult>
  listProducts(first?: number, after?: string | null): Promise<ProductSearchResult>
  getProduct(handle: string): Promise<CommerceProduct | null>
  getVariantPrices(variantIds: readonly string[]): Promise<readonly CommerceVariant[]>
  getStoreMeta(): Promise<StoreMeta>
}

// MerchantAdapter — manage orders
interface MerchantAdapter {
  createOrder(session: CheckoutSession, opts?: OrderCreateOpts): Promise<OrderCreateResult>
  markOrderPaid(platformOrderId: string, txHash: string): Promise<void>
  cancelOrder(platformOrderId: string, reason?: string): Promise<void>
  hasExistingOrder(sessionId: string): Promise<boolean>
}
```

Then register your adapter factory in `src/config.ts`.

## Adding a New Payment Provider

Implement the `PaymentProvider` interface in `src/payment/<provider>/`:

```typescript
interface PaymentProvider {
  buildQuote(params: QuoteParams): Promise<PaymentQuote>
  submitToPaymentNetwork(quote: PaymentQuote): Promise<{ checkoutUrl: string; paymentGroupId: string }>
  confirmFulfillment(paymentId: string): Promise<void>
  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean
}
```

## Architecture

```
src/
  adapters/           # E-commerce platform adapters
    shopify/          #   Shopify Storefront + Admin GraphQL
    woocommerce/      #   WooCommerce REST API
  payment/            # Payment provider implementations
    nexus/            #   Nexus Protocol (EIP-712 + escrow)
  services/           # Platform-agnostic core logic
    checkout-session  #   Checkout state machine
    rate-service      #   Fiat-to-stablecoin conversion
    order-store       #   Order state management
    order-writeback   #   Post-payment order sync
    reconciler        #   Periodic reconciliation
```

## License

MIT
