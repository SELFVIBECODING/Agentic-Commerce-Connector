# PRD: Commerce Protocol Analysis — UCP, ACP, and the Optimal Agent-Merchant Information Exchange

| Metadata | Value |
| --- | --- |
| **Title** | Commerce Protocol Comparison & Agent-Merchant Information Exchange Strategy |
| **Version** | 1.0.0 (Draft) |
| **Author** | Cipher & Nexus Product Team |
| **Date** | 2026-04-12 |
| **Related** | PRD-AP2-Compatibility, RFC-002 (NUPS), RFC-003 (NAIS), RFC-007 (Agentic Interface) |

---

## 1. Problem Statement

When a buyer's AI agent wants to purchase something from a merchant, the two sides need a shared language to exchange product information — what's available, what it costs, what the shipping options are, how to pay. Today two major protocols compete to define that language: Google's **UCP** (Universal Commerce Protocol) and OpenAI/Stripe's **ACP** (Agentic Commerce Protocol). A third protocol, Stripe's **MPP** (Machine Payments Protocol), handles a different but adjacent problem — machine-to-machine micropayments.

For Nexus, the question is practical: which protocol's information exchange model should Nexus align with, and what is the best architecture for agent-merchant product data exchange in a multi-protocol world?

---

## 2. What Is UCP?

### 2.1 Origin and Scope

UCP was announced by Sundar Pichai at NRF on January 11, 2026, co-developed with Shopify, Etsy, Wayfair, Target, Walmart, and endorsed by 20+ partners including Visa, Mastercard, Stripe, and The Home Depot. It powers agentic checkout in Google AI Mode (Search) and Gemini.

UCP covers the **full commerce journey**: product discovery → checkout → fulfillment → order management → post-purchase support. This is the broadest scope of any agentic commerce protocol.

### 2.2 Architecture: Decentralized, Merchant-Hosted

UCP's defining design choice is **decentralization**. Every merchant hosts a JSON profile at `/.well-known/ucp` on their own domain. This profile declares:

- **Services**: What commerce verticals the merchant supports (e.g., Shopping)
- **Capabilities**: What functions are available (e.g., `dev.ucp.shopping.checkout`, `dev.ucp.shopping.fulfillment`, `dev.ucp.shopping.catalog`)
- **Extensions**: Optional enhancements (e.g., discounts, loyalty programs, AP2 mandates)
- **Payment Handlers**: Which payment methods and processors are supported
- **Transport**: Whether the merchant speaks REST API, MCP, or A2A

No central platform indexes the catalog. The agent discovers the merchant, fetches the profile, and the two sides **negotiate capability intersection** — figuring out what they both support.

### 2.3 How Product Information Flows

```
Agent                              Merchant
  |                                    |
  |-- GET /.well-known/ucp ---------->|   (1) Discover merchant profile
  |<-- Profile JSON (capabilities) ---|   
  |                                    |
  |-- Negotiate intersection -------->|   (2) Compute shared capabilities
  |<-- Negotiated result -------------|
  |                                    |
  |-- Catalog query (if supported) -->|   (3) Product discovery
  |<-- Product data (JSON-LD) --------|
  |                                    |
  |-- CreateCheckoutSession --------->|   (4) Initiate checkout
  |<-- Session ID + pricing + options-|
  |                                    |
  |-- UpdateCheckoutSession --------->|   (5) Modify cart, fulfillment
  |<-- Updated state -----------------|
  |                                    |
  |-- CompleteCheckoutSession -------->|   (6) Payment + order
  |<-- Confirmation ------------------|
```

Key design features:

- **JSON-LD responses**: Product data uses linked data format with `@context` pointing to UCP vocabulary, making it semantically rich and machine-parseable
- **Capability extensions**: The AP2 Mandates Extension lets UCP checkout sessions carry AP2 Verifiable Credentials for authorization. Once negotiated, the session is "security locked" — neither side can revert to unprotected checkout
- **`continue_url` fallback**: If the agent can't complete a step (e.g., complex payment verification), UCP provides a browser URL for the human to continue manually
- **Merchant retains control**: Merchants own their data, their customer relationships, and their checkout logic. No intermediary indexes their catalog

