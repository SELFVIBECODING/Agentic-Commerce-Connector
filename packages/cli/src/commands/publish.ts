import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  buildMarketplaceSubmissionTypedData,
  computeSkillSha256,
  parseSkillMd,
  type MarketplaceSubmission,
} from "@acc/skill-spec";

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

function positional(args: readonly string[]): string | undefined {
  return args.find((a) => !a.startsWith("--"));
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export async function runPublish(args: string[]): Promise<void> {
  const filePath = positional(args);
  if (!filePath) {
    throw new Error(
      "Usage: acc-skill publish <acc-skill.md> --url=<hosted-url> --registry=<url> --private-key=<hex>",
    );
  }

  const hostedUrl = parseFlag(args, "url");
  if (!hostedUrl) {
    throw new Error(
      "Missing required flag --url=<public https URL where the file is hosted>",
    );
  }
  if (!/^https:\/\//.test(hostedUrl)) {
    throw new Error("--url must be an https:// URL.");
  }

  const registry = parseFlag(args, "registry");
  if (!registry) {
    throw new Error("Missing required flag --registry=<url>.");
  }

  const privateKeyHex = parseFlag(args, "private-key");
  if (!privateKeyHex) {
    throw new Error("Missing required flag --private-key=<hex>.");
  }

  // Read, validate, hash the skill markdown
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, "utf-8");
  const parsed = parseSkillMd(raw); // throws on invalid frontmatter
  const skillSha256 = computeSkillSha256(raw);

  // Derive wallet from private key
  const account = privateKeyToAccount(privateKeyHex as Hex);

  // Build EIP-712 submission
  const submission: MarketplaceSubmission = {
    action: "publish",
    wallet: account.address,
    skill_id: parsed.frontmatter.skill_id,
    skill_url: hostedUrl,
    skill_sha256: skillSha256,
    nonce: randomUUID(),
    submitted_at: Date.now(),
  };

  const chainId = Number(process.env.EIP712_CHAIN_ID ?? 1);
  const typedData = buildMarketplaceSubmissionTypedData(submission, chainId);

  const signature = await account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });

  // POST to registry
  const endpoint = `${registry.replace(/\/+$/, "")}/v1/submissions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: submission, signature }),
  });

  const body: unknown = await response.json();
  const envelope = body as {
    readonly ok?: boolean;
    readonly data?: unknown;
    readonly error?: { readonly code?: string; readonly message?: string };
  };

  if (envelope.ok) {
    process.stdout.write(
      `Published "${parsed.frontmatter.name}" (${parsed.frontmatter.skill_id})\n` +
        `  url:    ${hostedUrl}\n` +
        `  sha256: ${skillSha256}\n` +
        `  wallet: ${account.address}\n`,
    );
    return;
  }

  const code = envelope.error?.code ?? `HTTP_${response.status}`;
  const message = envelope.error?.message ?? JSON.stringify(body);
  throw new Error(`Registry rejected submission [${code}]: ${message}`);
}
