// ---------------------------------------------------------------------------
// Step 9 — Categories (multi-select).
//
// The marketplace (siliconretail.com) indexes listings by a fixed taxonomy.
// The merchant picks one or more categories here; step10 (skill template)
// reads them back through ctx.categories and writes them into the generated
// frontmatter's `categories` field. At least one selection is required —
// the skill spec rejects an empty categories array (see
// packages/skill-spec/src/skill-md.ts NON_EMPTY_ARRAY_FIELDS).
//
// The catalog below is the authoritative mirror of siliconretail.com's
// taxonomy. When the marketplace adds a new category, update this list
// (and bump data_version if persistence semantics change).
// ---------------------------------------------------------------------------

import type { StepContext, StepOutcome } from "./context.js";

interface CategoryOption {
  readonly key: string;
  readonly id: string;
}

const CATEGORIES: readonly CategoryOption[] = [
  { key: "a", id: "Fashion" },
  { key: "b", id: "Electronics" },
  { key: "c", id: "Books" },
  { key: "d", id: "Home" },
  { key: "e", id: "Food" },
  { key: "f", id: "Services" },
  { key: "g", id: "Digital" },
  { key: "h", id: "Travel" },
];

const VALID_IDS = new Set(CATEGORIES.map((c) => c.id));

export async function stepCategories(ctx: StepContext): Promise<StepOutcome> {
  const selected = await resolveSelection(ctx);
  ctx.categories = selected;
  return {
    applied: true,
    summary: `categories: ${selected.join(", ")}`,
  };
}

async function resolveSelection(ctx: StepContext): Promise<string[]> {
  // Non-interactive seed path: honour explicit selection if given, validate
  // against the authoritative list. Seed falling through with no categories
  // defaults to ["Digital"] — a neutral choice that keeps seeded runs
  // deterministic and the published skill.md valid.
  if (ctx.seed) {
    const seeded = ctx.seed.categories;
    if (seeded && seeded.length > 0) {
      for (const c of seeded) {
        if (!VALID_IDS.has(c)) {
          throw new Error(
            `invalid category seed: ${c} (must be one of ${[...VALID_IDS].join(", ")})`,
          );
        }
      }
      return [...seeded];
    }
    return ["Digital"];
  }

  process.stdout.write(
    `\n  Pick one or more categories for your marketplace listing.\n` +
      `  Use Space to toggle rows, Enter to submit.\n\n`,
  );

  // Pass the category display names as labels so the arrow-key UI shows
  // "Fashion" etc. directly. Non-TTY fallback falls back through
  // askMultiChoice → comma-separated letters, validated against the same
  // catalog. Key letters (a-h) match the labels' position for hint parity.
  const selectedKeys = await ctx.prompter.askMultiChoice(
    "Categories (pick one or more):",
    CATEGORIES.map((c) => ({ key: c.key, label: c.id })),
    { min: 1 },
  );

  // askMultiChoice already validates membership + returns keys in catalog
  // order, but we still map back to canonical IDs here so the skill.md
  // frontmatter carries display names (e.g. "Fashion"), not internal keys.
  return selectedKeys.map((k) => {
    const match = CATEGORIES.find((c) => c.key === k);
    if (!match)
      throw new Error(`[step9-categories] unknown key from prompter: ${k}`);
    return match.id;
  });
}
