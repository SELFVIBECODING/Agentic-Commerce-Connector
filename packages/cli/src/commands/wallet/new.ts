import { existsSync, copyFileSync } from "node:fs";
import { resolveDataDir } from "../../shared/data-dir.js";
import {
  loadConfig,
  saveConfig,
  type AccConfig,
} from "../../shared/config-store.js";
import {
  generateSignerKey,
  writeSignerKey,
  encryptSignerKey,
} from "../../shared/keys.js";

export interface WalletNewOptions {
  readonly dataDir?: string;
  readonly yes?: boolean;
  readonly encryptPassphrase?: string;
}

export async function runWalletNew(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  await newWallet({
    dataDir: flags.get("data-dir"),
    yes: flags.has("yes"),
    encryptPassphrase: flags.get("encrypt-passphrase"),
  });
}

export async function newWallet(opts: WalletNewOptions): Promise<string> {
  if (!opts.yes) {
    throw new Error(
      "acc wallet new is destructive — pass --yes to confirm overwrite",
    );
  }
  const layout = resolveDataDir(opts.dataDir ?? "./acc-data");

  if (existsSync(layout.signerKeyFile)) {
    const backup = `${layout.signerKeyFile}.bak`;
    copyFileSync(layout.signerKeyFile, backup);
    process.stdout.write(`Backed up previous signer.key to ${backup}\n`);
  }

  const { privateKey, address } = generateSignerKey();
  const encrypted = Boolean(opts.encryptPassphrase);
  const toWrite = encrypted
    ? encryptSignerKey(privateKey, opts.encryptPassphrase!)
    : privateKey;
  writeSignerKey(layout.signerKeyFile, toWrite, { force: true });

  const existing = loadConfig(layout.configPath);
  if (existing) {
    const next: AccConfig = {
      ...existing,
      wallet: { address, encrypted },
    };
    saveConfig(layout.configPath, next);
  }

  process.stdout.write(`New signer wallet: ${address}\n`);
  return address;
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
