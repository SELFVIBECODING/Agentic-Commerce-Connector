import { existsSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  generateSignerKey,
  writeSignerKey,
  encryptSignerKey,
  isWrappedSigner,
} from "../keys.js";
import type { StepContext, StepOutcome } from "./context.js";

const HEX_RE = /^0x[0-9a-fA-F]{64}$/;

export async function stepSigner(ctx: StepContext): Promise<StepOutcome> {
  if (existsSync(ctx.layout.signerKeyFile)) {
    const contents = readFileSync(ctx.layout.signerKeyFile, "utf-8").trim();
    const encrypted = isWrappedSigner(contents);
    const address = encrypted ? "[encrypted]" : deriveAddress(contents);
    ctx.config.wallet = {
      address: encrypted ? "0x0000000000000000000000000000000000000000" : address,
      encrypted,
    };
    return { applied: false, summary: `signer.key preserved (encrypted=${encrypted})` };
  }

  const mode = await pickMode(ctx);
  if (mode === "skip") {
    return { applied: false, summary: "signer skipped (you'll need to add one before publishing)" };
  }

  const privateKey = mode === "generate" ? generateSignerKey().privateKey : (mode as Hex);
  const address = privateKeyToAccount(privateKey).address;

  const passphrase = ctx.seed?.signerPassphrase;
  const toWrite = passphrase ? encryptSignerKey(privateKey, passphrase) : privateKey;

  writeSignerKey(ctx.layout.signerKeyFile, toWrite);
  ctx.config.wallet = { address, encrypted: Boolean(passphrase) };

  return {
    applied: true,
    summary: `signer.key written (${passphrase ? "encrypted" : "plaintext 0600"}) — address ${address}`,
  };
}

async function pickMode(ctx: StepContext): Promise<"generate" | "skip" | Hex> {
  if (ctx.seed?.signer) {
    const seeded = ctx.seed.signer;
    if (seeded === "generate" || seeded === "skip") return seeded;
    if (HEX_RE.test(seeded)) return seeded as Hex;
    throw new Error(`invalid signer seed: ${seeded}`);
  }
  const choice = await ctx.prompter.askChoice("Marketplace signer key", [
    { key: "g", label: "generate a new one" },
    { key: "i", label: "import an existing 0x hex key" },
    { key: "s", label: "skip (configure later)" },
  ]);
  if (choice === "s") return "skip";
  if (choice === "g") return "generate";
  const hex = await ctx.prompter.askSecret("Paste 0x-prefixed 32-byte hex private key");
  if (!HEX_RE.test(hex)) {
    throw new Error("invalid private key format (expected 0x + 64 hex chars)");
  }
  return hex as Hex;
}

function deriveAddress(privateKey: string): `0x${string}` {
  return privateKeyToAccount(privateKey as Hex).address;
}
