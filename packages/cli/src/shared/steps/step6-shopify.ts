// ---------------------------------------------------------------------------
// Step 6 — Shopify Partners credentials (per-merchant Custom Distribution).
//
// Flow:
//   1. Print the three values the merchant must paste into their Partners
//      app (App URL, Allowed redirect URL, API scopes) — computed from the
//      selfUrl they entered in step 3.
//   2. Print the setup-doc URL. We don't auto-open a browser: in many
//      terminal-first workflows (tmux, SSH, IDE embedded shells) a
//      surprise browser launch is noise. The user can cmd-click or
//      copy-paste the link if they want to open it.
//   3. Prompt for client_id + client_secret. These write to .env
//      atomically once both are collected.
//
// Re-entrant "shopify-only" mode (the `b` choice on the re-entry menu)
// hits this path when the merchant only wants to rotate credentials.
// selfUrl will already be populated from the previous run.
// ---------------------------------------------------------------------------
import { upsertEnv } from "../env-writer.js";
import type { StepContext, StepOutcome } from "./context.js";

const SETUP_DOC_URL =
  "https://www.siliconretail.com/docs/shopify-partners-setup";

const DEFAULT_SCOPES =
  "read_products, read_inventory, read_orders, write_orders";

export async function stepShopify(ctx: StepContext): Promise<StepOutcome> {
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
