// ---------------------------------------------------------------------------
// Step 6 — Payment methods.
//
// Collects the merchant's intent for payment rails. Phase 1 deliberately
// ships without any payment provider wired up end-to-end: the menu shows
// only a "no payment methods yet" option, the wizard records the empty
// selection in .env (`PAYMENT_PROVIDER=none`), and `acc publish` later
// emits `supported_payments: []` in the skill frontmatter.
//
// Additional rails (Nexus/PlatON, Stripe, x402, shopify-native etc.) are
// planned but not wired in yet. When they land the menu grows, and the
// per-rail config (keys, payout addresses, webhook secrets) moves into
// per-rail sub-prompts — the shape of this step is deliberately forward-
// compatible with that evolution.
// ---------------------------------------------------------------------------

import { upsertEnv } from "../env-writer.js";
import type { StepContext, StepOutcome } from "./context.js";

interface PaymentMethodOption {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
}

const METHODS: readonly PaymentMethodOption[] = [
  { key: "n", id: "none", label: "No payment methods yet (configure later)", available: true },
  // Roadmap — visible in the menu so merchants see what's coming.
  { key: "x", id: "nexus-platon", label: "Nexus / PlatON (NUPS/1.5) — planned", available: false },
  { key: "s", id: "stripe", label: "Stripe — planned", available: false },
];

export async function stepPayment(ctx: StepContext): Promise<StepOutcome> {
  const selected = await resolveSelection(ctx);

  // Persist the selected ID to .env so the connector knows there's
  // deliberately no payment rail wired. The config loader interprets
  // `none` as "no PaymentProvider" (see packages/connector/src/config/
  // payment.ts) and surfaces an empty payment_handlers array in UCP
  // discovery responses.
  upsertEnv(ctx.layout.envPath, {
    PAYMENT_PROVIDER: selected,
  });

  return {
    applied: true,
    summary:
      selected === "none"
        ? "payment method: none (publish will emit supported_payments: [])"
        : `payment method: ${selected}`,
  };
}

async function resolveSelection(ctx: StepContext): Promise<string> {
  // Non-interactive seed path — honour explicit selection if given, else
  // default to "none" to keep the full seeded `acc init` loop deterministic.
  if (ctx.seed) {
    const seeded = ctx.seed.paymentMethod;
    if (!seeded) return "none";
    const match = METHODS.find((m) => m.id === seeded && m.available);
    if (!match) {
      throw new Error(
        `invalid paymentMethod seed: ${seeded} — must be one of ${availableIds().join(", ")}`,
      );
    }
    return match.id;
  }

  process.stdout.write(
    `\n  Which payment rails does your storefront accept through ACC?\n` +
      `  Phase 1 ships without any provider wired; additional rails arrive\n` +
      `  in upcoming releases. Pick "none" for now and re-run 'acc init'\n` +
      `  (choice b) once a rail is available.\n\n`,
  );

  const choices = METHODS.map((m) => ({
    key: m.key,
    label: m.available ? m.label : `${m.label}`,
  }));
  const picked = await ctx.prompter.askChoice(
    "Select payment method",
    choices,
  );
  const match = METHODS.find((m) => m.key === picked);
  if (!match) {
    // askChoice only returns keys it presented, so this is defensive.
    throw new Error(`[step6-payment] unexpected choice key: ${picked}`);
  }
  if (!match.available) {
    process.stdout.write(
      `\n  ${match.label.replace(" — planned", "")} is not yet available.\n` +
        `  Falling back to "none"; wizard will continue.\n\n`,
    );
    return "none";
  }
  return match.id;
}

function availableIds(): string[] {
  return METHODS.filter((m) => m.available).map((m) => m.id);
}
