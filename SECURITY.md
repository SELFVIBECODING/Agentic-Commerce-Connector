# Security Policy

The Agentic Commerce Connector (ACC) sits between traditional e-commerce
platforms, AI agents, and on-chain settlement. A vulnerability here can
expose merchant tokens, allow checkout tampering, or impersonate signed
marketplace submissions — please treat reports accordingly.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security reports.**

Instead, email **security@nexuspay.money** with:

- A description of the issue and the affected commit / release.
- Minimal reproduction steps or a proof-of-concept.
- The impact you believe is achievable (data exposed, tokens leaked,
  checkout flow hijacked, etc.).
- Any suggested mitigation if you have one.

We aim to acknowledge reports within **2 business days** and to confirm
or dispute the finding within **10 business days**. Fixes for Critical
issues land in a patch release; High/Medium issues ship in the next
regular release with a public advisory after users have had time to
upgrade.

## Scope

In scope:

- `packages/connector/` — the Express-based UCP/1.0 server, adapters,
  Shopify OAuth install flow, webhook handlers, SQLite/Postgres
  installation & processed-events stores, cart tokens.
- `packages/cli/` — the `acc` CLI, local wallet keystore, EIP-712
  signing path for marketplace submissions.
- `packages/skill-spec/` — canonical JSON serializer, EIP-712 types,
  markdown skill parser, JSON Schemas.

Out of scope:

- Upstream services (Shopify, WooCommerce, Nexus Core) — report
  vulnerabilities directly to those operators.
- The public marketplace front-end (`acc-marketplace`) — separate
  disclosure channel.
- Self-hosted deployments misconfigured to bypass documented
  requirements (e.g. missing TLS termination, leaked PORTAL_TOKEN).

## Supported Versions

Only the latest `main` branch receives security fixes today. A formal
support matrix ships alongside the first tagged release.

## Threat Model Summary

The connector assumes:

- An attacker on the public internet can probe every HTTP route the
  connector exposes.
- An attacker can observe, replay, and attempt to tamper with any
  Shopify/WooCommerce/Nexus webhook delivered to the connector.
- An attacker CAN read the source (open-source) and knows the
  cryptographic constructions used.
- An attacker CANNOT read files outside the process's data directory
  unless `ACC_SKILL_MD_PATH` is misconfigured — this is validated at
  startup (see `packages/connector/src/config/base.ts`).
- An attacker CANNOT read environment variables, the wallet keystore,
  or the SQLite/Postgres store on the host.

Controls that enforce those assumptions include:

- Constant-time HMAC comparison on Shopify OAuth callbacks, Shopify
  webhooks, Nexus webhooks, admin bearer, and cart tokens.
- AES-256-GCM-at-rest encryption for Shopify admin + storefront tokens.
- EIP-712-signed marketplace submissions binding URL + sha256 so a
  swap attack fails verification.
- Strict `*.myshopify.com` validation before any outbound call to a
  shop domain.
- Request body-size caps on every HTTP endpoint (DoS / memory
  exhaustion).
- Per-path CORS allow-list that excludes state-changing and admin
  routes from wildcard origins.
- HTTP security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`) on every response.
- Processed-webhook-event persistence (SQLite when `ACC_DATA_DIR` is
  set) so a process restart cannot cause `payment.escrowed` replay
  and double settlement.
- Request timeouts on all outbound Shopify Admin / Storefront calls
  to prevent indefinite hang on a slow upstream.

If you find a case where these controls can be bypassed, that is a
valid report even without a full exploit.
