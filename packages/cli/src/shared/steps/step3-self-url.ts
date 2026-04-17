import { upsertEnv } from "../env-writer.js";
import type { StepContext, StepOutcome } from "./context.js";

const URL_RE = /^https:\/\/[^\s/]+(?::\d+)?(?:\/[^\s]*)?$/;

export async function stepSelfUrl(ctx: StepContext): Promise<StepOutcome> {
  const seeded = ctx.seed?.selfUrl;
  const value = seeded
    ? validateOrThrow(seeded)
    : await ctx.prompter.ask("Public HTTPS URL for this connector", {
        default: "https://acc.example.com",
        validate: (v) => (URL_RE.test(v) ? null : "must be an https:// URL with no trailing slash"),
      });
  const trimmed = value.replace(/\/+$/, "");
  upsertEnv(ctx.layout.envPath, { SELF_URL: trimmed });
  ctx.config.selfUrl = trimmed;
  return { applied: true, summary: `SELF_URL=${trimmed}` };
}

function validateOrThrow(v: string): string {
  if (!URL_RE.test(v)) {
    throw new Error(`invalid selfUrl seed: ${v}`);
  }
  return v;
}
