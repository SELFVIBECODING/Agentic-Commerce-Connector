import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildSkillMd, type SkillFrontmatter } from "@acc/skill-spec";

/* ------------------------------------------------------------------ */
/*  Arg helpers                                                       */
/* ------------------------------------------------------------------ */

function parseFlag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/* ------------------------------------------------------------------ */
/*  Template                                                          */
/* ------------------------------------------------------------------ */

const TEMPLATE_FRONTMATTER: SkillFrontmatter = {
  name: "My Store",
  description:
    "Short one-line pitch for the marketplace listing (<= 280 chars).",
  skill_id: "my-store-v1",
  categories: ["digital"],
  supported_platforms: ["custom"],
  supported_payments: ["stripe"],
  health_url: "https://store.example.com/health",
  tags: ["placeholder"],
  website_url: "https://store.example.com",
};

const TEMPLATE_BODY = `# My Store

Describe in freeform markdown what this merchant offers to AI agents:

- What the skill exposes (catalog browse, checkout, order status, …)
- Supported platforms / payment handlers
- Contact or support info

Edit the YAML frontmatter above and the body below, then host this file
somewhere publicly reachable over HTTPS and publish it:

    acc-skill publish ./acc-skill.md \\
      --url=https://store.example.com/.well-known/acc-skill.md \\
      --registry=https://api.siliconretail.com \\
      --private-key=0x...

The marketplace will fetch the URL, verify the content hash against the
EIP-712 signature, and index the frontmatter fields above.
`;

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export async function runInit(args: string[]): Promise<void> {
  const outPath = resolve(parseFlag(args, "out") ?? "./acc-skill.md");
  const force = hasFlag(args, "force");

  if (existsSync(outPath) && !force) {
    throw new Error(
      `Refusing to overwrite ${outPath}. Pass --force to replace it.`,
    );
  }

  const content = buildSkillMd(TEMPLATE_FRONTMATTER, TEMPLATE_BODY);
  writeFileSync(outPath, content, "utf-8");

  process.stdout.write(
    `Wrote skill template to ${outPath}\n` +
      `Next:\n` +
      `  1. Edit the frontmatter and body\n` +
      `  2. Host the file at an https:// URL\n` +
      `  3. acc-skill publish ${outPath} --url=<hosted-url> --registry=<url> --private-key=0x...\n`,
  );
}
