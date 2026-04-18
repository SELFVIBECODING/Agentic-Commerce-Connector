// ---------------------------------------------------------------------------
// `acc init` — 10-step interactive wizard.
//
// Steps live in src/shared/steps/ so this file stays a thin orchestrator.
// Evolution: originally 8 steps (see
// docs/plans/2026-04-16-phase-8-cli-wizard-structure.md §E); step 6
// (Payment methods) was added when Phase 1 made payment-rail selection
// explicit; step 9 (Categories) was added when the marketplace taxonomy
// became fixed. Filenames retain their original numbers for git history
// clarity; labels below reflect the current 10-step sequence.
// ---------------------------------------------------------------------------

import { ensureDataDir, type DataDirLayout } from "../shared/data-dir.js";
import {
  createPrompter,
  defaultPromptIO,
  type Prompter,
  type PromptIO,
} from "../shared/prompts.js";
import {
  loadConfig,
  saveConfig,
  backupConfig,
  type AccConfig,
} from "../shared/config-store.js";
import { stepPreflight } from "../shared/steps/step1-preflight.js";
import { stepDataDir } from "../shared/steps/step2-data-dir.js";
import { stepSelfUrl } from "../shared/steps/step3-self-url.js";
import { stepEncKey } from "../shared/steps/step4-enc-key.js";
import { stepSigner } from "../shared/steps/step5-signer.js";
import { stepPayment } from "../shared/steps/step6-payment.js";
// Filenames retain their original step numbers for git history clarity;
// the wizard labels below reflect the current 10-step sequence.
import { stepShopify } from "../shared/steps/step6-shopify.js";
import { stepSqlite } from "../shared/steps/step7-sqlite.js";
import { stepCategories } from "../shared/steps/step9-categories.js";
import { stepSkill } from "../shared/steps/step8-skill.js";
import type {
  StepContext,
  NonInteractiveSeed,
} from "../shared/steps/context.js";

export interface RunInitOptions {
  /** Inject a custom PromptIO (tests). Defaults to readline-backed stdin/stdout. */
  readonly io?: PromptIO;
  /** Seed for non-interactive mode. Supplied via env or tests. */
  readonly seed?: Partial<NonInteractiveSeed>;
}

const DEFAULT_REGISTRY = "https://api.siliconretail.com";
const DEFAULT_CHAIN_ID = 1;

/**
 * Platform catalog for the init wizard.
 *
 * `available` means there's a working wizard path today. `planned` entries
 * still show up in the selection menu so merchants see the roadmap, but
 * selecting one prints a short "not yet" notice and exits without writing
 * anything. Add new adapters by flipping `available: true` and wiring the
 * per-platform step(s) in `platformSteps()` below.
 */
interface PlatformOption {
  readonly key: string;
  readonly label: string;
  readonly available: boolean;
}
const PLATFORMS: readonly PlatformOption[] = [
  { key: "shopify", label: "Shopify", available: true },
  { key: "woocommerce", label: "WooCommerce (planned)", available: false },
  { key: "magento", label: "Magento (planned)", available: false },
];

