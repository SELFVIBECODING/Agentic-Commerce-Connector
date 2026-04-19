// ---------------------------------------------------------------------------
// Step 6 — Shopify Partners credentials (per-merchant Custom Distribution).
//
// Flow:
//   1. Print the three values the merchant must paste into their Partners
//      app (App URL, Allowed redirect URL, API scopes) — computed from the
//      selfUrl they entered in step 3.
//   2. Open the setup doc in their browser up-front (not after creds are
//      entered) so the Partners tab is already on screen while they come
//      back to paste. The wizard blocks at the client_id prompt below
//      until they return.
//   3. Prompt for client_id + client_secret. These write to .env
//      atomically once both are collected.
//
// The prompt literally blocks waiting for stdin — the user can take as
// long as they need to create the app. Message copy is emphatic about
// NOT closing the terminal, because the earlier copy ("wizard will wait
// here") was misread as "you can close this and come back later" and
// some users did just that, losing their wizard progress.
//
// Re-entrant "shopify-only" mode (the `b` choice on the re-entry menu)
// hits this path when the merchant only wants to rotate credentials.
// selfUrl will already be populated from the previous run.
// ---------------------------------------------------------------------------
import { openBrowser } from "../open-browser.js";
import { upsertEnv } from "../env-writer.js";
import type { StepContext, StepOutcome } from "./context.js";

const SETUP_DOC_URL =
  "https://www.siliconretail.com/docs/shopify-partners-setup";

const DEFAULT_SCOPES =
  "read_products, read_inventory, read_orders, write_orders";

export async function stepShopify(ctx: StepContext): Promise<StepOutcome> {
  printPartnersGuidance(ctx);

  if (!ctx.seed) {
    // Best-effort: open the setup doc before the prompt blocks, so the
    // Partners tab is already on-screen while the user is still reading
    // the guidance. Headless SSH / no display → browser can't open; we
    // print the URL so the user can paste it into a browser on another
    // machine and carry on.
    const opened = await openBrowser(SETUP_DOC_URL);
    if (!opened) {
      process.stdout.write(
        `  (open this link on another device to follow along:\n   ${SETUP_DOC_URL})\n\n`,
      );
    }
  }

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
    `\n  Paste these three values into your Shopify Partners app config\n` +
      `  (setup guide: ${SETUP_DOC_URL}):\n` +
      `\n` +
      `    App URL:              ${selfUrl}/admin/shopify\n` +
      `    Allowed redirect URL: ${selfUrl}/auth/shopify/callback\n` +
      `    Admin API scopes:     ${DEFAULT_SCOPES}\n` +
      `\n` +
      `  ┌───────────────────────────────────────────────────────────────────┐\n` +
      `  │  DO NOT CLOSE THIS TERMINAL.                                      │\n` +
      `  │                                                                   │\n` +
      `  │  The 'client_id' prompt below is blocking. Open your Partners     │\n` +
      `  │  app in the browser tab that just opened (~10-minute setup if     │\n` +
      `  │  starting from scratch), copy client_id + client_secret, then     │\n` +
      `  │  come back and paste them here. The wizard literally waits at     │\n` +
      `  │  the prompt — closing this terminal loses your progress.          │\n` +
      `  └───────────────────────────────────────────────────────────────────┘\n` +
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