### 2.4 Transport Options

UCP is transport-agnostic. The same capabilities can be exposed via:
- **REST API**: Standard HTTPS endpoints
- **MCP (Model Context Protocol)**: For agents that speak MCP natively
- **A2A (Agent-to-Agent)**: For Google's agent communication layer

---

## 3. What Is ACP?

### 3.1 Origin and Scope

ACP was announced by OpenAI and Stripe in September 2025. It is the first agentic commerce protocol to go live in production — shipping in ChatGPT with PayPal and Worldpay as payment partners. The specification is open-source on GitHub and uses date-based versioning (latest: 2026-01-30).

ACP's scope is **primarily checkout**: initiating a purchase, modifying the cart, completing payment. Product discovery is handled outside the protocol (via catalog feeds to OpenAI).

### 3.2 Architecture: Hub-and-Spoke, Platform-Mediated

ACP uses a **centralized model**:

1. Merchant submits a structured product feed to OpenAI
2. OpenAI indexes the catalog and surfaces products during ChatGPT conversations
3. When a user expresses purchase intent, ChatGPT sends `CreateCheckoutRequest` to the merchant's API
4. Stripe handles payment processing via `SharedPaymentToken`

The merchant builds 4 REST endpoints (or an MCP server):
- `CreateCheckout` — initialize cart from SKU + shipping info
- `UpdateCheckout` — modify quantities, fulfillment, customer details
- `CompleteCheckout` — pass SharedPaymentToken, process payment
- `CancelCheckout` — handle cancellation

### 3.3 How Product Information Flows

```
Merchant                    OpenAI Platform              Agent (ChatGPT)
  |                              |                            |
  |-- Product feed (catalog) --->|                            |   (1) Upload catalog
  |                              |-- Index products --------->|   (2) Platform indexes
  |                              |                            |
  |                              |   User: "I want running shoes"
  |                              |<-- Purchase intent --------|   (3) Agent surfaces product
  |                              |                            |
  |<-- CreateCheckoutRequest ----|                            |   (4) Initiate checkout
  |-- Cart + pricing + options ->|                            |   
  |                              |-- Render checkout UI ----->|   (5) Show to user
  |                              |                            |
  |<-- UpdateCheckoutRequest ----|                            |   (6) User modifies
  |-- Updated state ------------>|                            |
  |                              |                            |
  |<-- CompleteCheckoutRequest --|                            |   (7) SharedPaymentToken
  |-- Confirmation ------------->|                            |
```

Key design features:

- **Simplest merchant integration**: If you already use Stripe, it can be "as little as one line of code." Select which AI agents to sell through in the Stripe Dashboard
- **SharedPaymentToken**: A Stripe-issued payment credential that decouples checkout from payment processing. The merchant never handles raw card data
- **Capability negotiation** (since v2026-01-30): Merchants can broadcast their capabilities (catalog, pricing, inventory, fulfillment) in a structured way agents can discover
- **HMAC webhook security**: All webhook events include HMAC signatures

### 3.4 Versioning Evolution

| Version | Key Addition |
|---------|-------------|
| 2025-09-29 | Initial release |
| 2025-12-12 | Fulfillment enhancements |
| 2026-01-16 | Capability negotiation |
| 2026-01-30 | Extensions, discounts, payment handlers |

---

## 4. What Is MPP?

### 4.1 Different Problem Space

MPP (Machine Payments Protocol), co-authored by Stripe and Tempo, solves a **different problem** — not "how does an agent buy a product from a merchant" but "how does a machine pay another machine for continuous resource consumption."

MPP revives HTTP 402 "Payment Required" and introduces **sessions**: an agent pre-authorizes a spending limit, then streams micropayments as it consumes resources (API calls, compute, data queries). Thousands of micro-transactions aggregate into a single settlement batch on Tempo (a purpose-built L1 blockchain).

