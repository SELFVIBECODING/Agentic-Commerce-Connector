# Implementation Plan: Agentic Commerce Connector

## Context

AI Agent 驱动的电商正在快速发展（UCP、ACP、x402 等协议），但独立 Agent 生态缺少一个**通用的电商对接层**——能同时连接 Shopify、WooCommerce、OpenCart 等主流电商平台，并提供 stablecoin 支付能力的开源中间件。

本项目定位为**独立的开源 Agentic Commerce Connector**：
- **上层**：通过 MCP / HTTP 向任意 AI Agent 暴露统一的商品浏览、下单、支付接口
- **下层**：通过 adapter 对接不同电商平台（Shopify、WooCommerce、OpenCart...）
- **支付层**：Nexus Protocol 作为核心支付手段（escrow + gasless + stablecoin），但项目本身不属于 Nexus 生态，可独立运作

```
Any AI Agent (MCP / HTTP)
        │
        ▼
┌─────────────────────────────┐
│  Agentic Commerce Connector │  ← 本项目
│  (open-source)              │
│                             │
│  ┌───────────────────────┐  │
│  │ Commerce Adapters     │  │    Shopify / WooCommerce / OpenCart / ...
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ Payment Provider      │  │    Nexus Protocol (EIP-712 + Escrow + USDC)
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ Core Services         │  │    Checkout Session / Rate / Order / Reconciler
│  └───────────────────────┘  │
└─────────────────────────────┘
```

---

## 架构分层

### Layer 1: Commerce Adapters（电商适配层）

每个电商平台实现两个接口：

```typescript
// CatalogAdapter — 商品读取（只读）
interface CatalogAdapter {
  searchProducts(query, first?, after?): Promise<ProductSearchResult>
  listProducts(first?, after?): Promise<ProductSearchResult>
  getProduct(handle): Promise<CommerceProduct | null>
  getVariantPrices(variantIds): Promise<readonly CommerceVariant[]>
  getStoreMeta(): Promise<StoreMeta>
}

// MerchantAdapter — 订单写入
interface MerchantAdapter {
  createOrder(session, opts?): Promise<OrderCreateResult>
  markOrderPaid(platformOrderId, txHash): Promise<void>
  cancelOrder(platformOrderId, reason?): Promise<void>
  hasExistingOrder(sessionId): Promise<boolean>
}
```

### Layer 2: Payment Provider（支付协议层）

Nexus Protocol 作为默认支付手段，但被封装为可替换的 provider：

```typescript
// PaymentProvider — 支付协议抽象
interface PaymentProvider {
  // 生成支付报价（含签名）
  buildQuote(params: QuoteParams): Promise<PaymentQuote>
  // 提交报价到支付网络，返回 checkout URL
  submitToPaymentNetwork(quote: PaymentQuote): Promise<{ checkoutUrl: string; paymentGroupId: string }>
  // 确认履约，触发资金释放
  confirmFulfillment(paymentId: string): Promise<void>
  // 验证支付回调签名
  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean
}
```

当前唯一实现：`NexusPaymentProvider`（EIP-712 签名 → nexus-core orchestrate → escrow checkout）。
未来可扩展：x402Provider、StripeACPProvider 等。

### Layer 3: Core Services（核心服务层，平台无关）

- `checkout-session.ts` — Checkout 状态机，调用 CatalogAdapter + PaymentProvider
- `rate-service.ts` — 法币 → stablecoin 汇率转换
- `order-store.ts` — 订单状态管理（内存 + DB）
- `order-writeback.ts` — 支付完成后回写电商平台订单
- `reconciler.ts` — 定期对账
- `webhook-handler.ts` — 支付回调处理 + 状态同步

---

## 目录结构

