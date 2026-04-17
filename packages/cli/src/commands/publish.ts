import { readFileSync, existsSync } from "node:fs";
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
import { resolveDataDir } from "../shared/data-dir.js";
import { loadConfig } from "../shared/config-store.js";
import { isWrappedSigner, decryptSignerKey } from "../shared/keys.js";
import {
  createPrompter,
  defaultPromptIO,
  type PromptIO,
} from "../shared/prompts.js";

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

export interface PublishOptions {
  /** Allows tests to inject a PromptIO for signer passphrase entry. */
  readonly io?: PromptIO;
}

export async function runPublish(
  args: string[],
  opts: PublishOptions = {},
): Promise<void> {
  const dataDirFlag = parseFlag(args, "data-dir");
  const layout = resolveDataDir(dataDirFlag ?? "./acc-data");
  const cfg = loadConfig(layout.configPath);

  const filePath = positional(args) ?? cfg?.skillMdPath;
  if (!filePath) {
    throw new Error(
      "Usage: acc publish [FILE] [--url=URL] [--registry=URL] [--private-key=HEX]\n" +
        "Zero-arg mode requires a complete acc-data/config.json — run 'acc init' first.",
    );
  }

  const hostedUrl =
    (parseFlag(args, "url") ?? cfg?.selfUrl)
      ? stripTrailing((parseFlag(args, "url") ?? cfg?.selfUrl)!) +
        "/.well-known/acc-skill.md"
      : undefined;
  const explicitUrl = parseFlag(args, "url");
  const resolvedUrl = explicitUrl ?? hostedUrl;
  if (!resolvedUrl) {
    throw new Error(
      "Missing --url=<hosted-url> and no selfUrl in config.json to derive a default.",
    );
  }
  if (!/^https:\/\//.test(resolvedUrl)) {
    throw new Error("--url must be an https:// URL.");
  }

  const registry = parseFlag(args, "registry") ?? cfg?.registry;
  if (!registry) {
    throw new Error("Missing --registry=<url> and no registry in config.json.");
  }

  const privateKeyHex =
    parseFlag(args, "private-key") ??
    (await loadSignerKey(layout.signerKeyFile, opts));
  if (!privateKeyHex) {
    throw new Error(
      "Missing --private-key=<hex> and no signer.key in acc-data/keys/.",
    );
  }

  // Read, validate, hash the skill markdown
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    throw new Error(`skill file not found: ${absPath}`);
  }
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
    skill_url: resolvedUrl,
    skill_sha256: skillSha256,
    nonce: randomUUID(),
    submitted_at: Date.now(),
  };

  const chainId = Number(process.env.EIP712_CHAIN_ID ?? cfg?.chainId ?? 1);
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
        `  url:    ${resolvedUrl}\n` +
        `  sha256: ${skillSha256}\n` +
        `  wallet: ${account.address}\n`,
    );
    return;
  }

  const code = envelope.error?.code ?? `HTTP_${response.status}`;
  const message = envelope.error?.message ?? JSON.stringify(body);
  throw new Error(`Registry rejected submission [${code}]: ${message}`);
}

/* ------------------------------------------------------------------ */
/*  Zero-arg helpers                                                  */
/* ------------------------------------------------------------------ */

function stripTrailing(url: string): string {
  return url.replace(/\/+$/, "");
}

async function loadSignerKey(
  signerKeyFile: string,
  opts: PublishOptions,
): Promise<string | undefined> {
  if (!existsSync(signerKeyFile)) return undefined;
  const raw = readFileSync(signerKeyFile, "utf-8").trim();
  if (!isWrappedSigner(raw)) return raw;

  const io = opts.io ?? defaultPromptIO();
  const prompter = createPrompter(io);
  try {
    const pass = await prompter.askSecret("Signer key passphrase");
    return decryptSignerKey(raw, pass);
  } finally {
    prompter.close();
  }
}
