# Implementation Plan: Agentic Commerce Connector (UCP-Native)

> **Revision 2 — 2026-04-15**
> Supersedes the original NUPS-HTTP plan. All adapters now expose UCP/1.0 as the outward protocol; NUPS remains as a payment-layer protocol (UCP-compatible), plugged in via `PaymentProvider`.

---

## Context

AI Agent 驱动的电商生态正在围绕 **Universal Commerce Protocol (UCP)** 收敛——Google、Stripe、Shopify、WooCommerce 等平台都在适配。我们的开源 Connector 原先使用 Nexus 自研的 `NUPS/1.5 HTTP` 接口 (`/api/v1/*`)，无法接入 UCP 生态。

本修订版把 Connector 的**对外契约全面升级为 UCP/1.0**：
- **对外协议**：UCP/1.0（Discovery / Search / Cart / Delegated Checkout / Order Attribution）
- **支付协议**：NUPS/1.5 作为 `PaymentProvider` 的一个实现（UCP 兼容），可被其他协议替换（x402 / ACP / AP2）
- **平台适配**：Shopify + WooCommerce 均实现同一套 UCP 端点，内部通过 `CatalogAdapter` / `MerchantAdapter` 抽象

```
  AI Agent (MCP / UCP-HTTP)
         │
         ▼  UCP/1.0 façade
 ┌────────────────────────────┐
 │  /ucp/v1/discovery         │
 │  /ucp/v1/search            │
 │  /ucp/v1/checkout          │
 │  /ucp/v1/checkout/{token}  │
 │  /ucp/v1/checkout/{token}/complete
 │  /ucp/v1/orders/{id}       │
 └──────────┬─────────────────┘
            │
  CatalogAdapter + MerchantAdapter  (platform-neutral)
            │
  PaymentProvider  ←  NexusPaymentProvider (NUPS/1.5)
            │
  Shopify REST/GraphQL  ·  WooCommerce REST v3
```

---

## 架构分层

### Layer 1: UCP Façade（对外协议层，NEW）
- 实现 UCP/1.0 五阶段端点 + 无状态 HMAC cart token
- 使用官方 UCP JSON schema 做请求/响应校验
- MCP tool 透传到同一批 UCP handler
- Legacy `/api/v1/*` 路由移除（或保留为 30 天 deprecation alias）

### Layer 2: Commerce Adapters（电商适配层，保留抽象）
每个平台实现两个接口：
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
- Shopify 适配器在 Phase 2 补齐 UCP 必需字段（sku/brand/inventory）
- WooCommerce 适配器 Phase 3 从零搭建，UCP-native

### Layer 3: Payment Provider（支付协议层）
```typescript
interface PaymentProvider {
  buildQuote(params): Promise<PaymentQuote>
  submitToPaymentNetwork(quote): Promise<{ checkoutUrl; paymentGroupId }>
  confirmFulfillment(paymentId): Promise<void>
  verifyWebhook(rawBody, sig, ts): boolean
  describe(): PaymentProviderDescriptor  // 给 UCP discovery 用
}
```
- `NexusPaymentProvider` 实现 NUPS/1.5（现在才真正抽离）
- UCP `discovery` 广告 `payment_providers` 数组
- UCP `checkout/{token}/complete` 调用 `PaymentProvider.submitToPaymentNetwork()`

### Layer 4: Core Services（平台无关，保留）
`checkout-session`, `rate-service`, `order-store`, `order-writeback`, `reconciler` — 已完成；小幅调整以对齐 UCP cart 概念。

---

## 目录结构（修订后）