### 4.2 Why MPP Is Not a Commerce Protocol

MPP does not handle:
- Product discovery or catalog browsing
- Cart management or checkout flows
- Shipping, fulfillment, or order management
- Multi-item purchases

MPP handles:
- Pay-per-API-call pricing
- Streaming compute billing
- Machine-to-machine data purchases
- Subscription-like continuous consumption

**MPP is complementary to both UCP and ACP**, not competitive. An agent might use UCP or ACP to discover and buy a product, then use MPP to pay for ongoing API access to that product's services.

---

## 5. Head-to-Head: UCP vs. ACP for Agent-Merchant Information Exchange

| Dimension | UCP (Google) | ACP (OpenAI/Stripe) |
|-----------|-------------|---------------------|
| **Scope** | Full journey: discovery → checkout → fulfillment → post-purchase | Primarily checkout; discovery via catalog feed |
| **Architecture** | Decentralized (merchant-hosted) | Hub-and-spoke (OpenAI-mediated) |
| **Product discovery** | Agent queries merchant directly via Catalog capability | Agent surfaces products from OpenAI's index |
| **Merchant profile** | `/.well-known/ucp` JSON on merchant domain | Product feed submitted to OpenAI |
| **Capability negotiation** | Core design primitive — server-selects intersection | Added in v2026-01-16 |
| **Data format** | JSON-LD with `@context` (semantic) | Standard JSON (REST) |
| **Transport** | REST / MCP / A2A (merchant chooses) | REST / MCP |
| **Payment handling** | Payment Handlers declared in profile (any PSP) | SharedPaymentToken (Stripe-issued) |
| **AP2 integration** | Native extension (`ap2-mandates`) | Not specified |
| **Agent platform** | Google AI Mode, Gemini, any A2A/MCP agent | ChatGPT, OpenAI-powered agents |
| **Data ownership** | Merchant owns and hosts all data | Merchant feeds data to OpenAI platform |
| **Merchant integration effort** | Medium-high (host profile, implement capabilities) | Low (Stripe dashboard config, catalog feed) |
| **Multi-agent support** | Any agent can discover `/.well-known/ucp` | Currently limited to OpenAI ecosystem |
| **Production status** | Live in Google AI Mode (Q1 2026) | Live in ChatGPT (since Sep 2025) |
| **Open-source** | Yes (ucp.dev) | Yes (GitHub) |

---

## 6. Analysis: Which Model Is Best for Agent-Merchant Information Exchange?

### 6.1 The Core Tension

The fundamental question is: **should product information flow through a central platform, or should agents discover it directly from merchants?**

- **ACP's model**: The platform (OpenAI) is the marketplace. Merchants push their catalog to the platform, and the platform's agent surfaces products to users. This is the Amazon/App Store model adapted for AI agents. It's simple, fast to integrate, and has the advantage of being live today with real users in ChatGPT.

- **UCP's model**: The open web is the marketplace. Merchants publish their capabilities on their own domain, and any agent from any platform can discover them. This is the DNS/Web model — decentralized, open, and no single gatekeeper.

### 6.2 Why UCP's Model Is Architecturally Superior

For the long-term health of the agentic commerce ecosystem, the **decentralized discovery model is better**. Here's why:

**1. No platform lock-in**

In ACP's current model, a merchant's products are discoverable only by ChatGPT and OpenAI-powered agents. If a user is talking to Claude, Gemini, or a custom enterprise agent, the ACP catalog is invisible. UCP's `/.well-known/ucp` is discoverable by any agent that can make an HTTP request — the same way `robots.txt` works for any search engine.

**2. Capability negotiation is a first-class primitive**

UCP's profile + negotiation model means the agent and merchant can dynamically agree on what's possible before starting a transaction. If the merchant supports AP2 mandates, the session locks to AP2-protected checkout. If the merchant supports a loyalty extension, the agent can activate it. This is composable commerce — capabilities can be mixed, matched, and extended without breaking the core protocol.

