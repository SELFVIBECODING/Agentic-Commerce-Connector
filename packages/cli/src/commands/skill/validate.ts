import { runVerify } from "../verify.js";

export async function runSkillValidate(args: readonly string[]): Promise<void> {
  // Thin wrapper — verify.ts already parses frontmatter and prints sha256.
  await runVerify([...args]);
}
