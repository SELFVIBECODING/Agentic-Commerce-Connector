// ---------------------------------------------------------------------------
// Step 6 — Shopify Partners credentials (per-merchant Custom Distribution).
//
// Before asking the merchant for client_id / client_secret, print the three
// values they need to paste into their Partners app config (App URL,
// Allowed redirection URL, API scopes). This lets the merchant flip to the
// Partners tab with everything ready to copy, instead of hunting through
// docs while the wizard blocks.
//
// If SELF_URL hasn't been set yet (step 3 hasn't run) we print placeholders
// — re-entrant "shopify-only" mode hits that path when the merchant only
// wants to rotate credentials.
// ---------------------------------------------------------------------------
import { openBrowser } from "../open-browser.js";
import { upsertEnv } from "../env-writer.js";
import type { StepContext, StepOutcome } from "./context.js";

const PARTNERS_URL = "https://partners.shopify.com/";
const SETUP_DOC_URL = "https://www.siliconretail.com/docs/shopify-partners-setup";

const DEFAULT_SCOPES = "read_products, read_inventory, read_orders, write_orders";

export async function stepShopify(ctx: StepContext): Promise<StepOutcome> {
  printPartnersGuidance(ctx);

  const clientId =
    ctx.seed?.shopifyClientId ??
    (await askForNonEmpty(ctx, "Shopify Partners client_id"));
  const clientSecret =
    ctx.seed?.shopifyClientSecret ??
    (await askForNonEmpty(ctx, "Shopify Partners client_secret", true));

  if (!ctx.seed) {
    const opened = await openBrowser(PARTNERS_URL);
    if (!opened) {
      process.stdout.write(
        `  (open ${PARTNERS_URL} manually to create / view your app)\n`,
      );
    }
  }

  upsertEnv(ctx.layout.envPath, {
    SHOPIFY_CLIENT_ID: clientId,
    SHOPIFY_CLIENT_SECRET: clientSecret,
  });

  return { applied: true, summary: "Shopify Partners credentials stored in .env" };
}

/**
 * Print the exact values the merchant must paste into their Partners app
 * config. Skipped when running non-interactively (seed supplied) — in that
 * mode the wizard is being scripted and the banner would just be noise.
 */
function printPartnersGuidance(ctx: StepContext): void {
  if (ctx.seed) return;
  const selfUrl = (ctx.config.selfUrl ?? "https://<your-acc-host>").replace(
    /\/+$/,
    "",
  );
  process.stdout.write(
    `\n  Before you paste credentials below, make sure your Shopify Partners app\n` +
      `  has these three values configured (see ${SETUP_DOC_URL}):\n` +
      `\n` +
      `    App URL:              ${selfUrl}/admin/shopify\n` +
      `    Allowed redirect URL: ${selfUrl}/auth/shopify/callback\n` +
      `    Admin API scopes:     ${DEFAULT_SCOPES}\n` +
      `\n` +
      `  Don't have a Partners app yet? Follow the ~10-minute setup at the URL\n` +
      `  above, then come back — the wizard will wait here.\n` +
      `\n`,
  );
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