ACP added capability negotiation in v2026-01-16, but it's retrofitted onto a checkout-first design, not built in from the ground up.

**3. Semantic data (JSON-LD) enables smarter agents**

UCP's use of JSON-LD with schema.org-aligned vocabulary means product data is self-describing. An agent doesn't need pre-programmed knowledge of a merchant's data schema — the `@context` tells it what each field means. This matters as agents get more autonomous and need to reason about product attributes they haven't seen before.

ACP uses standard JSON, which is simpler but requires the agent to be pre-trained on the expected schema.

**4. Transport flexibility**

UCP lets the merchant choose REST, MCP, or A2A as the communication transport. This means a merchant can expose the same capabilities to Google's A2A agents, Anthropic's MCP-native agents, and traditional API clients — from a single implementation.

ACP supports REST and MCP but not A2A.

**5. Merchant data sovereignty**

In UCP, the merchant's catalog never leaves their infrastructure (unless they choose to syndicate it). They control indexing, pricing updates, and inventory signals in real-time. In ACP, the merchant feeds their catalog to OpenAI, which indexes it independently — creating a sync lag and potential data inconsistency.

### 6.3 Where ACP Wins Today

Despite UCP's architectural advantages, ACP has real strengths:

**1. Time to market**: ACP has been live in ChatGPT since September 2025. Merchants are already making sales. UCP went live in Google AI Mode in Q1 2026 — later but catching up fast.

**2. Integration simplicity**: For a Stripe merchant, ACP integration is trivially simple — configure in dashboard, share catalog feed, done. UCP requires hosting a profile, implementing capability endpoints, and handling negotiation logic.

**3. Payment simplicity**: SharedPaymentToken abstracts away all payment complexity. The merchant gets a token, passes it to Stripe, money appears. UCP's payment handler model is more flexible but requires more integration work.

**4. User base**: ChatGPT has massive consumer reach. For merchants optimizing for volume today, ACP is where the buyers are.

### 6.4 The Convergence Path

The two protocols are already converging:

- ACP added capability negotiation (v2026-01-16) and extensions/payment handlers (v2026-01-30), borrowing UCP's composability concepts
- UCP's AP2 Mandates Extension gives it Google's authorization layer
- Stripe is both an ACP creator and a UCP-endorsed partner
- Most large retailers (Shopify, Walmart) are implementing both protocols
- The emerging consensus is: **merchants will need to support both**, just as websites support both Google and Bing crawling today

---

## 7. Recommendation: Nexus's Information Exchange Strategy

### 7.1 Adopt UCP's Decentralized Discovery Model

Nexus should align its merchant discovery and capability exchange with UCP's `/.well-known` profile + capability negotiation model. This means:

- Nexus merchants publish a profile that declares NUPS settlement capabilities alongside UCP shopping capabilities
- Nexus's protocol router reads UCP profiles to discover what settlement methods each merchant supports
- Nexus adds its own capability extension (e.g., `dev.nexus.escrow_settlement`) that merchants can declare support for

**Why**: UCP's open discovery model is the natural fit for Nexus's multi-protocol router vision. If every merchant publishes their capabilities at a well-known endpoint, Nexus can discover and route to them without depending on any single platform's catalog.

### 7.2 Support ACP Checkout as an Input Channel

Nexus should also accept ACP checkout flows as a trigger for Escrow settlement:

- When a ChatGPT agent initiates an ACP `CreateCheckoutRequest` with a Nexus-enabled merchant, the merchant can route settlement through Nexus's Escrow instead of (or in addition to) Stripe's direct settlement
- The ACP `SharedPaymentToken` can be extended to reference a Nexus Escrow lock, similar to how AP2's PaymentMandate references a Credential Provider

**Why**: ACP has the largest active user base today. Ignoring it means ignoring ChatGPT's hundreds of millions of users.

### 7.3 Extend NUPS Quote to Carry UCP Semantics

The NUPS Quote (RFC-002) should be extended to optionally carry UCP-compatible product descriptions:

