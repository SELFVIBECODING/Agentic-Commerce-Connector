# Data Processing Addendum — Silicon Retail Install Relay

> **Template status:** this document is a **self-serve template**. It is
> NOT legal advice. Have your own legal counsel review and adapt it
> before signing or before relying on it for compliance with GDPR,
> CCPA, or any other privacy regime that applies to your business.
> The Silicon Retail operator makes this template available as a
> convenience; execution (if any) is subject to the terms agreed
> between the parties in writing.

**Effective date:** upon mutual execution by the Parties (or upon the
Merchant's first use of the Silicon Retail install relay service,
whichever is earlier).

---

## 1 · Parties

- **Merchant** (the "Controller"): the operator of the Shopify store
  connected via the Silicon Retail install relay. Merchant is the
  data controller for any end-user personal data processed through
  that store.
- **Silicon Retail Operator** (the "Processor"): the entity operating
  `api.siliconretail.com/relayer/*`. The Processor processes limited
  personal data on behalf of the Merchant solely for the purposes
  described in §2.

Where this DPA conflicts with any separate Terms of Service between
the Parties, this DPA governs with respect to the processing of
personal data.

---

## 2 · Scope and purpose of processing

The Processor provides a thin OAuth install relay that holds a shared
Shopify Partners app's `client_secret`, exchanges OAuth `code` for
`access_token` on the Merchant's behalf, and forwards Shopify's
mandatory GDPR compliance webhooks to the Merchant's self-hosted
connector.

**The Processor's involvement is limited to install-time and periodic
token refresh.** After the install pair session completes, the
Merchant's connector communicates directly with Shopify's Admin and
Storefront APIs using the access token it received. Runtime traffic
(catalog lookups, order placement, customer data, payment requests)
does NOT flow through the Processor.

### 2.1 Data categories processed

- **Shopify shop domain** (`*.myshopify.com`) — identifier.
- **Shopify OAuth access token and refresh token** — credentials
  (encrypted at rest with AES-256-GCM using a key held only by the
  Processor; the refresh token is rotated on each use).
- **Merchant-supplied connector URL** — the HTTPS endpoint to which
  GDPR webhooks are forwarded.
- **Shopify GDPR webhook payloads** in transit
  (`customers/data_request`, `customers/redact`, `shop/redact`) —
  forwarded to the Merchant's connector. These payloads contain
  end-customer identifiers and are retained on the Processor's side
  only in the dead-letter queue (DLQ) for at most the backoff window
  required to complete delivery (bounded at 12 hours + one final
  retry), after which the payload row is marked forwarded or
  exhausted and purged from active scanning.

### 2.2 Data categories NOT processed

The Processor does not receive or store:

- Order history, cart contents, or product catalogs.
- Payment card numbers or payment instrument details.
- End-customer PII beyond what appears in transit in the three
  Shopify GDPR webhook payloads named in §2.1.
- Merchant's operational business data.

### 2.3 Duration

Processing begins on the Merchant's first use of the relay and
continues for as long as the Merchant's installation remains active
in the Processor's `relayer_installations` registry. On uninstall
(either via the Shopify `app/uninstalled` webhook or by the Merchant's
explicit request), the Processor ceases processing; stored refresh
tokens are subsequently purged within 30 days.

---

## 3 · Processor obligations

The Processor shall:

- **Confidentiality.** Ensure that personnel authorized to process
  Merchant data are bound by confidentiality obligations.
- **Security.** Implement and maintain technical and organizational
  measures appropriate to the risk of processing, including:
  - AES-256-GCM encryption of refresh tokens at rest.
  - TLS 1.2+ for all connections between the relay, Shopify, and the
    Merchant's connector.
  - HMAC-SHA256 verification of all inbound Shopify webhooks and of
    outbound forwards to the Merchant's connector (via a per-shop
    `relay_secret`).
  - Rate limiting on `/pair/new` and `/refresh` endpoints to mitigate
    brute-force and denial-of-service attempts.
- **Breach notification.** Notify the Merchant without undue delay
  (and in any event within 72 hours) after becoming aware of a
  personal data breach affecting the Merchant's data.
- **Sub-processors.** Not engage any sub-processor that processes
  Merchant personal data without prior general or specific
  authorization from the Merchant. Current sub-processors:
  1. **Render, Inc.** — infrastructure hosting (U.S. regions).
  2. **Cloudflare, Inc.** — edge TLS termination + DDoS protection.
  3. **Shopify Inc.** — the third-party whose APIs the relay calls on
     the Merchant's behalf.

  The Merchant is deemed to have given general authorization for the
  above list at the time of signing; material changes will be
  notified in writing with a 30-day objection period.
- **Assistance with data-subject requests.** Assist the Merchant,
  insofar as practicable, in fulfilling its obligations to respond
  to requests from data subjects. The relay does not surface
  end-customer PII beyond in-transit GDPR webhook payloads, so
  requests are ordinarily discharged via the Merchant's own systems.
- **Deletion on offboarding.** Upon written request from the
  Merchant or upon receipt of a Shopify `app/uninstalled` webhook,
  mark the Merchant's installation record uninstalled, cease token
  refresh, and purge stored refresh token ciphertext within 30 days.