```
docs/opensource/
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── portal.ts
│   ├── ucp/                           # NEW — UCP façade
│   │   ├── types.ts                   #   UCP 类型 (zod)
│   │   ├── mappers.ts                 #   internal ↔ UCP 映射
│   │   ├── routes.ts                  #   /ucp/v1/* 路由
│   │   ├── cart-token.ts              #   HMAC cart token
│   │   └── schemas/                   #   vendored UCP JSON schemas
│   ├── adapters/
│   │   ├── types.ts                   # CatalogAdapter + MerchantAdapter
│   │   ├── shopify/                   # 已完成；Phase 2 补齐 UCP 字段
│   │   │   ├── storefront-client.ts
│   │   │   ├── admin-client.ts
│   │   │   ├── product-cache.ts
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   └── woocommerce/               # NEW — Phase 3
│   │       ├── catalog.ts
│   │       ├── merchant.ts
│   │       ├── product-cache.ts
│   │       ├── config.ts
│   │       └── index.ts
│   ├── payment/
│   │   ├── types.ts                   # PaymentProvider interface
│   │   └── nexus/                     # NEW — Phase 4
│   │       ├── provider.ts            #   NexusPaymentProvider 实现
│   │       ├── quote-builder.ts       #   从 services/ 迁移
│   │       ├── webhook-verifier.ts
│   │       └── config.ts
│   ├── services/
│   │   ├── checkout-session.ts        # 调整：调用 PaymentProvider
│   │   ├── rate-service.ts
│   │   ├── order-store.ts
│   │   ├── order-writeback.ts         # 调整：调用 PaymentProvider
│   │   ├── reconciler.ts
│   │   ├── webhook-handler.ts         # 调整：PaymentProvider.verifyWebhook
│   │   └── db/
│   ├── types/
│   │   └── commerce.ts
│   ├── types.ts
│   └── __tests__/
│       ├── ucp-contract.test.ts       # NEW — UCP schema 校验
│       ├── adapter-contract.test.ts   # 跨 adapter parity
│       ├── shopify-adapter.test.ts
│       ├── woocommerce-adapter.test.ts  # NEW
│       ├── webhook-checkout.test.ts
│       └── utils.test.ts
└── docs/
    ├── plans/nexus-commerce-agent-refactor-plan.md   # 本文件
    └── research/
```

---

## 进度快照（2026-04-15）

| Phase | 状态 | 备注 |
|---|---|---|
| Phase 0 旧版：目录初始化 | ✅ 完成 | README / package.json / Docker 已有 |
| Phase 1 旧版：抽象层定义 | ✅ 完成 | `adapters/types.ts`, `payment/types.ts` |
| Phase 2 旧版：Shopify 适配器提取 | ✅ 完成 | `adapters/shopify/*` |
| Phase 3 旧版：Nexus PaymentProvider 提取 | ⚠️ 仅接口，实现未迁移 | 本次 Phase 4 完成 |
| Phase 4 旧版：Config & Startup | ✅ 完成 | server/portal 已组装 adapter |
| Phase 5 旧版：WooCommerce Adapter | ❌ 未开始 | 本次 Phase 3 完成 |
| Phase 6 旧版：Testing | 🟡 部分 | adapter-contract + shopify + webhook |

---

## Phase 0: UCP Spec Ingestion & 类型定义 (Day 1)

### 0.1 Vendor UCP schemas
- 从 https://github.com/Universal-Commerce-Protocol/ucp 拉取 JSON schemas（pin 到具体 commit hash）
- 保存至 `src/ucp/schemas/` — `discovery.schema.json`, `search.schema.json`, `cart.schema.json`, `order.schema.json`
- 记录版本号到 `src/ucp/schemas/VERSION`

### 0.2 `src/ucp/types.ts` — Zod 类型
```typescript
export const UCPDiscoveryResponse = z.object({
  protocol_version: z.literal("1.0"),
  store: z.object({ name: z.string(), currency_code: z.string(), primary_domain: z.string() }),
  capabilities: z.array(z.enum(["search","cart","checkout","order_attribution"])),
  payment_providers: z.array(z.object({
    id: z.string(), protocol: z.string(), currencies: z.array(z.string()),
  })),
})
export const UCPSearchRequest = z.object({ query: z.string(), first: z.number().int().min(1).max(50).optional(), after: z.string().nullable().optional() })
export const UCPCartItem = z.object({ variant_id: z.string(), quantity: z.number().int().min(1), unit_price: z.string(), currency_code: z.string() })
export const UCPCart = z.object({ token: z.string(), items: z.array(UCPCartItem), subtotal: z.string(), currency_code: z.string(), expires_at: z.string() })
// ... 其他 UCP 类型
```

