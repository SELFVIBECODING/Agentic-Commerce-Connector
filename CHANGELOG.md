# Changelog

## [0.2.0] - 2026-04-15

Major rewrite to UCP/1.0 native.

### Added
- **UCP/1.0 façade** (`/ucp/v1/*`) — Discovery, Search, Product lookup, Checkout Sessions (create, retrieve, complete), Order retrieval. Validated against UCP spec pinned at `2026-04-08`. See [docs/ucp-compliance.md](docs/ucp-compliance.md).
- **WooCommerce adapter** — `adapters/woocommerce/*` implements `CatalogAdapter` + `MerchantAdapter` against WC REST v3. HTTPS-only Basic auth, retry with jitter on 429/5xx, variant ID encoding `woo:{parent}[:{variation}]`, and dual idempotency (meta_query primary + recent-order scan fallback).
- **Nexus PaymentProvider** — `payment/nexus/*` factory implementing the `PaymentProvider` interface. Surfaces itself to UCP discovery via `describe()`.
- **HMAC cart tokens** — `ucp/cart-token.ts`; stateless, constant-time verify, configurable TTL (default 15 min).
- **Shopify field enrichment** — `sku`, `brand` (vendor), `inventory_quantity` (quantityAvailable) now populated on both product list and variant lookup.
- **Contract tests** — UCP schema validation across both Shopify and Woo adapters (`ucp-contract.test.ts`).
- 35+ new tests; full suite now at 163 passing.

### Changed
- `skill.md` bumped to `protocol: UCP/1.0`, `payment_protocol: NUPS/1.5`, category `commerce.universal`.
- Internal types (`CommerceProduct` / `CommerceVariant`) extended with optional `brand`, `sku`, `inventoryQuantity`.
- Default config currency switched to `XSGD` (Nexus primary stablecoin).

### Deprecated
- `/api/v1/*` legacy REST routes. Still functional for backwards compatibility; planned removal in `1.0.0`.

### Fixed
- Duplicate `PaymentQuote` import in `src/types.ts`.
- Stale `nexus_payment_id` reference in `services/webhook-handler.ts` (now `payment_id`).

## [0.1.0] - initial

- Shopify Storefront + Admin adapter
- Checkout session service + NUPS quote builder
- NUPS HTTP REST routes (`/api/v1/*`)
- MCP tools: search_products, get_product, create_checkout, check_checkout_status
- Docker + docker-compose deployment
