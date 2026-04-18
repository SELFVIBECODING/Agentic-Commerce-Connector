import type { Prompter } from "../prompts.js";
import type { DataDirLayout } from "../data-dir.js";
import type { AccConfig } from "../config-store.js";

export interface StepContext {
  /** Fully-resolved data-dir layout. */
  layout: DataDirLayout;
  /** Interactive prompter. In tests, pass a mock PromptIO. */
  prompter: Prompter;
  /** Raw CLI flags passed to `acc init`. */
  flags: ReadonlyMap<string, string>;
  /** Whether --force was passed. */
  force: boolean;
  /** Mutable config being accumulated; steps patch and later saveConfig writes. */
  config: Partial<AccConfig> & { wallet?: AccConfig["wallet"] };
  /**
   * Platform selected by `resolvePlatform()` in init.ts — e.g. "shopify".
   * Intentionally NOT persisted to `config.json` yet; the schema picks it
   * up when multi-platform support lands (today it's derivable from the
   * presence of Shopify-specific env vars). Steps use it to template
   * platform-specific frontmatter and skip unused branches.
   */
  platform: string;
  /**
   * Categories chosen in step 9 (multi-select). Threaded from step 9 to
   * step 10 (skill template) via this field. Not persisted to config.json
   * yet — skill.md on disk is the source of truth after generation.
   */
  categories?: readonly string[];
  /** Non-interactive seed (for --non-interactive mode / tests). */
  seed?: Partial<NonInteractiveSeed>;
}

export interface NonInteractiveSeed {
  readonly selfUrl: string;
  readonly registry: string;
  readonly chainId: number;
  readonly shopifyClientId: string;
  readonly shopifyClientSecret: string;
  /** "generate" | "skip" | hex-private-key */
  readonly signer: string;
  /** Optional passphrase when signer should be encrypted at rest. */
  readonly signerPassphrase?: string;
  /**
   * Payment method step input. Phase 1 ships only `"none"` as an available
   * choice; other IDs (e.g. "nexus-platon", "stripe") will become valid
   * seeds once their providers are wired. Defaults to `"none"` when the
   * seed is partial so existing wizard.test.ts fixtures keep passing.
   */
  readonly paymentMethod?: string;
  /**
   * Marketplace categories (Fashion / Electronics / Books / Home / Food /
   * Services / Digital / Travel — must match siliconretail.com). Defaults
   * to `["Digital"]` when omitted in seed mode so seeded runs produce a
   * schema-valid skill.md.
   */
  readonly categories?: readonly string[];
}

export interface StepOutcome {
  readonly applied: boolean;
  readonly summary: string;
}