### 0.3 `src/ucp/mappers.ts` — 映射层
```typescript
commerceProductToUcp(product: CommerceProduct): UCPProduct
checkoutSessionToUcpCart(session: CheckoutSession, token: string): UCPCart
orderEventToUcpAttribution(event): UCPOrderEvent
```

**Verify:** `npm run build` 通过；`ucp/types.ts` 可解析 UCP 官方 sample fixture。

---

## Phase 1: UCP Façade 层 (Day 2-3)

### 1.1 HMAC Cart Token (`src/ucp/cart-token.ts`)
```typescript
interface CartTokenPayload { sessionId: string; issuedAt: number; expiresAt: number }
function issueCartToken(payload, secret): string      // base64url( json + "." + hmacSha256 )
function verifyCartToken(token, secret): CartTokenPayload | null
```
- Secret 从 `UCP_CART_TOKEN_SECRET` 环境变量加载（至少 32 字节随机）
- TTL 从 `UCP_TOKEN_TTL_SECONDS` 加载，默认 900（15 分钟）

### 1.2 UCP Routes (`src/ucp/routes.ts`)
| Method | Path | Handler 行为 |
|---|---|---|
| GET | `/ucp/v1/discovery` | 返回 store meta + payment_providers (调用 `paymentProvider.describe()`) |
| POST | `/ucp/v1/search` | `CatalogAdapter.searchProducts` + `mappers.commerceProductToUcp` |
| GET | `/ucp/v1/products/{handle}` | `CatalogAdapter.getProduct`（UCP 扩展，便于 deep-link） |
| POST | `/ucp/v1/checkout` | 创建 session → issueCartToken → 返回 UCP cart |
| POST | `/ucp/v1/checkout/{token}` | verifyCartToken → update line items → 返回 UCP cart |
| POST | `/ucp/v1/checkout/{token}/complete` | verifyCartToken → `paymentProvider.buildQuote` + `submitToPaymentNetwork` → 返回 `{payment_link, payment_id, expires_at}` |
| GET | `/ucp/v1/orders/{id}` | `MerchantAdapter.hasExistingOrder` + 状态快照 |

所有 handler：
- 入参用 Zod schema parse；失败返回 `{ error: { code: "INVALID_REQUEST", details } }`（UCP 错误格式）
- 响应用 `mappers` 转换为 UCP shape

### 1.3 Portal 挂载
- `src/portal.ts` 挂载 `/ucp/v1/*` 路由
- 移除 `/api/v1/*` 注册；若 Phase 6 审计发现内部调用方，保留 30 天 alias

### 1.4 MCP Tools 重写
- `search_products`, `get_product`, `create_checkout`, `check_checkout_status` handler 内部改调 UCP handler（同一 code path），对外 tool name/schema 不变

**Verify:** `curl /ucp/v1/discovery` 返回合法 UCP/1.0 响应；cart token 签名+过期测试通过。

---

## Phase 2: Shopify 适配器 UCP 对齐 (Day 4-5)

### 2.1 字段补齐
`src/adapters/shopify/storefront-client.ts` GraphQL query 追加：
- `sku`, `weight`, `weightUnit`（UCP Search 可选但推荐）
- `vendor` → UCP `brand`
- `totalInventory` → UCP `inventory_quantity`

### 2.2 OrderAttribution 事件
`src/adapters/shopify/admin-client.ts`:
- `createOrder` 成功后触发 `OrderEventEmitter.emit("created", ucpEvent)`
- `markOrderPaid` 触发 `paid`
- `cancelOrder` 触发 `cancelled`

### 2.3 skill.md 升级
```yaml
protocol: UCP/1.0
payment_protocol: NUPS/1.5
category: commerce.universal
endpoints:
  - GET  /ucp/v1/discovery
  - POST /ucp/v1/search
  - GET  /ucp/v1/products/:handle
  - POST /ucp/v1/checkout
  - POST /ucp/v1/checkout/:token
  - POST /ucp/v1/checkout/:token/complete
  - GET  /ucp/v1/orders/:id
```

