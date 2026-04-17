import { existsSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { resolveDataDir } from "../../shared/data-dir.js";
import { isWrappedSigner, decryptSignerKey } from "../../shared/keys.js";
import {
  createPrompter,
  defaultPromptIO,
  type PromptIO,
} from "../../shared/prompts.js";

export interface WalletShowOptions {
  readonly dataDir?: string;
  readonly io?: PromptIO;
}

export async function runWalletShow(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  await showWallet({ dataDir: flags.get("data-dir") });
}

export async function showWallet(
  opts: WalletShowOptions = {},
): Promise<string> {
  const layout = resolveDataDir(opts.dataDir ?? "./acc-data");
  if (!existsSync(layout.signerKeyFile)) {
    throw new Error(`No signer.key at ${layout.signerKeyFile}. Run 'acc init' or 'acc wallet new'.`);
  }
  const raw = readFileSync(layout.signerKeyFile, "utf-8").trim();
  const privateKey = isWrappedSigner(raw)
    ? await decryptWithPrompt(raw, opts.io)
    : raw;
  const address = privateKeyToAccount(privateKey as Hex).address;
  // Surgical: print ONLY the address. Never log `raw` or `privateKey`.
  process.stdout.write(`${address}\n`);
  return address;
}

async function decryptWithPrompt(
  wrapped: string,
  providedIO: PromptIO | undefined,
): Promise<string> {
  const io = providedIO ?? defaultPromptIO();
  const prompter = createPrompter(io);
  try {
    const pass = await prompter.askSecret("Signer key passphrase");
    return decryptSignerKey(wrapped, pass);
  } finally {
    prompter.close();
  }
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [k, v] = arg.slice(2).split("=", 2);
    if (!k) continue;
    map.set(k, v ?? "true");
  }
  return map;
}