export async function runInit(
  args: string[],
  opts: RunInitOptions = {},
): Promise<void> {
  // Extract platform from first non-flag positional. If absent, we prompt
  // for it after the prompter is live (see below). Strip it out of args so
  // flag parsing and re-entrant logic don't see it.
  const positional = args.find((a) => !a.startsWith("--"));
  const remaining = positional ? args.filter((a) => a !== positional) : args;
  const flags = parseFlags(remaining);
  const force = flags.has("force");
  const dataDirArg = flags.get("data-dir") ?? "./acc-data";

  const io = opts.io ?? defaultPromptIO();
  const prompter = createPrompter(io);
  const seed = opts.seed ?? nonInteractiveSeedFromEnv();

  try {
    // Platform resolution. Precedence:
    //   1. Positional arg on the command line (`acc init shopify`)
    //   2. Interactive menu prompt
    //   3. Non-interactive seed → default to shopify (only available platform)
    const platform = await resolvePlatform(positional, prompter, !!seed);
    if (platform === null) {
      process.stdout.write("\nCancelled — no platform selected.\n");
      return;
    }

    const layout = ensureDataDir(dataDirArg);
    const existing = loadConfig(layout.configPath);

    const action = await resolveReentrantAction(
      layout,
      existing,
      prompter,
      force,
    );
    if (action === "cancel" || action === "keep") {
      process.stdout.write(`\nNo changes written. (action=${action})\n`);
      return;
    }
    if (action === "reset") {
      const backup = backupConfig(layout.configPath);
      if (backup) process.stdout.write(`Backed up old config to ${backup}\n`);
    }

    const ctx: StepContext = {
      layout,
      prompter,
      flags,
      force,
      config: existing
        ? { ...existing }
        : {
            dataVersion: 1,
            registry: seed?.registry ?? DEFAULT_REGISTRY,
            chainId: seed?.chainId ?? DEFAULT_CHAIN_ID,
            skillMdPath: layout.skillMd,
          },
      platform,
      seed,
    };

    const steps = platformSteps(platform, action);

    for (const [label, step] of steps) {
      process.stdout.write(`\n${label}\n`);
      const out = await step(ctx);
      process.stdout.write(`  → ${out.summary}\n`);
    }

    const final = finaliseConfig(ctx.config, layout);
    saveConfig(layout.configPath, final);

    printFinaleSummary(final, layout, platform);
  } finally {
    prompter.close();
  }
}

/**
 * Per-platform step sequence. Only Shopify has an end-to-end wizard today;
 * other `PLATFORMS` entries are filtered out before reaching this point
 * (see `resolvePlatform`).
 *
 * Shopify-only re-entrant action short-circuits to just step 6 so the
 * merchant can rotate Partners creds without regenerating keys.
 */