- **Audit.** Provide reasonable assistance for audits and inspections
  in accordance with applicable law, limited to the Processor's
  processing of Merchant data and subject to reasonable notice and
  confidentiality obligations.

---

## 4 · Merchant obligations

The Merchant shall:

- Obtain all consents and provide all notices to end customers
  required under applicable privacy law for the processing of their
  data by the Merchant's connector and by Shopify.
- Ensure the `connector_url` supplied to the relay is accurate; the
  Processor will forward GDPR webhooks to whatever URL the Merchant
  registered, and the Merchant bears the risk of misrouting arising
  from an incorrect URL.
- Keep the `ACC_RELAY_SECRET` in the Merchant's `.env` confidential;
  its disclosure would allow a third party to impersonate the
  Processor when delivering forwarded webhooks to the Merchant's
  connector.
- Not submit to the relay any data that is not necessary for the
  Service described in §2.

---

## 5 · International data transfers

The Processor hosts the relay in U.S.-located infrastructure. For
Merchants established in the European Economic Area (EEA), the United
Kingdom, or Switzerland, the Parties rely on the **Standard
Contractual Clauses** (European Commission Decision 2021/914) as the
transfer mechanism, with the Merchant as the data exporter and the
Processor as the data importer. Where both Parties are established in
the EEA, no SCCs are required and this section does not apply.

For UK-specific transfers, the Parties rely on the UK International
Data Transfer Addendum (IDTA) or the UK Addendum to the EU SCCs, at
the Parties' joint election.

---

## 6 · Merchant rights

The Merchant may:

- Request, in writing, a copy of its installation record and any
  stored metadata. The Processor will respond within 30 days.
- Request that the Processor delete its installation record and any
  associated ciphertext (equivalent to triggering an uninstall).
- Object to a material change in sub-processors within the 30-day
  notice period referenced in §3.

---

## 7 · Limitation and liability

Nothing in this DPA alters either Party's liability under the separate
Terms of Service between the Parties. This DPA governs the processing
of personal data; the commercial relationship (including limitation of
liability, indemnification, term, and termination) lives in the Terms
of Service.

---

## 8 · Term and termination

This DPA remains in force for as long as the Processor processes
Merchant personal data. Either Party may terminate this DPA by
written notice if the other Party commits a material breach that is
not cured within 30 days of written notice. Upon termination, the
obligations in §3 ("Deletion on offboarding") and §5 ("International
data transfers") survive for as long as any residual processing of
Merchant personal data persists.

---

## 9 · Signatures

**Merchant (Controller)**

Name: ____________________________

Title: ____________________________

Date: ____________________________

Signature: ____________________________


**Silicon Retail Operator (Processor)**

Name: ____________________________

Title: ____________________________

Date: ____________________________

Signature: ____________________________

---

## Appendix A · Technical and organizational measures (summary)

| Measure | Implementation |
|---|---|
| Encryption at rest | AES-256-GCM for `refresh_token_enc`; key held in environment variable only, not in source control. |
| Encryption in transit | TLS 1.2+ enforced by Cloudflare edge. |
| Access control | Processor personnel access to production DB is limited to ciphertang (solo-operator); MFA-required. |
| Logging | Structured JSON logs to stdout. Tokens, client secret, and raw webhook payloads are never logged. Pair codes are logged with a 6-character prefix only. |
| Integrity | HMAC-SHA256 on every inbound Shopify webhook (verified with `client_secret`) and every outbound forward (signed with per-shop `relay_secret`, timing-safe comparison). |
| Retention | DLQ rows retained up to 12h of backoff window + one final retry, then marked exhausted. Installation records retained until 30 days after uninstall, then purged. |
| Backup | Database backed up daily by the hosting provider (Render); restore point objective 24h. |
| Incident response | Operator monitors `/relayer/metrics` and `/relayer/health`; breach notification target ≤72h per §3. |

## Appendix B · Processing lifecycle diagram

```
Merchant CLI                      Silicon Retail relay                  Shopify
────────────                      ─────────────────────                 ───────
 pair/new  ─────────────────────▶ create pair session
                                  return install_url
                                                            authorize
                                                            ─────────▶ consent
                                                                         │
                                                                         ▼
                                  callback ◀─────────────── redirect + code
                                  HMAC verify
                                  exchange code → token ───────────────▶
                                  register app/uninstalled ─────────────▶
                                  mint storefront token ────────────────▶
                                  persist registry row
 pair/poll ─────────────────────▶ return tokens + relay_secret
 pair/consume ──────────────────▶ purge pair session
                                  [registry row = only persistent state]

                                  ─── runtime (NO relay involvement) ──
                                                                         │
                                                                         ▼
                                  (merchant connector ◀──▶ Shopify APIs)

                                  ─── GDPR webhook fan-in ──
                                                            webhook
                                  forward to connector ◀────────────────
                                  HMAC-sign with relay_secret
                                  return 2xx to Shopify

                                  ─── token refresh (if expiring) ──
 refresh ──────────────────────▶ POST Shopify /oauth/access_token
                                  rotate refresh_token_enc
                                  return new tokens
```
