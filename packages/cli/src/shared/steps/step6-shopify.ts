// ---------------------------------------------------------------------------
// Step 7 (label) — Shopify install method.
//
// Filename retains the "step6" prefix for git-history continuity; the
// wizard label is "7/10 Shopify install method" (see commands/init.ts).
//
// Two install methods, one menu:
//
//   1. Self-hosted Partners app — merchant owns the Shopify Partners app,
//      pastes client_id + client_secret. Printed guidance shows the three
//      values they must paste into Partners config.
//
//   2. Silicon Retail relayer — Silicon Retail operates the Partners app;
//      merchant skips account registration entirely. CLI speaks the
//      relay-protocol/1.0.0 pair/poll flow against the relay, persists
//      tokens to the merchant's local SQLite install-store, and sets
//      .env markers so the connector boots in relay-hosted mode.
//
// In both branches the RUNTIME data path is identical: agent → merchant
// connector → Shopify. The relayer participates only at install time
// (and for token refresh in a later milestone).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { upsertEnv } from "../env-writer.js";
import {
  InstallInterruptedError,
  RelayCapacityExhaustedError,
  RelayerClient,
  pollUntilReady,
  type PairPollReady,
} from "../relayer-client.js";
import { openBrowser } from "../open-browser.js";
import type { StepContext, StepOutcome } from "./context.js";

const SETUP_DOC_URL =
  "https://www.siliconretail.com/docs/shopify-partners-setup";

const DEFAULT_SCOPES =
  "read_products, read_inventory, read_orders, write_orders";

// Temporary Phase 2 host: the relay runs on Render's managed onrender.com
// subdomain while the siliconretail.com Cloudflare custom-domain config
// is pending (Render custom-domain slot limit). The relay's route paths
// keep the /relayer/ prefix so the URL shape stays stable when we later
// point a branded domain at the same service.
const DEFAULT_RELAY_URL =
  "https://acc-marketplace-relayer.onrender.com/relayer";

const POLL_INTERVAL_MS = 2_000;
const POLL_DEADLINE_MS = 10 * 60 * 1_000;

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export async function stepShopify(ctx: StepContext): Promise<StepOutcome> {
  const method = await resolveInstallMethod(ctx);
  if (method === "relayer") {
    return runRelayerInstall(ctx);
  }
  return runSelfHostedInstall(ctx);
}

/* -------------------------------------------------------------------------- */
/*  Menu                                                                       */
/* -------------------------------------------------------------------------- */

async function resolveInstallMethod(
  ctx: StepContext,
): Promise<"self-hosted" | "relayer"> {
  // Non-interactive path: seed explicitly names the method, or falls back
  // to "self-hosted" so existing wizard.test.ts fixtures keep working
  // unchanged (they only seed shopifyClientId + shopifyClientSecret).
  if (ctx.seed) {
    return ctx.seed.shopifyInstallMethod ?? "self-hosted";
  }

  const pick = await ctx.prompter.askChoice(
    "How will you connect your Shopify store?",
    [
      {
        key: "s",
        label: "Self-hosted — I have my own Shopify Partners app",
      },
      {
        key: "r",
        label: "Silicon Retail relayer — no Partners account needed",
      },
    ],
  );
  return pick === "r" ? "relayer" : "self-hosted";
}

/* -------------------------------------------------------------------------- */
/*  Self-hosted branch                                                         */
/* -------------------------------------------------------------------------- */

async function runSelfHostedInstall(ctx: StepContext): Promise<StepOutcome> {
  printPartnersGuidance(ctx);

  const clientId =
    ctx.seed?.shopifyClientId ??
    (await askForNonEmpty(ctx, "Shopify Partners client_id"));
  const clientSecret =
    ctx.seed?.shopifyClientSecret ??
    (await askForNonEmpty(ctx, "Shopify Partners client_secret", true));

  upsertEnv(ctx.layout.envPath, {
    SHOPIFY_CLIENT_ID: clientId,
    SHOPIFY_CLIENT_SECRET: clientSecret,
  });

  return {
    applied: true,
    summary: "Shopify Partners credentials stored in .env",
  };
}

