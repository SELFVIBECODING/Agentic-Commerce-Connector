import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeSkillSha256, parseSkillMd } from "@acc/skill-spec";

/* ------------------------------------------------------------------ */
/*  Arg helpers                                                       */
/* ------------------------------------------------------------------ */

function positional(args: readonly string[]): string | undefined {
  return args.find((a) => !a.startsWith("--"));
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export async function runVerify(args: string[]): Promise<void> {
  const filePath = positional(args);
  if (!filePath) {
    throw new Error("Usage: acc-skill verify <acc-skill.md>");
  }
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, "utf-8");

  const parsed = parseSkillMd(raw); // throws on invalid frontmatter
  const sha256 = computeSkillSha256(raw);

  process.stdout.write(
    `Valid skill markdown: ${absPath}\n` +
      `  name:        ${parsed.frontmatter.name}\n` +
      `  skill_id:    ${parsed.frontmatter.skill_id}\n` +
      `  categories:  ${parsed.frontmatter.categories.join(", ")}\n` +
      `  platforms:   ${parsed.frontmatter.supported_platforms.join(", ")}\n` +
      `  payments:    ${parsed.frontmatter.supported_payments.join(", ")}\n` +
      `  health_url:  ${parsed.frontmatter.health_url}\n` +
      `  sha256:      ${sha256}\n`,
  );
}