```
docs/opensource/                          ← 开源仓库根目录
├── README.md
├── LICENSE                               # MIT
├── package.json                          # @agentic/commerce-connector
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── src/
│   ├── server.ts                         # MCP + HTTP 双模式入口
│   ├── config.ts                         # 平台检测 + 配置加载
│   ├── portal.ts                         # HTTP 路由 + Dashboard
│   ├── types.ts
│   ├── types/
│   │   ├── commerce.ts                   # CommerceProduct, CommerceVariant, StoreMeta
│   │   └── payment.ts                    # PaymentQuote, PaymentProvider interface
│   ├── adapters/
│   │   ├── types.ts                      # CatalogAdapter, MerchantAdapter interfaces
│   │   ├── shopify/
│   │   │   ├── index.ts                  # createShopifyAdapters()
│   │   │   ├── config.ts
│   │   │   ├── catalog.ts               # Storefront GraphQL → CatalogAdapter
│   │   │   ├── merchant.ts              # Admin GraphQL → MerchantAdapter
│   │   │   └── cache.ts
│   │   └── woocommerce/
│   │       ├── index.ts                  # createWooCommerceAdapters()
│   │       ├── config.ts
│   │       ├── catalog.ts               # REST API → CatalogAdapter
│   │       └── merchant.ts              # REST API → MerchantAdapter
│   ├── payment/
│   │   ├── types.ts                      # PaymentProvider interface
│   │   └── nexus/
│   │       ├── index.ts                  # createNexusPaymentProvider()
│   │       ├── quote-builder.ts          # EIP-712 签名
│   │       ├── webhook-verifier.ts       # HMAC 验证
│   │       └── config.ts                 # Nexus-specific env vars
│   ├── services/
│   │   ├── checkout-session.ts           # 调用 CatalogAdapter + PaymentProvider
│   │   ├── rate-service.ts
│   │   ├── order-store.ts
│   │   ├── order-writeback.ts            # 调用 MerchantAdapter
│   │   ├── webhook-handler.ts            # 调用 PaymentProvider.verifyWebhook
│   │   ├── reconciler.ts
│   │   └── db/
│   │       ├── pool.ts
│   │       └── session-repo.ts
│   └── __tests__/
│       ├── adapter-contract.test.ts
│       ├── shopify-adapter.test.ts
│       ├── woocommerce-adapter.test.ts
│       └── checkout-flow.test.ts
├── docs/
│   ├── plans/
│   │   └── nexus-commerce-agent-refactor-plan.md   # 本文档
│   └── research/
│       ├── agentic-payments-landscape.md
│       ├── agent-payment-stack-landscape.md
│       └── commerce-protocol-comparison-ucp-acp.md
```

---

## Phase 0: 目录初始化 (Day 0)

### 0.1 从现有代码复制
```
src/nexus-shopify-agent/src/            → docs/opensource/src/
src/nexus-shopify-agent/package.json    → docs/opensource/package.json
src/nexus-shopify-agent/tsconfig.json   → docs/opensource/tsconfig.json
src/nexus-shopify-agent/Dockerfile      → docs/opensource/Dockerfile
src/nexus-shopify-agent/skill.md        → docs/opensource/skill.md
```

### 0.2 创建开源仓库根文件
- `README.md` — Agentic Commerce Connector 介绍 + quick start
- `LICENSE` — MIT
- `.env.example` — 环境变量模板
- `docker-compose.yml` — 独立部署示例
- `.gitignore` — 排除 `.env`, `node_modules`, `build/`

---

## Phase 1: 抽象层定义 (Day 1-2)

### 1.1 `src/types/commerce.ts` — 标准化商品类型
- `ShopifyProduct` → `CommerceProduct`
- `ShopifyVariant` → `CommerceVariant`
- `ShopifyImage` → `CommerceImage`
- `ShopMetadata` → `StoreMeta`

### 1.2 `src/adapters/types.ts` — CatalogAdapter + MerchantAdapter 接口

### 1.3 `src/payment/types.ts` — PaymentProvider 接口
从现有 `quote-builder.ts` + `webhook-handler.ts` 中提取抽象：
```typescript
interface PaymentProvider {
  buildQuote(params: QuoteParams): Promise<PaymentQuote>
  submitToPaymentNetwork(quote: PaymentQuote): Promise<SubmitResult>
  confirmFulfillment(paymentId: string): Promise<void>
  verifyWebhook(rawBody: string, signature: string, timestamp: string): boolean
}
```

### 1.4 全局字段重命名
- `shopify_order_id` → `platform_order_id`
- `shopify_order_name` → `platform_order_name`
- `shop_domain` → `store_url`
- `merchant_did` 保留（Payment Provider 概念，非 Nexus 专有）

---

## Phase 2: Shopify Adapter 提取 (Day 3-4)

### 2.1 移动 Shopify 代码
```
src/services/shopify/storefront-client.ts → src/adapters/shopify/catalog.ts
src/services/shopify/admin-client.ts      → src/adapters/shopify/merchant.ts
src/services/shopify/product-cache.ts     → src/adapters/shopify/cache.ts
```

### 2.2 接口适配
- `createStorefrontClient()` → `createShopifyCatalog()` (implements CatalogAdapter)
- `createAdminClient()` → `createShopifyMerchant()` (implements MerchantAdapter)
- 内部 GraphQL 逻辑不变

