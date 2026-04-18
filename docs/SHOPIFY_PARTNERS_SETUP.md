# Shopify Partners App Setup — Prerequisite for `acc init shopify`

**Audience:** Shopify store owners setting up ACC in self-hosted mode.

**Why this doc exists:** `acc init shopify` will ask for a `client_id` and
`client_secret` that Shopify only gives you after you've registered a
Partners account and created an app configured with your connector's URLs.
Do this doc first, then run the wizard — otherwise you'll hit step 6 and
have to interrupt to come here.

**Time:** ~10 minutes end-to-end (once; you never repeat this).

**You do NOT need to list your app on the Shopify App Store.** We use the
**Custom Distribution** model — the app stays private to your store(s) and
skips all review / approval.

---

## Before you start

| You need | Where to get it |
|---|---|
| The public HTTPS URL of your deployed connector | Your hosting provider (Render / Fly / own VPS + Cloudflare Tunnel). We'll call it `ACC_URL` below. |
| A Shopify store you control | Any plan (including a free Partners dev store) |
| An email for the Partners account | |

If you haven't deployed the connector yet, do that first — you need the
public URL. See the [Quick Start](../README.md#quick-start) for the binary
install path, or [docs/MERCHANT_ONBOARDING.md](./MERCHANT_ONBOARDING.md)
for the full walkthrough.

---

## Step 1 — Create a Partners account  *(2 min)*

1. Open [partners.shopify.com/signup](https://partners.shopify.com/signup).
2. Fill in name, email, business name (a solo merchant can use their own
   name here).
3. Confirm the email link Shopify sends.

Already have a Partners account (e.g. from agency / dev work)? Skip to
Step 2.

---

## Step 2 — Create a Custom Distribution app  *(3 min)*

1. In the Partners portal, open the left sidebar → **Apps** → **Create app**.
2. Pick **Create app manually** (not "Create app with the CLI").
3. Name it something you'll recognize later, e.g. `ACC — <your store name>`.
   The name is private to you; customers never see it on any public page.
4. Click **Create app**. You'll land on the new app's overview page.

---

## Step 3 — Configure the app URLs  *(3 min)*

Open the **App setup** / **Configuration** tab on the left. You'll paste
two values. Both are derived from the connector's public URL (`ACC_URL`)
you provisioned.

If `ACC_URL` = `https://acc.myshop.com`, paste exactly:

| Field in Partners UI | Value to paste |
|---|---|
| **App URL** | `https://acc.myshop.com/admin/shopify` |
| **Allowed redirection URL(s)** | `https://acc.myshop.com/auth/shopify/callback` |

### Common mistakes

- **Trailing slash mismatch.** Shopify compares the redirect URL
  byte-exactly. If your connector sends `/callback` and Partners has
  `/callback/`, install fails with `invalid_request`.
- **HTTP instead of HTTPS.** Shopify rejects non-HTTPS redirects outright.
- **Typo in the domain.** Keep a terminal open with the URL `acc init`
  shows in step 3 and copy from there, don't retype.

---

## Step 4 — Set API scopes  *(2 min)*

Still in **App setup** / **Configuration**, scroll to
**Access scopes** → **Admin API access scopes**. Tick:

- `read_products` — catalog browse
- `read_inventory` — stock awareness
- `read_orders` — order status for agents
- `write_orders` — create orders at checkout

Optional:

- `write_draft_orders` — if you want agents to create draft orders that a
  human approves before they become real orders.

**Save.**

You do NOT need to configure Storefront API scopes here — the connector
mints its own Storefront token via `storefrontAccessTokenCreate` on install.

---

## Step 5 — Configure compliance webhook URLs  *(2 min)*

Shopify requires **every** app to handle three mandatory GDPR webhooks.
Still in **App setup**, scroll to **Compliance webhooks**:

| Shopify event | Your connector URL |
|---|---|
| `customers/data_request` | `https://acc.myshop.com/webhooks/gdpr/customers_data_request` |
| `customers/redact` | `https://acc.myshop.com/webhooks/gdpr/customers_redact` |
| `shop/redact` | `https://acc.myshop.com/webhooks/gdpr/shop_redact` |

These can stay idle until Shopify actually sends a compliance event (rare
in practice) — but the URLs **must be filled in** or Shopify will block
install.

---

## Step 6 — Fill Privacy Policy + Support URL  *(variable)*

Shopify requires both fields to be non-empty. You can use:

- **Privacy Policy URL:** your own store's privacy policy page (most
  stores already have one for consumer-facing purposes). If you don't,
  write a one-pager at `https://myshop.com/privacy` and link it.
- **Support URL:** your store's contact/support page, or a simple
  `mailto:support@myshop.com` URL.

These URLs appear on the Shopify consent screen merchants see when they
install your app on their own store — so they should look legitimate.

---

## Step 7 — Copy `client_id` + `client_secret`  *(1 min)*

On the **Client credentials** / **API credentials** tab you'll see:

- **Client ID** (a 32-char alphanumeric)
- **Client secret** (click **Reveal** to show)

Copy both. Keep the secret **out of version control and chat logs** —
treat it like a database password.

If either value ever leaks: regenerate on this same page. Existing
installations continue working (the offline tokens they already hold are
independent of `client_id`), but any un-installed store would need the new
`client_id`.

---

## Step 8 — Run `acc init shopify`  *(2 min)*

You're ready. Return to your terminal:

```bash
acc init shopify
```

The wizard's **step 6/8** will show you the App URL and redirect URL it
expects (same values you pasted above — a sanity check) and then prompt
for the `client_id` and `client_secret`. Paste them in; the wizard
finishes on its own.

---

## After install — changing scopes later

If you need to grant a new scope (e.g. adding `write_draft_orders`):

1. Tick the new scope in Partners → **App setup** → **Access**.
2. The connector's `/admin/shopify` page surfaces a **scope-drift warning**
   with a one-click reinstall link for each installed shop. The merchant
   clicks **Reinstall to upgrade scopes**, approves the new scope on
   Shopify, and the connector picks up the expanded grant.

Removing a scope has no effect on existing installs (they keep what they
were granted); new installs simply won't be asked for the removed one.

---

## Troubleshooting

| Symptom | Where to look |
|---|---|
| `invalid_request` on callback | Partners "Allowed redirection URL(s)" doesn't exactly match `${ACC_URL}/auth/shopify/callback` |
| `Shopify API: unauthorized` | `client_id` or `client_secret` pasted incorrectly — re-run `acc init shopify` and choose "update Shopify credentials only" |
| "App Store submission required" | You clicked **Distribute** → **App Store**. Cancel that; stay on **Custom Distribution**. |
| Shopify rejects with "app not approved to install" | The store isn't linked to your Partners org. Generate an install link from Partners and use it once to authorize. |
| Need to install on > 50 stores | Custom Distribution hard cap. Beyond 50 you need to submit the app to the Shopify App Store (review cycle ~1-2 weeks). This is rare for self-hosted deployments since each merchant usually runs their own Partners app. |

---

## See also

- [MERCHANT_ONBOARDING.md](./MERCHANT_ONBOARDING.md) — full end-to-end
  onboarding (assumes this doc as its prerequisite)
- [CLI.md](./CLI.md) — `acc init`, `acc start`, `acc shopify connect`
  command reference