**Verify:** 对同一 Shopify 店的 UCP discovery + search + full checkout 仍通过端到端。

---

## Phase 3: WooCommerce Adapter (UCP-Native) (Day 6-7)

### 3.1 `src/adapters/woocommerce/config.ts`
```typescript
interface WooCommercePlatformConfig {
  baseUrl: string                 // https://store.example.com
  consumerKey: string             // ck_xxx
  consumerSecret: string          // cs_xxx
  apiVersion: string              // "wc/v3" (default)
}
validateWooConfig(env): WooCommercePlatformConfig  // HTTPS-only enforcement
```

### 3.2 `src/adapters/woocommerce/catalog.ts` — CatalogAdapter
| 接口方法 | WC REST v3 调用 | UCP 映射 |
|---|---|---|
| `searchProducts(q, first, after)` | `GET /wc/v3/products?search=&per_page=&page=` | `UCPSearchResponse.items[]` |
| `listProducts(first, after)` | `GET /wc/v3/products` | 同上（空 query） |
| `getProduct(handle)` | `GET /wc/v3/products?slug={handle}` → `[0]` | `UCPProduct` |
| `getVariantPrices(ids)` | 批量 `GET /wc/v3/products/{parentId}/variations/{varId}` | `UCPCartItem.unit_price` |
| `getStoreMeta()` | `GET /wc/v3/system_status` 或 `/settings/general` | `UCPDiscoveryResponse.store` |

- Variant ID 编码为 `"{parentId}:{variationId}"`
- Cursor ↔ page number 映射 (opaque base64 of `{page}`)
- Retry with jitter on 429/5xx
- Auth: `Authorization: Basic base64(ck:cs)`，日志遮蔽

### 3.3 `src/adapters/woocommerce/merchant.ts` — MerchantAdapter
| 接口方法 | WC REST v3 调用 | UCP 事件 |
|---|---|---|
| `createOrder(session)` | `POST /wc/v3/orders`, `{status:"on-hold", line_items, billing, meta_data:[{key:"nexus_session_id"},{key:"nexus_group_id"},{key:"ucp_cart_token"}]}` | `OrderAttribution.created` |
| `markOrderPaid(id, tx)` | `PUT /wc/v3/orders/{id} {status:"processing", transaction_id:tx}` + `POST /wc/v3/orders/{id}/notes` | `OrderAttribution.paid` |
| `cancelOrder(id, reason)` | `PUT /wc/v3/orders/{id} {status:"cancelled"}` + note | `OrderAttribution.cancelled` |
| `hasExistingOrder(sid)` | `GET /wc/v3/orders?meta_key=nexus_session_id&meta_value={sid}` | — |

Fallback：若主机禁用 `meta_query`（常见于廉价 shared hosting），退化为最近 N 条订单的线性扫描，通过 `customer_note` 字段查找 session id。

### 3.4 `src/adapters/woocommerce/index.ts` 工厂
```typescript
export function createWooCommerceAdapters(cfg): AdapterPair {
  return { catalog: createWooCatalog(cfg), merchant: createWooMerchant(cfg) }
}
```
- Wire `case "woocommerce"` into [server.ts:45-62] `createAdaptersForConfig`
- `.env.example` 追加 `WOO_BASE_URL` / `WOO_CONSUMER_KEY` / `WOO_CONSUMER_SECRET`

**Verify:** `PLATFORM=woocommerce` 启动；UCP discovery + search 返回真实 Woo 商品；完整 checkout flow 到订单 `processing`。

---

## Phase 4: NUPS as UCP Payment Provider (Day 8)