### 2.3 创建工厂
- `src/adapters/shopify/index.ts` — `createShopifyAdapters(config)`
- `src/adapters/shopify/config.ts` — Shopify 环境变量验证

---

## Phase 3: Nexus Payment Provider 提取 (Day 5-6)

**关键步骤**：将 Nexus 支付逻辑从核心服务中解耦为独立 provider。

### 3.1 移动 Nexus 支付代码
```
src/services/quote-builder.ts    → src/payment/nexus/quote-builder.ts
src/services/webhook-handler.ts  → 拆分：
  - 通用回调处理逻辑 → src/services/webhook-handler.ts（保留）
  - HMAC 验签 + Nexus 特有逻辑 → src/payment/nexus/webhook-verifier.ts
```

### 3.2 实现 NexusPaymentProvider
```typescript
// src/payment/nexus/index.ts
function createNexusPaymentProvider(config: NexusPaymentConfig): PaymentProvider {
  return {
    buildQuote: (params) => buildNexusQuote(params, config.signerPrivateKey),
    submitToPaymentNetwork: (quote) => submitToNexusCore(quote, config.nexusCoreUrl),
    confirmFulfillment: (paymentId) => requestSettlement(paymentId, config),
    verifyWebhook: (body, sig, ts) => verifyNexusWebhook(body, sig, ts, config.webhookSecret),
  }
}
```

### 3.3 `src/payment/nexus/config.ts` — Nexus 特有环境变量
```env
NEXUS_CORE_URL=https://api.nexus.platon.network
MERCHANT_SIGNER_PRIVATE_KEY=0x...
MERCHANT_PAYMENT_ADDRESS=0x...
CHECKOUT_BASE_URL=https://nexus.platon.network
WEBHOOK_SECRET=...
```

### 3.4 重构核心服务
- `checkout-session.ts`: 调用 `paymentProvider.buildQuote()` + `paymentProvider.submitToPaymentNetwork()` 替代直接调用 `buildQuote()` + `POST /api/orchestrate`
- `webhook-handler.ts`: 调用 `paymentProvider.verifyWebhook()` 替代硬编码 HMAC 验证
- `order-writeback.ts`: 调用 `paymentProvider.confirmFulfillment()` 替代直接 POST nexus-core

---

## Phase 4: Config & Startup (Day 7-8)

### 4.1 `src/config.ts` — 三层配置

```typescript
interface BaseConfig {
  readonly portalPort: number
  readonly databaseUrl: string
  readonly merchantDid: string          // 支付身份标识，非 Nexus 专有
  readonly paymentCurrency: string
  readonly fixedRate: number
  readonly rateLockMinutes: number
}

// Commerce platform config (discriminated union)
type PlatformType = "shopify" | "woocommerce"
interface ShopifyConfig { platform: "shopify"; shopifyStoreUrl; ... }
interface WooCommerceConfig { platform: "woocommerce"; wooBaseUrl; ... }
type CommerceConfig = ShopifyConfig | WooCommerceConfig

// Payment provider config (discriminated union)
type PaymentType = "nexus"  // 未来: "x402" | "stripe-acp"
interface NexusPaymentConfig { payment: "nexus"; nexusCoreUrl; signerKey; ... }
type PaymentConfig = NexusPaymentConfig

// Full config = Base + Commerce + Payment
type AppConfig = BaseConfig & CommerceConfig & PaymentConfig
```

### 4.2 `src/server.ts` — 启动时组装

```typescript
const config = loadConfig()

// Commerce adapters — 由 PLATFORM env 决定
const { catalog, merchant } = createCommerceAdapters(config)

// Payment provider — 由 PAYMENT_PROVIDER env 决定 (default: "nexus")
const payment = createPaymentProvider(config)

// Core services — 注入 adapters + payment provider
const checkout = createCheckoutService(catalog, merchant, payment, config)
```

### 4.3 `src/portal.ts`
- Agent name: `"Commerce Connector"` (不含 Nexus)
- Dashboard 显示 platform + payment provider 标签

### 4.4 `package.json`
- name: `@agentic/commerce-connector`
- description: "Open-source agentic commerce connector — bridge AI agents to Shopify, WooCommerce, and more with stablecoin payments"

---

## Phase 5: WooCommerce Adapter (Day 9-12)

### 5.1 `src/adapters/woocommerce/catalog.ts` — CatalogAdapter

