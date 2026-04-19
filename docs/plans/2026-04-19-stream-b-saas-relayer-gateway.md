# Stream B — SaaS Relayer Gateway

**Date:** 2026-04-19
**Status:** Draft — awaiting user sign-off before implementation
**Supersedes (partially):** `2026-04-18-phase-2-stream-a-install-relay.md` (Stream A's "runtime never touches relay" invariant applies only to self-hosted track going forward)

## Why this plan exists

Stream A shipped the Silicon Retail relay as an OAuth-bootstrap-only service. M1–M6 built a narrow install proxy: merchant picks relayer in step 7 of `acc init shopify`, OAuth completes via relay, tokens land in merchant's local SQLite, merchant then runs their own public-HTTPS `acc start` connector that speaks UCP to agents. Runtime never touched the relay.

During pilot prep 2026-04-19 the merchant onboarding cost of "spin up a public HTTPS host for your `acc` connector" surfaced as the blocker non-technical merchants cannot cross. The user proposed three architectures to eliminate it:

- **X (tunnel):** merchant runs `acc start` locally, CLI auto-provisions a reverse tunnel → merchant laptop must stay online.
- **Y (SaaS):** SR hosts the UCP endpoint per-merchant → runtime bytes transit SR.
- **Z (agent-direct):** agent speaks Shopify Storefront API directly using adapter templates shipped in the skill → UCP is no longer a wire protocol.

After analysis we ruled out Z because adapter-template mode reduces UCP to a semantic layer described in JSON — the actual wire protocol between agent and merchant backend is Shopify GraphQL, not UCP. UCP-as-a-protocol only exists if something speaks it on the wire. In relayer mode where merchants host nothing, that something must be SR.

**Decision:** relayer mode runs a SaaS UCP gateway on SR's infrastructure. Self-hosted mode (D1=A) retains the M1–M6 design unchanged.

## Two tracks, diverging at init step 1

```
              acc init shopify
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
    [relayer mode]        [self-hosted mode]
    (non-technical)       (full control)
          │                     │
          │  wallet + OAuth     │  wallet + OAuth + Partners creds + public HTTPS
          │  sign skill         │  sign skill
          │  publish to SR      │  publish to SR + acc start (own host)
          │  DONE               │  DONE
          │                     │
          ▼                     ▼
     agent calls                agent calls
     SR gateway                 merchant connector
     (SR in data path)          (SR zero runtime bytes)
```

## Relayer-mode runtime data flow

```
agent ─learns skill──▶ siliconretail.com/.well-known/acc-skill.md
                             declares /ucp/v1/* endpoints + per-merchant shop_domain routing

agent ─UCP call──────▶ siliconretail.com/ucp/v1/search?shop=foo.myshopify.com&q=shoes
                             │
                        SR gateway (new: apps/marketplace-gateway)
                             │ lookup shop_domain → access_token + storefront_token
                             │ translate UCP → Shopify Admin/Storefront API
                             ▼
                       <shop>.myshopify.com/api/2024-01/graphql.json
                             │
                             ▼
                       ┌─────────────┐
                       │ UCP response │ ◀── SR translates back
                       └─────────────┘
```

**Trust model shift for relayer mode:**
- Old: "SR processes OAuth only, no business data."
- New: "SR is a runtime UCP processor. Product data, cart operations, order queries all transit SR's infrastructure. Customer checkout PII stays with Shopify (agent redirects user to `<shop>.myshopify.com/checkouts/<id>`)."

**This does not affect self-hosted merchants.** The "runtime never touches relay" invariant still holds for them and must stay in the docs with the self-hosted tag.

## What Stream A code survives vs becomes dead-code-in-relayer-mode

| Stream A artifact | Self-hosted | Relayer |
|---|---|---|
| M1 `/pair/new`, `/pair/poll`, `/pair/consume` | used | used |
| M2 `/auth/shopify/callback` | used | used |
| M3 `relayer_installations` + encrypted refresh_token | used | **still used** (SR keeps tokens for its own runtime calls) |
| M4 `/relayer/refresh` + connector refresh worker | used | **dead in relayer mode** — SR refreshes its own tokens server-side |
| M5 `/relayer/gdpr/webhook` + forward-to-connector + DLQ | used (forward path) | **SR terminates locally** — no forward, no DLQ |
| M5 per-shop `relay_secret` for HMAC forward verification | used | **irrelevant in relayer mode** — no forward to authenticate |
| M6 `capacity_exhausted` typed error | **irrelevant** (Public app, no 50-cap) | **irrelevant** |
| CLI `RelayCapacityExhaustedError` UX | dead | dead |

Cleanup deferred to a post-Y-merge PR to avoid scope creep in Stream B.

## New milestones

### M7 — UCP Gateway on SR (apps/marketplace-gateway)
- New Fastify app (or route module inside `acc-marketplace-relayer`) exposing `/ucp/v1/*`
- Routes: `/search`, `/products/:id`, `/checkout-sessions`, `/orders/:id` (subset of UCP/2026-04-08)
- Per-request `shop_domain` extracted from query string or path; looked up in `relayer_installations`
- Translator layer:
  - `ucpSearchToShopifyGraphql(query, token)` → GraphQL query against `<shop>.myshopify.com/api/2024-01/graphql.json`
  - Reverse translator: Shopify response → UCP JSON
- Server-side `access_token` refresh on 401 (SR triggers its own M4 internally, connector worker not involved)

### M8 — CLI relayer-mode four-step flow
- `acc init shopify` in relayer mode collapses to: `(1) pick relayer` → `(2) wallet create/import` → `(3) shop OAuth via SR` → `(4) skill sign + publish`
- Remove prompts: connector public URL, reverse-proxy notes, `acc start` reminder
- skill.md `endpoint` field auto-filled as `https://siliconretail.com/ucp/v1/` with `shop_domain` parameter
- Self-hosted path unchanged (10-step wizard retained under advanced flag or default)

### M9 — SR master skill + merchant directory
- `siliconretail.com/.well-known/acc-skill.md` — one master skill describing the gateway's UCP surface
- `siliconretail.com/api/merchants` — paginated directory, returns `[{shop_domain, signed_skill_url, platform, published_at}]`
- Each merchant's individual skill.md hosted on SR (signed by merchant wallet) — remains the identity/capability record
- Master skill includes merchant lookup instructions for agents that want to enumerate

### M10 — DPA + docs + runbook update
- DPA: new Section 6 "SR as runtime processor for relayer-mode merchants" — covers product data, cart state, order metadata. Explicitly excludes customer checkout PII (stays with Shopify).
- `docs/MERCHANT_ONBOARDING.md`: split into two tracks with clear trade-off table
- `docs/spec/relayer-protocol.md` → new doc `docs/spec/relayer-gateway-protocol.md` v2.0.0 describing gateway surface; old pair protocol referenced as "install phase"
- `apps/relayer/RUNBOOK.md`: add gateway runbook + per-tenant debugging section

## Risks / open questions

1. **Shopify API rate limits shared across all merchants on SR** — one busy merchant could exhaust another's bucket. Need per-tenant leaky-bucket on SR.
2. **Admin API operations requiring access_token** (inventory writes, fulfillment updates) — Storefront API alone won't cover all UCP ops. SR will hold access_tokens and use them server-side. This raises the blast radius if SR is compromised. Mitigation: token-at-rest already AES-256-GCM encrypted (M3).
3. **Nexus stablecoin payments** — on-chain path works regardless (agent signs tx to contract). SR gateway's `/ucp/v1/checkout-sessions` returns a `payment.nexus_recipient` address; agent + user wallet complete on-chain.
4. **Skill signature scope** — merchant signs their own skill.md; master skill is SR-owned. Agents that want end-to-end trust chain must verify merchant skill → cross-reference with master skill's directory entry. Need to document this reasoning clearly.
5. **Data residency** — SR's Render region (us-east). EEA merchants using relayer mode may have GDPR concerns around product data transiting US. Flag in DPA; offer self-hosted as the GDPR-strict path.
6. **`apps/marketplace-gateway` vs folding into `apps/relayer`** — separate service is cleaner for blast-radius reasoning; one service is cheaper to operate. Probably fold into relayer for v1, split later.

## Effort estimate

- M7: 3 days (gateway routes + translator + token lookup)
- M8: 1 day (CLI branch restructure; most of it is already in wizard)
- M9: 1 day (directory endpoint + master skill JSON)
- M10: 1 day (docs + DPA amendment, no code)

Total: ~1 week solo, assuming Shopify Storefront/Admin translator complexity is bounded to the 4 ops listed.

## Next actions once user signs off

1. Update memory: `project_relayer_runtime_data_path.md` (new) — supersedes relevant parts of `project_connector_deployment_model.md`
2. Update memory: `project_marketplace_shape.md` — note the dual-role (signpost for self-hosted merchants, gateway for relayer merchants)
3. Create tracking issues on GitHub for M7–M10
4. Open M7 branch `feat/marketplace-gateway` and start with the gateway route skeleton + a translator for `/ucp/v1/search`
