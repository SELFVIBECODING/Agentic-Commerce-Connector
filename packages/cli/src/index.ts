#!/usr/bin/env node
import { runInit } from "./commands/init.js";
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
    console.error(`acc-skill: unknown command "${command}"`);
    printHelp();
    process.exit(2);
  }
  await handler(rest);
}

function printHelp(): void {
  process.stdout
    .write(`acc-skill — scaffold, publish, and verify ACC merchant skill markdown

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
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
