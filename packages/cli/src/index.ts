#!/usr/bin/env node
import { runInit } from "./commands/skill/init.js";
import { runSign } from "./commands/sign.js";
import { runPublish } from "./commands/publish.js";
import { runVerify } from "./commands/verify.js";

const [, , command, ...rest] = process.argv;

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  init: runInit,
  sign: runSign,
  publish: runPublish,
  verify: runVerify,
};

async function main(): Promise<void> {
  process.stderr.write(
    "note: `acc-skill` is deprecated — use `acc` (run `acc help`). Will be removed in a future release.\n",
  );

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    printHelp();
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`acc-skill: unknown command "${command}"\n`);
    printHelp();
    process.exit(2);
  }
  await handler(rest);
}

function printHelp(): void {
  process.stdout
    .write(`acc-skill — scaffold, publish, and verify ACC merchant skill markdown
(deprecated; prefer 'acc' for new workflows)

Usage:
  acc-skill init [--out=./acc-skill.md] [--force]
      Write a skill.md template with frontmatter + placeholder body.

  acc-skill verify <acc-skill.md>
      Parse + validate the frontmatter, print the canonical sha256.

  acc-skill publish <acc-skill.md> \\
      --url=<hosted-https-url> \\
      --registry=<marketplace-url> \\
      --private-key=<0x...>
      Hash the local file, build an EIP-712 MarketplaceSubmission,
      sign it with --private-key, and POST to <registry>/v1/submissions.
      The marketplace will fetch --url, recompute the hash, and reject
      anything that does not match.
`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