- Add a `ucp_context` field to NUPS Quote that contains JSON-LD product data from the merchant's UCP catalog response
- This makes Nexus quotes "UCP-enriched" — any agent that reads UCP can understand the product details in a Nexus quote
- The existing EIP-712 signature structure remains unchanged; the UCP context is metadata, not part of the signed hash

### 7.4 Don't Build a Catalog — Route to Catalogs

Nexus should explicitly **not** try to index merchant product catalogs. That's Google's job (via UCP) and OpenAI's job (via ACP). Nexus's role is:

1. **Discover** what the merchant sells (via UCP profile or ACP capability discovery)
2. **Quote** the settlement terms (via NUPS)
3. **Protect** the transaction (via Escrow)
4. **Settle** the payment (via on-chain USDC)

This keeps Nexus focused on its core value — settlement and protection — and avoids competing with platforms that have orders-of-magnitude more product data.

---

## 8. User Stories

**As a buyer's AI agent**, I want to discover a merchant's UCP profile and see that they support Nexus Escrow settlement, so that I can offer my user transaction protection for this purchase.

**As a merchant**, I want to declare Nexus Escrow as a payment handler in my UCP profile, so that agents from any platform can route high-value transactions through Nexus's protection layer.

**As a buyer using ChatGPT**, I want the ACP checkout flow to offer Nexus Escrow protection when the merchant supports it, so that I get the same transaction safety regardless of which AI agent I'm using.

**As a Nexus protocol router**, I want to read both UCP profiles and ACP capability declarations, so that I can route transactions to the optimal settlement path regardless of which commerce protocol initiated the purchase.

**As a merchant integrating with multiple protocols**, I want to implement one set of Nexus settlement endpoints and have them work with both UCP and ACP checkout flows, so that I don't need separate integrations per protocol.

---

## 9. Requirements

### P0 — Must Have

| ID | Requirement | Acceptance Criteria |
|----|-------------|-------------------|
| R1 | **UCP Profile Reader**: Nexus Core can fetch and parse a merchant's `/.well-known/ucp` profile to discover capabilities and payment handlers | Given a merchant URL, When Nexus fetches `/.well-known/ucp`, Then it correctly parses capabilities, extensions, and payment handler declarations |
| R2 | **Nexus Escrow Payment Handler**: Define a UCP-compatible payment handler specification (`dev.nexus.escrow`) that merchants can declare in their UCP profile | Given a merchant declares `dev.nexus.escrow` handler, When an agent negotiates capabilities, Then Nexus Escrow appears as an available settlement option |
| R3 | **ACP Checkout → Escrow Bridge**: Accept ACP `CreateCheckoutRequest` and route settlement through Nexus Escrow when merchant supports it | Given an ACP checkout is initiated, When the merchant has Nexus enabled, Then Nexus creates an Escrow lock and returns a reference in the checkout response |
| R4 | **Capability Negotiation Participation**: Nexus can participate in UCP capability negotiation, declaring its settlement capabilities and computing intersection with merchant profiles | Given Nexus and merchant profiles, When negotiation occurs, Then the intersection correctly identifies shared capabilities including escrow, AP2 mandates, and multi-merchant orchestration |

### P1 — Should Have

| ID | Requirement |
|----|-------------|
| R5 | **NUPS Quote UCP Enrichment**: NUPS Quote carries optional `ucp_context` field with JSON-LD product data |
| R6 | **Multi-Protocol Routing Dashboard**: Merchant admin can see which protocols (UCP, ACP, AP2, x402) are routing transactions through their Nexus settlement |
| R7 | **AP2 Mandates Extension Support**: When UCP checkout negotiates AP2 mandates, Nexus correctly processes the security-locked session with Verifiable Credential evidence chain |

### P2 — Future Considerations