function platformSteps(
  platform: string,
  action: ReentrantAction,
): Array<readonly [string, (c: StepContext) => Promise<{ summary: string }>]> {
  if (platform === "shopify") {
    if (action === "shopify-only") {
      // Re-entrant path to rotate Shopify Partners creds in isolation.
      // The numbering matches the full 10-step flow for consistency in
      // printed output.
      return [["7/10 Shopify Partners creds", stepShopify]];
    }
    return [
      ["1/10 Preflight", stepPreflight],
      ["2/10 Data directory", stepDataDir],
      ["3/10 Public URL", stepSelfUrl],
      ["4/10 Encryption key", stepEncKey],
      ["5/10 Marketplace signer", stepSigner],
      ["6/10 Payment methods", stepPayment],
      ["7/10 Shopify Partners creds", stepShopify],
      ["8/10 SQLite migration", stepSqlite],
      ["9/10 Categories", stepCategories],
      ["10/10 Skill template", stepSkill],
    ];
  }
  throw new Error(
    `[acc init] platform '${platform}' has no wizard path yet (reached platformSteps — this is a bug).`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function parseFlags(args: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [k, v] = arg.slice(2).split("=", 2);
    if (!k) continue;
    map.set(k, v ?? "true");
  }
  return map;
}

type ReentrantAction = "fresh" | "reset" | "shopify-only" | "keep" | "cancel";

/**
 * Decide which platform's wizard to run.
 *
 *   1. Explicit positional on the command line (`acc init shopify`) wins.
 *      Unknown platform → usage error. Known-but-planned platform → print
 *      "not yet available" and return null.
 *   2. No positional + interactive terminal → present a menu of all known
 *      platforms (including planned ones, marked). User picks; planned
 *      selections again return null.
 *   3. No positional + non-interactive seed → default to "shopify" (only
 *      available platform). Tests rely on this to avoid an interactive hang.
 *
 * Returns the resolved platform key, or null if the user cancelled / picked
 * a not-yet-available platform.
 */
async function resolvePlatform(
  positional: string | undefined,
  prompter: Prompter,
  hasSeed: boolean,
): Promise<string | null> {
  if (positional) {
    const match = PLATFORMS.find((p) => p.key === positional.toLowerCase());
    if (!match) {
      process.stderr.write(
        `acc init: unknown platform '${positional}'. Supported: ${PLATFORMS.map((p) => p.key).join(", ")}\n`,
      );
      process.exit(2);
    }
    if (!match.available) {
      process.stdout.write(
        `\n${match.label} support is not yet available. Check back on a later release, or open an issue on GitHub.\n`,
      );
      return null;
    }
    return match.key;
  }

  // Fast path: when there's exactly one available platform we skip the
  // menu entirely — a one-option "menu" is just friction. The menu comes
  // back the moment a second platform flips `available: true`. This also
  // lets the non-interactive seed path fall through cleanly (single
  // shopify platform today) without a special-case early return.
  const available = PLATFORMS.filter((p) => p.available);
  if (available.length === 1) {
    return available[0]!.key;
  }

  if (hasSeed) {
    // Defensive: if more than one platform ever becomes available, the
    // seed schema must grow a `platform` field. Until then, fall back
    // to the first available so existing tests don't break silently.
    return available[0]?.key ?? "shopify";
  }

  // Interactive menu. Letter keys map to platform order so the hotkey
  // stays stable as PLATFORMS grows.
  const choices = PLATFORMS.map((p, i) => ({
    key: String.fromCharCode(97 + i),
    label: p.label,
  }));
  process.stdout.write(
    "\nWelcome to ACC. Which e-commerce platform is this connector for?\n",
  );
  const picked = await prompter.askChoice("Select a platform:", choices);
  const index = picked.charCodeAt(0) - 97;
  const platform = PLATFORMS[index];
  if (!platform) return null;
  if (!platform.available) {
    process.stdout.write(
      `\n${platform.label} support is not yet available. Check back on a later release.\n`,
    );
    return null;
  }
  return platform.key;
}

async function resolveReentrantAction(
  layout: DataDirLayout,
  existing: AccConfig | null,
  prompter: Prompter,
  force: boolean,
): Promise<ReentrantAction> {
  if (!existing) return "fresh";
  if (force) return "reset";
  const choice = await prompter.askChoice(
    `Found existing config at ${layout.configPath}. What next?`,
    [
      { key: "a", label: "keep as-is (exit)" },
      { key: "b", label: "update Shopify credentials only" },
      { key: "c", label: "start over (backs up current)" },
      { key: "d", label: "cancel" },
    ],
  );
  return (
    {
      a: "keep" as const,
      b: "shopify-only" as const,
      c: "reset" as const,
      d: "cancel" as const,
    }[choice] ?? "cancel"
  );
}

function finaliseConfig(
  partial: Partial<AccConfig>,
  layout: DataDirLayout,
): AccConfig {
  const base: AccConfig = {
    dataVersion: 1,
    registry: partial.registry ?? DEFAULT_REGISTRY,
    chainId: partial.chainId ?? DEFAULT_CHAIN_ID,
    selfUrl: partial.selfUrl ?? "https://acc.example.com",
    skillMdPath: partial.skillMdPath ?? layout.skillMd,
  };
  if (partial.wallet) {
    return { ...base, wallet: partial.wallet };
  }
  return base;
}

function printFinaleSummary(
  cfg: AccConfig,
  layout: DataDirLayout,
  platform: string,
): void {
  process.stdout.write(
    `\n✓ acc init complete (platform: ${platform})\n` +
      `  data dir : ${layout.root}\n` +
      `  registry : ${cfg.registry}\n` +
      `  selfUrl  : ${cfg.selfUrl}\n` +
      `  wallet   : ${cfg.wallet?.address ?? "(not configured)"}\n` +
      `  skill    : ${cfg.skillMdPath}\n` +
      `\nNext: acc start\n`,
  );
}

function nonInteractiveSeedFromEnv(): Partial<NonInteractiveSeed> | undefined {
  const raw = process.env.ACC_INIT_CONFIG;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Partial<NonInteractiveSeed>;
  } catch {
    throw new Error("ACC_INIT_CONFIG is set but contains invalid JSON");
  }
}