### 4.1 抽离 Nexus 实现
- 将 `services/quote-builder.ts` → `payment/nexus/quote-builder.ts`
- 将 webhook HMAC 验签从 `services/webhook-handler.ts` → `payment/nexus/webhook-verifier.ts`
- 新增 `payment/nexus/provider.ts`:
```typescript
export function createNexusPaymentProvider(cfg): PaymentProvider {
  return {
    buildQuote: (p) => buildNexusQuote(p, cfg.signerPrivateKey),
    submitToPaymentNetwork: (q) => submitToNexusCore(q, cfg.nexusCoreUrl),
    confirmFulfillment: (pid) => requestSettlement(pid, cfg),
    verifyWebhook: (b, s, t) => verifyNexusWebhook(b, s, t, cfg.webhookSecret),
    describe: () => ({ id:"nexus", protocol:"NUPS/1.5", currencies:["USDC","XSGD"] }),
  }
}
```

### 4.2 Core services 解耦
- `services/checkout-session.ts` → 构造函数注入 `paymentProvider`；替换直接 `POST /api/orchestrate`
- `services/webhook-handler.ts` → 调用 `paymentProvider.verifyWebhook`
- `services/order-writeback.ts` → 调用 `paymentProvider.confirmFulfillment`

### 4.3 UCP Discovery 集成
UCP `/ucp/v1/discovery.payment_providers` 来自 `paymentProvider.describe()`，未来新增 `x402Provider` 无需改路由。

**Verify:** 替换实现后，Shopify+Woo 的 checkout complete 都能成功生成 Nexus `checkout_url`。

---

## Phase 5: Contract + E2E Tests (Day 9-10)

### 5.1 UCP Contract Tests (`__tests__/ucp-contract.test.ts`)
- 加载 vendored JSON schemas
- 对每个 UCP endpoint 触发后，用 `Ajv` 验证响应
- 跑两遍：`PLATFORM=shopify` 和 `PLATFORM=woocommerce`

### 5.2 Cross-Adapter Parity
- 扩展 `adapter-contract.test.ts`：同一套 shape 断言在 Shopify 和 Woo 上都通过
- Mock fetch 层，使用 fixture

### 5.3 WooCommerce Adapter Unit Tests (`__tests__/woocommerce-adapter.test.ts`)
- 分页 cursor ↔ page 往返
- Variant ID encode/decode
- Basic auth header 构造（遮蔽测试）
- `hasExistingOrder` + 主机禁用 meta_query 的 fallback 路径
- 429 retry jitter

### 5.4 E2E Smoke
- Woo sandbox: discovery → search → checkout → complete → pay (Nexus testnet) → webhook → `on-hold` → `processing`
- Shopify staging: 同样流程

**Verify:** `npm test` 全绿；覆盖率 ≥ 80%。

---

## Phase 6: 文档 + Cutover (Day 11)

### 6.1 README 更新
- 顶部强调 UCP-native 定位
- Features 增加 "UCP/1.0 protocol, drop-in for any UCP-compatible AI agent"
- 移除 `/api/v1/*` 引用；保留 NUPS 说明于 Payment Provider 章节

### 6.2 `docs/ucp-compliance.md` 新增
- 对照 UCP/1.0 spec 逐项说明已支持 / 未支持（例如 Identity Linking OAuth 未实现，anonymous checkout only）

### 6.3 `.env.example` 修订
```env
PLATFORM=shopify|woocommerce
PAYMENT_PROVIDER=nexus

# UCP
UCP_CART_TOKEN_SECRET=<32+ random bytes>
UCP_TOKEN_TTL_SECONDS=900

# Shopify
SHOPIFY_STORE_URL=... SHOPIFY_STOREFRONT_TOKEN=... SHOPIFY_ADMIN_TOKEN=...

# WooCommerce
WOO_BASE_URL=https://store.example.com
WOO_CONSUMER_KEY=ck_...
WOO_CONSUMER_SECRET=cs_...

# Nexus Payment
NEXUS_CORE_URL=https://api.nexus.platon.network
MERCHANT_SIGNER_PRIVATE_KEY=0x...
MERCHANT_PAYMENT_ADDRESS=0x...
CHECKOUT_BASE_URL=https://nexus.platon.network
```