| ID | Requirement |
|----|-------------|
| R8 | **A2A Transport Binding**: Expose Nexus settlement capabilities via Google's A2A transport in addition to REST and MCP |
| R9 | **ACP SharedPaymentToken Extension**: Work with Stripe to define a SharedPaymentToken variant that references Nexus Escrow locks |
| R10 | **UCP Order Management Integration**: Support UCP's post-purchase capabilities (order tracking, returns) tied to Escrow release/refund states |

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| UCP profile parse success rate | >99% | % of merchant profiles correctly parsed without errors |
| ACP→Escrow routing latency | <500ms additional | Time added to checkout flow by Escrow lock creation |
| Merchants declaring `dev.nexus.escrow` handler | 50+ in first 6 months | Count of UCP profiles including Nexus handler |
| Multi-protocol transactions | 20%+ of Nexus volume from non-NUPS protocols within 12 months | % of transactions originating from UCP or ACP flows |

---

## 11. Open Questions

| Question | Owner | Blocking? |
|----------|-------|-----------|
| Does UCP's JSON-LD requirement add meaningful overhead vs. ACP's plain JSON for settlement-only use cases? | Engineering | No |
| Will Stripe extend SharedPaymentToken to support third-party escrow references, or is a wrapper approach needed? | Biz Dev + Stripe | Yes (for R9) |
| Should Nexus publish its own `/.well-known/ucp` profile as a "settlement service" distinct from shopping service? | Product + Architecture | Yes (for R2) |
| How does UCP's `continue_url` fallback interact with Nexus's on-chain signing requirement? | Engineering | No |
| Will ACP's capability negotiation evolve to be interoperable with UCP's, or will they remain separate schemas? | Product (monitor) | No |

---

## 12. Summary

| Protocol | What it is | What it solves | Nexus relationship |
|----------|-----------|---------------|-------------------|
| **UCP** | Google's full-journey commerce protocol | Product discovery + checkout + fulfillment | Primary alignment — adopt discovery model, publish Nexus as payment handler |
| **ACP** | OpenAI/Stripe's checkout protocol | Agent-to-merchant checkout flow | Input channel — accept ACP checkouts, route to Nexus Escrow |
| **MPP** | Stripe/Tempo's machine payment protocol | Continuous machine-to-machine micropayments | Complementary — different use case, no direct integration needed for v1 |
| **AP2** | Google's authorization protocol | Proving user consent for agent spending | Already planned (PRD-AP2-Compatibility) — integrates via UCP extension |

**The best model for agent-merchant information exchange is UCP's decentralized, capability-negotiated, JSON-LD-based approach** — it's open, composable, transport-flexible, and aligns with Nexus's multi-protocol router vision. ACP should be supported as an input channel for its user base, not as the primary architectural model. MPP solves a different problem (micropayments) and is complementary.

The winning strategy for Nexus is: **don't compete on commerce discovery — compete on settlement trust.** Let UCP and ACP handle "what does the merchant sell and how do I check out?" Nexus handles "how is the money protected until the goods arrive?"

---

### Sources

- [Google Developers: UCP Guide](https://developers.google.com/merchant/ucp/)
- [Google Developers Blog: Under the Hood — UCP](https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/)
- [UCP Specification](https://ucp.dev/)
- [UCP: AP2 Mandates Extension](https://ucp.dev/specification/ap2-mandates/)
- [Shopify Engineering: Building the UCP](https://shopify.engineering/ucp)
- [Stripe: Agentic Commerce Protocol Docs](https://docs.stripe.com/agentic-commerce/protocol)
- [Stripe: ACP Specification](https://docs.stripe.com/agentic-commerce/protocol/specification)
- [GitHub: Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
- [Stripe Blog: Developing an Open Standard for Agentic Commerce](https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce)
- [Crossmint: Agentic Payments Protocols Compared](https://www.crossmint.com/learn/agentic-payments-protocols-compared)
- [DEV: UCP vs ACP Technical Comparison](https://dev.to/ucptools/ucp-vs-acp-in-2026-a-technical-comparison-of-ai-commerce-protocols-50j7)
- [Commercetools: ACP Deep Dive Guide](https://commercetools.com/blog/agentic-commerce-protocol-acp-deep-dive-guide)
