# UCP/1.0 Compliance Matrix

> **Spec pinned at:** `2026-04-08` ([`src/ucp/schemas/VERSION`](../src/ucp/schemas/VERSION))
> **Source:** https://ucp.dev/specification/overview

This document tracks every UCP/1.0 surface against our implementation status. Each row shows the spec element, our support level, and the adapter that realizes it.

Legend: ✅ supported · 🟡 partial · ❌ not supported · ⚪ not applicable

---

## Envelope

| Field | Status | Notes |
|---|---|---|
| `ucp.version` | ✅ | Emitted as `"2026-04-08"` on every response |
| `ucp.services["dev.ucp.shopping"]` | ✅ | REST transport; endpoint is `${SELF_URL}/ucp/v1` |
| `ucp.capabilities["dev.ucp.shopping.catalog"]` | ✅ | Search + Lookup |
| `ucp.capabilities["dev.ucp.shopping.checkout"]` | ✅ | Sessions resource |
| `ucp.capabilities["dev.ucp.shopping.order"]` | 🟡 | `GET /orders/:id` only; webhook emission per-adapter |
| `ucp.payment_handlers` | ✅ | `com.nexus.nups` surfaced via `PaymentProvider.describe()` |
| `signing_keys` | ❌ | JWS response signing deferred to a later release |

## Catalog capability

| Operation | Path | Status |
|---|---|---|
| Search | `POST /ucp/v1/search` | ✅ |
| Lookup | `GET /ucp/v1/products/:handle` | ✅ |
| Item enrichment (brand/sku/inventory) | — | ✅ Shopify + Woo |

## Checkout capability

| Operation | Path | Status |
|---|---|---|
| Create | `POST /ucp/v1/checkout-sessions` | ✅ |
| Retrieve | `GET /ucp/v1/checkout-sessions/:id` | ✅ (cart-token authenticated) |
| Update | `PATCH /ucp/v1/checkout-sessions/:id` | ❌ (deferred — requires quote re-issuance) |
| Complete | `POST /ucp/v1/checkout-sessions/:id/complete` | ✅ |
| Messages / `continue_url` | — | ✅ Always returns Nexus checkout URL |

## Order capability

| Operation | Path | Status |
|---|---|---|
| Retrieve | `GET /ucp/v1/orders/:id` | ✅ |
| Webhook lifecycle | `POST /webhook` | 🟡 NUPS-flavored; UCP-shaped events deferred |

## Payment handlers

| Handler | Protocol | Instruments | Status |
|---|---|---|---|
| `com.nexus.nups` | NUPS/1.5 | `crypto` | ✅ EIP-712 + on-chain escrow |
| (any additional) | — | — | Pluggable via `PaymentProvider` |

## Identity linking

| Feature | Status |
|---|---|
| OAuth 2.0 authorization | ❌ (anonymous checkout only — Phase 7+) |
| Consent receipts | ❌ |

## Error handling

| Feature | Status | Notes |
|---|---|---|
| REST error envelope | ✅ | `{ ucp:{version,status:"error"}, error:{code,content,continue_url?} }` |
| Error codes | 🟡 | `invalid_request`, `cart_token_invalid`, `cart_token_expired`, `checkout_not_found`, `product_not_found`, `variant_unavailable`, `payment_provider_unavailable`, `order_not_found`, `internal_error`. Full UCP vocabulary not yet mapped. |
| MCP JSON-RPC error pass-through | ⚪ | MCP tools already use JSON-RPC conventions |

## Security

| Mechanism | Status |
|---|---|
| HMAC-signed cart tokens (constant-time verify) | ✅ `src/ucp/cart-token.ts` |
| HTTPS enforced on Woo Basic auth | ✅ `validateWooConfig` throws on `http://` |
| Authorization header redaction in logs | ✅ Woo http helper |
| Rate-limit retry with jitter | ✅ Woo (Shopify uses its own client) |
| Replay-window check on NUPS webhook | ✅ 300s drift, constant-time compare |

## Transport parity

| Transport | Status |
|---|---|
| REST (primary) | ✅ |
| MCP tools (backing onto UCP handlers) | ✅ |
| A2A | ❌ |
| Embedded | ❌ |

## Testing

| Test | File |
|---|---|
| Schema validation (Shopify + Woo) | [`src/__tests__/ucp-contract.test.ts`](../src/__tests__/ucp-contract.test.ts) |
| Cart-token signing | [`src/__tests__/ucp-cart-token.test.ts`](../src/__tests__/ucp-cart-token.test.ts) |
| Mapper roundtrips | [`src/__tests__/ucp-mappers.test.ts`](../src/__tests__/ucp-mappers.test.ts) |
| Woo adapter | [`src/__tests__/woocommerce-adapter.test.ts`](../src/__tests__/woocommerce-adapter.test.ts) |
| Nexus PaymentProvider | [`src/__tests__/nexus-provider.test.ts`](../src/__tests__/nexus-provider.test.ts) |

---

## Known gaps (planned)

1. **Checkout PATCH** — updating cart line items requires a new quote; Phase 7 will add re-quote flow.
2. **OAuth identity linking** — needed for "checkout as signed-in user on behalf of agent"; Phase 7+.
3. **JWS response signing** — currently no response signing; `signing_keys` publication deferred.
4. **UCP-native order webhooks** — outbound webhook payloads still follow NUPS event shape; UCP `order.*` event envelope coming in Phase 7.
5. **A2A transport** — REST + MCP only for now.