### 6.4 CHANGELOG & Cutover
- CHANGELOG v0.2.0: "UCP/1.0 façade, WooCommerce adapter, NUPS as PaymentProvider"
- 审计内部对 `/api/v1/*` 的调用方（`src/nexus-website/`, `src/mvp-ai-agent/`）
- 若存在调用方：保留 30 天 alias route，返回 `Deprecation:` header
- 若无调用方：直接移除

---

## 开放问题（默认方案）

1. **Path prefix**：`/ucp/v1/*`（不使用 WordPress 风格 `/wp-json/ucp/v1/*`）。
2. **OAuth Identity Linking**：MVP 不实现，anonymous checkout。Phase 7+ 再说。
3. **Legacy `/api/v1/*`**：先审计调用方；若有，保留 30 天 alias；若无，直接删。

---

## 依赖

- vendored UCP JSON schemas（from `Universal-Commerce-Protocol/ucp` 某 commit hash）
- `ajv` (runtime JSON schema 校验) — 新增 dev dep
- `zod` (已存在)
- 原生 `crypto.createHmac` — cart token
- 无其他 runtime 新增

---

## 风险与缓解

| Risk | Severity | Mitigation |
|---|---|---|
| UCP/1.0 spec 仍在演化，字段可能变化 | HIGH | Pin 到 commit hash；façade 版本标注 `UCP/1.0-rc` 备用 |
| Cart token 无状态 vs `checkout_sessions` 有状态 | MEDIUM | Token 仅承载 session_id + HMAC；DB 是 source of truth |
| Shopify `CheckoutSession` 与 UCP Cart shape 不同 | MEDIUM | `mappers.ts` 隔离；不动内部类型 |
| Woo `meta_query` 在部分 shared host 被禁 | MEDIUM | Fallback：近 N 单线性扫描 + `customer_note` tag |
| HTTP Basic 凭证泄漏到日志 | HIGH | Logger 全局过滤 `Authorization` header；HTTPS-only 在 config validator 强制 |
| 删除 `/api/v1/*` 打破内部调用方 | HIGH | Phase 6 先审计；有则 alias，无则删 |
| UCPReady licence 归因问题 | LOW | 仅参考 UCP 公开 spec，不复用 UCPReady 代码；README 致谢 |
| WC REST 429 rate limit | MEDIUM | Exponential backoff with jitter；推荐 `per_page=100` |

---

## 工期估算

| Phase | 天数 |
|---|---|
| 0 UCP schema + types | 1 |
| 1 UCP façade + cart token | 2 |
| 2 Shopify UCP 对齐 | 1.5 |
| 3 WooCommerce adapter | 2 |
| 4 NUPS PaymentProvider 抽离 | 1 |
| 5 Contract + E2E tests | 1.5 |
| 6 Docs + cutover | 0.5 |
| **合计** | **~9.5 天** |

---

## Deliverables Checklist

- [ ] `src/ucp/{types,mappers,routes,cart-token,schemas}/` 全部就位
- [ ] Shopify 适配器 UCP 字段补齐；skill.md 升级到 UCP/1.0
- [ ] `adapters/woocommerce/{config,catalog,merchant,index}.ts`
- [ ] `payment/nexus/provider.ts` 实现 `PaymentProvider`
- [ ] `server.ts` woocommerce 分支通路
- [ ] `__tests__/ucp-contract.test.ts` + `woocommerce-adapter.test.ts` + cross-parity
- [ ] README / `docs/ucp-compliance.md` / CHANGELOG 更新
- [ ] Shopify + Woo 双 sandbox e2e 通过

---

## 与原 Nexus 主仓库的关系

| 维度 | 本开源项目 (`docs/opensource/`) | Nexus 主仓库 (`src/nexus-shopify-agent/`) |
|---|---|---|
| 定位 | 独立开源项目，UCP-native | 内部生产部署 |
| 协议 | UCP/1.0（对外）+ NUPS/1.5（支付） | NUPS/1.5（仍是旧契约） |
| Nexus 角色 | PaymentProvider 之一 | 核心基础设施 |
| 同步方式 | 开源为 source of truth；生产端按需回灌 | 本次不动 |
