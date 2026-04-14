# Agent Payment Stack 竞品分析报告

> 数据来源：[agentpaymentsstack.com](https://agentpaymentsstack.com/) 及公开资料
> 更新日期：2026-03-31
> 分析对象：Agent Payment Stack 中 162 个项目的分类、能力对比与 Nexus 定位分析

---

## 一、市场概览

截至 2026 年 3 月，AI Agent 支付生态已累计完成 **1.4 亿笔交易**、结算金额达 **4,300 万美元**。仅 2026 年 3 月 17-23 日一周内，就发生了 Mastercard 以 18 亿美元收购 BVNK、Stripe 旗下 Tempo 区块链主网上线、MoonPay 发布 Open Wallet Standard 等重大事件。McKinsey 估计 Agentic Commerce 到 2030 年将创造 3-5 万亿美元全球收入。

Agent Payment Stack 将整个生态分为 **6 层架构**，共追踪 **162 个项目**。

---

## 二、六层分类与代表项目

### Layer 1: Settlement（结算层）

负责资金的最终流转和链上确认。

| 项目 | 类型 | 核心能力 | 备注 |
|------|------|----------|------|
| **Base** (Coinbase L2) | 区块链 | Coinbase 的 L2，x402 主要结算网络 | 75M tx / $24M settled (截至 2025.12) |
| **Tempo** (Stripe/Paradigm) | 区块链 | 支付专用 L1，MPP 协议的结算层 | 2026.03 主网上线，$5B 估值 |
| **Solana** | 区块链 | 高吞吐、低费用，USDC 主要流通链 | 2026.02 处理 $650B 稳定币交易 |
| **Ethereum / Arbitrum** | 区块链 | 智能合约生态，DeFi 基础设施 | Nexus Escrow 合约当前部署链 |
| **Circle (USDC)** | 稳定币 | 98.6% agent 支付使用 USDC 结算 | 30+ 链原生支持 |
| **BVNK** | 稳定币基础设施 | 企业级稳定币支付基础设施 | Mastercard $1.8B 收购 |

**Nexus 在此层的定位**：Nexus 不是结算链本身，而是结算链之上的 **Escrow Settlement Provider**。Nexus 的 UUPS 可升级 Escrow 合约部署在 EVM 链上，提供 12 状态机管理的资金托管与释放，这是其他结算层项目不具备的交易保护能力。

---

### Layer 2: Wallet（钱包层）

为 AI Agent 提供密钥管理、资金托管和交易签名能力。

| 项目 | 核心能力 | 特色 |
|------|----------|------|
| **Coinbase AgentKit** | Agent 自主钱包，内建安全护栏 | 2026.02 发布，首个专为 Agent 设计的钱包基础设施 |
| **Privy** (Stripe 生态) | 嵌入式钱包，社交登录 | Stripe 钱包层，支撑 MPP/ACP 交易签名 |
| **Para** | 可编程 Agent 钱包，MPC 密钥 | SBC/Aomi/Colossus 使用其作为钱包基础设施 |
| **Openfort** | Agent 钱包 + PaymasterV3 | 支持 USDC 付 gas，ERC-8004 兼容 |
| **MoonPay Agents** | 非托管 Agent 钱包 | 支持 x402 兼容，跨链 swap |
| **Crossmint** | Agent 虚拟卡 + 钱包 | $23.6M 融资，40K+ 开发者使用，40+ 链 |

**Nexus 在此层的定位**：Nexus 通过 RFC-007 定义了 Buyer/Seller Plugin 的 MPC 地址流程，但不直接提供通用钱包产品。Nexus 关注的是 **支付流程中的签名与授权**（EIP-3009 + EIP-712 双签名），而非通用资产管理。这意味着 Nexus 与上述钱包项目是合作关系而非竞争。

---

### Layer 3: Routing（路由层）

负责支付通道的选择、法币/加密货币的转换。

| 项目 | 核心能力 | 特色 |
|------|----------|------|
| **Bridge** (Stripe) | 法币↔稳定币转换 | Stripe 收购，MPP 生态的法币入口 |
| **BANXA** | 法币入金/出金 | 多链支持的 on/off-ramp |
| **Colossus** | 稳定币卡网络 | 连接 Agent 支付与传统卡网络 |
| **Lithic** | 虚拟卡发行 | 为 Agent 提供可编程虚拟卡 |

**Nexus 在此层的定位**：Nexus 的 **协议路由器 (Protocol Router)** 是其核心差异化能力——同一商户可以同时服务 AP2 Agent、x402 Agent 和原生 NUPS Agent，无需为每个协议单独接入。这使 Nexus 不是单纯的支付通道路由，而是 **协议层面的路由**，这在整个 Stack 中是独特的。

---

### Layer 4: Protocol（协议层）

定义 Agent 如何发起、授权和完成支付。这是 Nexus 最核心的竞争层。

| 协议 | 发起方 | 核心机制 | 结算方式 | 适用场景 |
|------|--------|----------|----------|----------|
| **x402** | Coinbase | HTTP 402 状态码 + USDC 付款证明 | 链上 USDC (Base) | API 微支付、Agent-to-Agent |
| **ACP** | OpenAI + Stripe | 商户目录 + Agent 结账流程 | 法币（Stripe）+ 稳定币 | ChatGPT 内购物 |
| **AP2** | Google + 100+ 伙伴 | 三层 Mandate (Intent→Cart→Payment) VC | 卡网络 + 加密 | Agent 授权验证 |
| **MPP** | Stripe + Tempo | Session 预授权 + 微支付流 | Tempo L1 + 法币 | 机器对机器持续付费 |
| **UCP** | Google 联盟 | Checkout Session，A2A 协议集成 | 多种 | 搜索/Gemini 内购物 |
| **Visa TAP** | Visa | Agent 公钥注册 + HTTP 签名 | Visa 卡网络 | 商户验证 Agent 身份 |
| **KYAPay** | Skyfire | JWT 签名的 Agent 身份验证 | USDC | Agent 身份验证 + 即时结算 |
| **Nekuda Mandate** | Nekuda | Agentic Mandate（花费限额+条件授权） | 多种 | 用户授权管理 |

**Nexus 在此层的定位**：

Nexus 的 NUPS (Nexus Unified Payment Standard) 是一个 **Escrow-First Settlement Protocol**，在协议层的差异化在于：

1. **Escrow 保护**：x402 是即时付款（pay-then-receive），ACP 依赖 Stripe 的退款机制，AP2 不定义结算。Nexus 是唯一在协议层内置 Escrow 的项目——资金先锁定，服务交付后释放。
2. **多商户编排**：AP2 的 CartMandate 绑定单一商户。Nexus 支持 N 个 CartMandate 打包为一笔链上交易，独立 Escrow、独立释放。
3. **协议路由**：Nexus 可以同时理解 x402、AP2、NUPS 格式，对外统一暴露商户能力。

---

### Layer 5: Governance（治理层）

定义 Agent 身份、信任评级和合规框架。

| 项目 | 核心能力 | 特色 |
|------|----------|------|
| **ERC-8004** | Trustless Agent 身份注册 + 信誉系统 | Coinbase 发起，链上 Agent 身份标准 |
| **World ID (AgentKit)** | 人类身份证明绑定 Agent | Sam Altman 项目，x402 + Coinbase 集成 |
| **SPTs** (Stripe) | Stripe Payment Tokens，Agent 授权凭证 | Stripe 生态的治理层 |
| **Agentic Commerce Consortium** | 行业联盟标准 | Basis Theory 发起，Lithic/Skyfire/Rye/Crossmint 参与 |
| **Visa Agent Directory** | Agent 公钥注册表 | Visa 管理的可信 Agent 目录 |

**Nexus 在此层的定位**：Nexus 使用 DID (Decentralized Identifier) 作为 Agent 身份标识，并在 AP2 兼容方案中预留了 Credential Provider 角色。Nexus 的治理特色是 **交易层面的仲裁机制**——通过 Escrow 合约的 Arbitrator 角色和超时自动退款，而非依赖链上信誉评分。

---

### Layer 6: Application（应用层）

面向终端用户和商户的 Agent Commerce 应用。

| 项目 | 核心能力 | 特色 |
|------|----------|------|
| **Rye** | Agent 购物 API | 商户目录 + 一键购买 |
| **Henry Labs** | Agentic 一键结账 | 基于 Nekuda 钱包 SDK |
| **Proxy** | AI Agent 支付平台 | 综合性 Agent 支付方案 |
| **Paid.ai** | Agent 计费与变现 | 确保商户准确计费 Agent 消费 |
| **Payman** | Agent 独立钱包 + 支付 | $5M+ 融资，Agent 自主转账 |
| **Skyfire** | Agent Checkout + 身份验证 | $9.5M 融资，千级日交易量 |
| **Sapiom / Catena / Natural / PayOS** | 跨层支付平台 | 各有侧重的 Agent 支付服务 |

**Nexus 在此层的定位**：Nexus 不是应用层产品，而是为应用层提供 **Settlement + Protocol 基础设施**。应用层项目（如 Rye、Skyfire、Payman）可以使用 Nexus 作为其底层结算引擎。

---

## 三、核心竞争对手深度对比

### 3.1 协议层直接竞品

| 维度 | Nexus (NUPS) | x402 (Coinbase) | ACP (OpenAI/Stripe) | MPP (Stripe/Tempo) |
|------|-------------|-----------------|---------------------|-------------------|
| **交易保护** | Escrow 托管（12 状态机） | 无（即时付款） | Stripe 退款机制 | Session 预授权 |
| **结算速度** | Escrow lock 即时，release 需确认 | 即时 | 法币 T+1-2，稳定币即时 | 流式微支付 |
| **多商户支付** | ✅ 批量编排 + 独立 Escrow | ❌ 单次 HTTP 请求 | ❌ 单商户 checkout | ❌ 单 session |
| **法币支持** | ❌ 仅 USDC | ❌ 仅 USDC (Base) | ✅ Stripe 法币 + 稳定币 | ✅ 法币 + Tempo |
| **协议兼容性** | AP2 + x402 + NUPS (路由器) | x402 only | ACP only | MPP only |
| **Agent 身份** | DID + AP2 Mandate | ERC-8004 | OpenAI 账户体系 | Stripe Identity |
| **适用场景** | 高价值、跨商户、需保护的交易 | API 微支付、数据购买 | 消费级购物 (ChatGPT) | 持续计算/API 消费 |
| **生态规模** | 早期（devnet 阶段） | 75M tx (2025.12) | ChatGPT 用户基础 | Stripe 商户网络 |
| **开放性** | 开源协议 + MCP 原生 | 开源 (HTTP 标准) | 半封闭 (OpenAI 生态) | Stripe 生态内 |

### 3.2 结算层竞品

| 维度 | Nexus Escrow | Skyfire | Payman | Crossmint |
|------|-------------|---------|--------|-----------|
| **结算模型** | 链上 Escrow（锁定→交付→释放） | 即时 USDC 转账 | Agent 钱包直付 | 虚拟卡代扣 |
| **交易保护** | ✅ 合约级保护 + 仲裁 | ❌ 无托管保护 | ❌ 无托管保护 | 信用卡 chargeback |
| **多商户** | ✅ 一签多付 | ❌ | ❌ | ❌ |
| **协议支持** | AP2 + x402 + NUPS | KYAPay | 自有协议 | 卡网络 |
| **MCP 原生** | ✅ (RFC-007) | 部分 | 部分 | ❌ |

---

## 四、Nexus 的差异化定位

### 4.1 在 Agent Payment Stack 中的位置

Nexus 跨越 **Layer 3 (Routing) + Layer 4 (Protocol) + 部分 Layer 1 (Settlement)** 三层：

```
Layer 6: Application    ← Nexus 用户（Rye, Skyfire 等可接入 Nexus）
Layer 5: Governance     ← Nexus 提供 DID + Escrow 仲裁
Layer 4: Protocol       ← ★ Nexus 核心层：NUPS + 协议路由器
Layer 3: Routing        ← ★ Nexus 协议路由（AP2/x402/NUPS）
Layer 2: Wallet         ← Nexus 通过 MPC Plugin 集成
Layer 1: Settlement     ← ★ Nexus Escrow 合约（EVM 链上）
```

### 4.2 三大独特能力

**1. Escrow-First Settlement（托管优先结算）**

整个 Agent Payment Stack 中 162 个项目，只有 Nexus 在协议层原生集成了 Escrow 保护机制。x402 是 pay-first（先付款后服务），ACP 依赖 Stripe 的中心化退款，AP2 不定义结算。Nexus 的 Escrow 模型给 Agent 提供了类似人类信用卡 chargeback 的保护，但以去中心化、自动化的方式实现。

**2. Multi-Protocol Router（多协议路由器）**

Coinbase 只支持 x402，Stripe 只支持 ACP/MPP，Google 只定义 AP2 授权。Nexus 的协议路由器可以同时理解和路由所有主要协议——一个商户接入 Nexus，就能同时服务所有协议的 Agent。这在碎片化的协议生态中是关键基础设施。

**3. Multi-Merchant Orchestration（多商户编排支付）**

AP2 的 CartMandate 绑定单商户，x402 是单次 HTTP 请求。Nexus 可以将 N 个商户的支付打包为一笔链上交易，每个商户独立 Escrow、独立释放。这使得复杂的 Agent 任务（如"订一趟东京旅行"涉及机票+酒店+保险）可以在一次用户签名中完成。

### 4.3 当前局限

| 局限 | 影响 | 缓解路径 |
|------|------|----------|
| 仅支持 USDC 链上结算 | 无法服务法币优先的商户 | AP2 Credential Provider 预留卡网络接入 |
| 生态规模尚小 | 缺少交易量数据和商户网络效应 | 通过 AP2 兼容接入 Google 生态 |
| devnet 阶段 | 尚未经过生产环境验证 | Q2 2026 AP2 首笔 Escrow 交易上线 |
| 无自有 Agent 钱包产品 | 依赖第三方钱包集成 | 与 Para/Openfort 等钱包层合作 |

---

## 五、竞争格局总结

### 5.1 垂直整合巨头

**Coinbase** 和 **Stripe** 是 Agent Payment Stack 中最具垂直整合度的玩家：

- Coinbase：Base (结算) → AgentKit (钱包) → x402 (协议) → ERC-8004 (治理) → on/off-ramp (路由)
- Stripe：Tempo (结算) → Privy (钱包) → ACP+MPP (协议) → SPTs (治理) → Bridge (路由)

这两家控制了从结算到应用的全栈，是所有初创项目（包括 Nexus）面临的最大竞争压力。

### 5.2 协议标准之争

当前四大协议（x402, ACP, AP2, MPP）不是直接竞争关系，而是互补层：
- **AP2** 解决授权问题（谁可以付款）
- **x402** 解决微支付问题（机器间即时付款）
- **ACP** 解决商户发现和结账问题（Agent 如何购物）
- **MPP** 解决持续计费问题（Agent 如何订阅/流式消费）

**Nexus 的机会**：这四个协议都 **不解决结算保护问题**。Nexus 作为 Escrow Settlement Layer 可以位于所有协议之下，为任何协议的交易提供资金保护。协议路由器使这一愿景在技术上可行。

### 5.3 Agent-Native 初创竞品

Skyfire ($9.5M)、Payman、Nekuda ($5M)、Crossmint ($23.6M) 等 Agent-Native 初创公司是 Nexus 最直接的竞争对手。它们的共同特点是专为 Agent 设计支付基础设施，但 **没有一家** 提供链上 Escrow 保护和多商户编排能力。

### 5.4 Nexus 的战略建议

1. **不与巨头全栈竞争**：不试图成为 Coinbase 或 Stripe，而是成为它们生态中不可替代的 Settlement 层
2. **AP2 兼容为入口**：通过 AP2 适配器接入 Google 生态的 100+ 合作伙伴，获得分发能力
3. **Escrow + Multi-merchant 为护城河**：持续强化这两个在 162 个项目中独有的能力
4. **协议路由器为网络效应**：每多支持一个协议，商户接入 Nexus 的价值就更大

---

## 六、附录：关键数据来源

- Agent Payment Stack 全景图：[agentpaymentsstack.com](https://agentpaymentsstack.com/)
- a16z Fintech Newsletter：[Agent Payments Stack](https://a16z.com/newsletter/agent-payments-stack/)
- 协议对比分析：[Crossmint Protocol Comparison](https://www.crossmint.com/learn/agentic-payments-protocols-compared)
- Openfort 协议分析：[Agentic Payments Landscape](https://www.openfort.io/blog/agentic-payments-landscape)
- Chainstack 生态分析：[Agentic Payments Landscape](https://chainstack.com/the-agentic-payments-landscape/)
- Rye 初创公司分析：[Agentic Commerce Startups](https://rye.com/blog/agentic-commerce-startups)
- Proxy AI 支付格局：[AI Agent Payments Landscape 2026](https://www.useproxy.ai/blog/ai-agent-payments-landscape-2026)
