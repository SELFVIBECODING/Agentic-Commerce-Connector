// ---------------------------------------------------------------------------
// Step 7 (label) — Shopify install method.
//
// Filename retains the "step6" prefix for git-history continuity; the
// wizard label is "7/10 Shopify install method" (see commands/init.ts).
//
// Only the self-hosted Shopify Partners flow is supported: the merchant
// registers their own Partners app, pastes `client_id` + `client_secret`,
// and the runtime connector handles OAuth end-to-end. The Silicon Retail
// relayer track has been removed from the wizard pending the Stream B
// rearchitecture (see docs/plans/2026-04-19-stream-b-saas-relayer-gateway.md).
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