function printPartnersGuidance(ctx: StepContext): void {
  if (ctx.seed) return;
  const selfUrl = (ctx.config.selfUrl ?? "https://<your-acc-host>").replace(
    /\/+$/,
    "",
  );
  process.stdout.write(
    `\n  Paste these three values into your Shopify Partners app config:\n` +
      `\n` +
      `    App URL:              ${selfUrl}/admin/shopify\n` +
      `    Allowed redirect URL: ${selfUrl}/auth/shopify/callback\n` +
      `    Admin API scopes:     ${DEFAULT_SCOPES}\n` +
      `\n` +
      `  New to Shopify Partners? ~10-minute walkthrough:\n` +
      `    ${SETUP_DOC_URL}\n` +
      `\n` +
      `  The prompts below block until you paste client_id + client_secret.\n` +
      `  Keep this terminal open — closing it loses your wizard progress.\n` +
      `\n`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Relayer branch                                                             */
/* -------------------------------------------------------------------------- */

async function runRelayerInstall(ctx: StepContext): Promise<StepOutcome> {
  const relayUrl = (
    ctx.seed?.relayUrl ??
    ctx.flags.get("install-relay") ??
    DEFAULT_RELAY_URL
  ).replace(/\/+$/, "");
  const connectorUrl = ctx.config.selfUrl;
  if (!connectorUrl) {
    throw new Error(
      "[step7-shopify] selfUrl missing — step 3 must run before the relayer install.",
    );
  }

  const shopDomain = await resolveShopDomain(ctx);

  const client = new RelayerClient({ relayUrl });

  if (!ctx.seed) {
    process.stdout.write(
      `\n  Silicon Retail relayer: ${relayUrl}\n` +
        `  Runtime traffic never touches the relay — only install + token refresh do.\n` +
        `\n`,
    );
  }

  let pair: Awaited<ReturnType<typeof client.pairNew>>;
  try {
    pair = await client.pairNew({ shopDomain, connectorUrl });
  } catch (err) {
    if (err instanceof RelayCapacityExhaustedError) {
      // Friendlier than a generic `[Relay] pair/new returned 503`. This
      // is a deliberate product signal from the relay operator —
      // prompt the merchant to pivot to the self-hosted Partners
      // option rather than just letting the stack trace fly.
      throw new InstallInterruptedError(
        `The Silicon Retail relayer is at its Shopify Custom Distribution cap (50 installs) and can't accept new ones right now.\n\n` +
          `  What to do:\n` +
          `    1. Re-run: acc init shopify\n` +
          `    2. At step 8 pick "Self-hosted — I have my own Shopify Partners app"\n` +
          `    3. Follow docs/SHOPIFY_PARTNERS_SETUP.md (~10 min, one-time)\n` +
          `\n` +
          `  The relay operator has been notified automatically; App Store\n` +
          `  submission removes this cap and will be rolled out soon.`,
      );
    }
    throw err;
  }

  if (!ctx.seed) {
    process.stdout.write(
      `  Install URL (opens in your browser; paste it manually if headless):\n` +
        `\n    ${pair.install_url}\n\n` +
        `  Waiting for Shopify approval (up to 10 minutes). Ctrl+C to abort.\n`,
    );
    // Best-effort; ignore failures — the URL is already printed above.
    await openBrowser(pair.install_url).catch(() => false);
  }

  let ready: PairPollReady;
  try {
    ready = await pollUntilReady(client, pair.pair_code, {
      intervalMs: POLL_INTERVAL_MS,
      deadlineMs: Math.min(POLL_DEADLINE_MS, pair.expires_in * 1_000),
    });
  } catch (err) {
    if (err instanceof InstallInterruptedError) {
      throw err;
    }
    throw new Error(
      `[step7-shopify] relay pair polling failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await writeInstallation(ctx, ready);

  // Record the .env markers the connector reads at boot: relay-hosted
  // client_id + empty secret tell config.ts to route refresh via the
  // relay URL rather than calling Shopify's token endpoint directly.
  const envUpdates: Record<string, string> = {
    SHOPIFY_STORE_URL: `https://${ready.shop_domain}`,
    ACC_INSTALL_RELAY_URL: relayUrl,
    SHOPIFY_CLIENT_ID: "relay-hosted",
    SHOPIFY_CLIENT_SECRET: "",
  };
  // M3+ responses include a per-shop relay_secret for GDPR webhook
  // verification. M1 relays may omit it; skip the .env write in that
  // case so we don't persist an undefined.
  if (typeof ready.relay_secret === "string" && ready.relay_secret.length > 0) {
    envUpdates.ACC_RELAY_SECRET = ready.relay_secret;
  }
  upsertEnv(ctx.layout.envPath, envUpdates);

  // Tell the relay it can purge in-memory pair state — idempotent, so a
  // failure here is only a leak (not a correctness issue) and never a
  // reason to fail the step after tokens are already persisted locally.
  try {
    await client.pairConsume(pair.pair_code);
  } catch (err) {
    process.stdout.write(
      `  (warn) pair/consume failed — relay will GC the pair on its own.\n` +
        `  Reason: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return {
    applied: true,
    summary: `Shopify install via Silicon Retail relayer complete — ${ready.shop_domain}`,
  };
}

async function resolveShopDomain(ctx: StepContext): Promise<string> {
  if (ctx.seed) {
    const seeded = ctx.seed.shopifyShopDomain;
    if (!seeded || !SHOP_DOMAIN_RE.test(seeded)) {
      throw new Error(
        "[step7-shopify] relayer mode requires seed.shopifyShopDomain = '<handle>.myshopify.com'",
      );
    }
    return seeded.toLowerCase();
  }
  const raw = await ctx.prompter.ask(
    "Your Shopify store domain (e.g. my-shop.myshopify.com)",
    {
      validate: (v) => {
        const trimmed = v
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/\/.*$/, "");
        if (!SHOP_DOMAIN_RE.test(trimmed)) {
          return "must match <handle>.myshopify.com";
        }
        return null;
      },
    },
  );
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/**
 * Persist the relay-delivered tokens into the merchant's SQLite install
 * store. Uses the same encryption + schema the connector's own OAuth
 * route would write, so the runtime code path reads them back
 * identically regardless of install method.
 */
async function writeInstallation(
  ctx: StepContext,
  ready: PairPollReady,
): Promise<void> {
  const encryptionKey = readFileSync(ctx.layout.encKeyFile, "utf-8").trim();
  if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    throw new Error(
      `[step7-shopify] cannot persist installation: ${ctx.layout.encKeyFile} is not a 64-hex AES-256 key. Re-run step 4.`,
    );
  }

  const { createSqliteInstallationStore } =
    await import("@acc/connector/shopify-oauth");

  const store = await createSqliteInstallationStore({
    dbPath: ctx.layout.dbFile,
    encryptionKey,
  });

  try {
    await store.save({
      shopDomain: ready.shop_domain,
      adminToken: ready.access_token,
      storefrontToken: ready.storefront_token,
      scopes: ready.scopes,
      installedAt: Date.now(),
      uninstalledAt: null,
    });
  } finally {
    store.close();
  }
}

async function askForNonEmpty(
  ctx: StepContext,
  label: string,
  secret = false,
): Promise<string> {
  const raw = secret
    ? await ctx.prompter.askSecret(label)
    : await ctx.prompter.ask(label, {
        validate: (v) => (v.trim().length > 0 ? null : "value is required"),
      });
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${label}: value is required`);
  return trimmed;
}
