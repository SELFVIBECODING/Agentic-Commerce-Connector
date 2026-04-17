import { openBrowser } from "../open-browser.js";
import { upsertEnv } from "../env-writer.js";
import type { StepContext, StepOutcome } from "./context.js";

const PARTNERS_URL = "https://partners.shopify.com/";

export async function stepShopify(ctx: StepContext): Promise<StepOutcome> {
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
