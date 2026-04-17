import { existsSync, copyFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { resolveDataDir } from "../../shared/data-dir.js";
import {
  loadConfig,
  saveConfig,
  type AccConfig,
} from "../../shared/config-store.js";
import { writeSignerKey, encryptSignerKey } from "../../shared/keys.js";

const HEX_RE = /^0x[0-9a-fA-F]{64}$/;

export interface WalletImportOptions {
  readonly dataDir?: string;
  readonly privateKey: string;
  readonly encryptPassphrase?: string;
}

export async function runWalletImport(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const privateKey = flags.get("key");
  if (!privateKey) {
    throw new Error("Usage: acc wallet import --key=0x<64hex>");
  }
  await importWallet({
    dataDir: flags.get("data-dir"),
    privateKey,
    encryptPassphrase: flags.get("encrypt-passphrase"),
  });
}

export async function importWallet(opts: WalletImportOptions): Promise<string> {
  if (!HEX_RE.test(opts.privateKey)) {
    throw new Error("invalid private key (expected 0x + 64 hex chars)");
  }
  const layout = resolveDataDir(opts.dataDir ?? "./acc-data");
  if (existsSync(layout.signerKeyFile)) {
    const backup = `${layout.signerKeyFile}.bak`;
    copyFileSync(layout.signerKeyFile, backup);
    process.stdout.write(`Backed up previous signer.key to ${backup}\n`);
  }
  const address = privateKeyToAccount(opts.privateKey as Hex).address;
  const encrypted = Boolean(opts.encryptPassphrase);
  const toWrite = encrypted
    ? encryptSignerKey(opts.privateKey, opts.encryptPassphrase!)
    : opts.privateKey;
  writeSignerKey(layout.signerKeyFile, toWrite, { force: true });

  const existing = loadConfig(layout.configPath);
  if (existing) {
    const next: AccConfig = {
      ...existing,
      wallet: { address, encrypted },
    };
    saveConfig(layout.configPath, next);
  }

  process.stdout.write(`Imported signer wallet: ${address}\n`);
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