| Method | WooCommerce REST API |
|---|---|
| `searchProducts(query)` | `GET /wp-json/wc/v3/products?search={query}` |
| `listProducts()` | `GET /wp-json/wc/v3/products` |
| `getProduct(handle)` | `GET /wp-json/wc/v3/products?slug={handle}` |
| `getVariantPrices(ids)` | `GET /wp-json/wc/v3/products/{parentId}/variations/{varId}` |
| `getStoreMeta()` | `GET /wp-json/wc/v3/system_status` |

Auth: HTTP Basic (consumer key + secret over HTTPS)。

### 5.2 `src/adapters/woocommerce/merchant.ts` — MerchantAdapter

| Method | WooCommerce REST API |
|---|---|
| `createOrder(session)` | `POST /wp-json/wc/v3/orders` |
| `markOrderPaid(id, tx)` | `PUT /orders/{id}` + `POST /orders/{id}/notes` |
| `cancelOrder(id)` | `PUT /orders/{id} { status: "cancelled" }` |
| `hasExistingOrder(sid)` | `GET /orders?meta_key=nexus_session_id&meta_value={sid}` |

---

## Phase 6: Testing (Day 13-15)

### 6.1 Adapter contract tests
- 统一测试套件，任何 adapter 必须通过
- 验证标准化输出 shape、null handling、error cases

### 6.2 Payment provider tests
- Mock Nexus Core API，验证 quote 签名 + webhook 验签
- 验证 `submitToPaymentNetwork()` 正确构造 orchestrate 请求

### 6.3 Integration tests
- Mock adapters + mock payment provider
- 验证完整 checkout flow 不依赖任何真实平台

---

## Phase 7: 文档 (Day 16-18)

### 7.1 `README.md` 结构
```
# Agentic Commerce Connector
> Bridge AI agents to any e-commerce platform with stablecoin payments

## Features
- Shopify adapter (Storefront + Admin GraphQL)
- WooCommerce adapter (REST API)
- Nexus Protocol payment (EIP-712 + escrow + USDC)
- MCP + HTTP dual-mode interface

## Quick Start
## Configuration
## Adding a New E-commerce Adapter
## Adding a New Payment Provider
## API Reference
```

### 7.2 `.env.example`
```env
# Platform: shopify | woocommerce
PLATFORM=shopify

# Payment Provider: nexus
PAYMENT_PROVIDER=nexus

# Common
MERCHANT_DID=did:example:my-store
PORTAL_PORT=10000
DATABASE_URL=postgresql://...

# Shopify (when PLATFORM=shopify)
SHOPIFY_STORE_URL=my-store.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=...
SHOPIFY_ADMIN_TOKEN=shpat_...

# WooCommerce (when PLATFORM=woocommerce)
WOO_BASE_URL=https://my-store.example.com
WOO_CONSUMER_KEY=ck_...
WOO_CONSUMER_SECRET=cs_...

# Nexus Payment (when PAYMENT_PROVIDER=nexus)
NEXUS_CORE_URL=https://api.nexus.platon.network
MERCHANT_SIGNER_PRIVATE_KEY=0x...
MERCHANT_PAYMENT_ADDRESS=0x...
CHECKOUT_BASE_URL=https://nexus.platon.network
```

### 7.3 Verification
```bash
GET  /api/v1/products?q=snowboard
GET  /api/v1/products/:handle
POST /api/v1/checkout
GET  /api/v1/checkout/:sessionId
POST /webhook
```

---

## 与原 Nexus 主仓库的关系

| 维度 | 本开源项目 (`docs/opensource/`) | Nexus 主仓库 (`src/nexus-shopify-agent/`) |
|---|---|---|
| 定位 | 独立开源项目，可独立 git repo | 内部生产部署 |
| 品牌 | `@agentic/commerce-connector` | `nexus-shopify-agent` |
| Nexus 角色 | Payment Provider 之一 | 核心基础设施 |
| 同步方式 | 开源为 source of truth | 从开源拉取 + 覆盖配置 |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| 生产部署中断 | `src/nexus-shopify-agent/` 保持不动，新代码在 `docs/opensource/` 开发 |
| PaymentProvider 抽象过度 | 当前只有 Nexus 一个实现，接口设计从实际代码反向提取 |
| WooCommerce 分页差异 | Page 编号编码为 opaque cursor string |
| 泄露密钥 | `.env.example` 仅模板；`.gitignore` 排除 `.env` |
| `PLATFORM` / `PAYMENT_PROVIDER` 缺失 | 默认 `shopify` + `nexus`，向后兼容 |
