// ---------------------------------------------------------------------------
// Key generation, persistence, and optional at-rest encryption.
//
//  - enc.key      : 32-byte AES-256 key, 64 hex chars, used by the connector's
//                   token-cipher to encrypt/decrypt Shopify admin tokens.
//  - signer.key   : secp256k1 private key (0x-prefixed hex) used to sign
//                   EIP-712 marketplace submissions.
//
// Encryption wrapper for signer.key: PBKDF2(SHA-256, 200k) + AES-256-GCM.
// The wrapped payload is a JSON doc with versioning + a KDF salt + iv + tag,
// all hex-encoded. Keeping it JSON (rather than a raw binary blob) makes it
// easy to eyeball on disk and migrate if KDF params change.
// ---------------------------------------------------------------------------

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from "node:crypto";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface GeneratedSigner {
  readonly privateKey: Hex;
  readonly address: `0x${string}`;
}

export interface WriteKeyOptions {
  readonly force?: boolean;
}

export function generateEncKey(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

export function writeEncKey(
  path: string,
  key: string,
  opts: WriteKeyOptions = {},
): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error("enc.key must be 64 hex chars (32 bytes, AES-256)");
  }
  writeSecretFile(path, key, opts.force ?? false);
}

export function generateSignerKey(): GeneratedSigner {
  const privateKey = `0x${randomBytes(32).toString("hex")}` as Hex;
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

export function writeSignerKey(
  path: string,
  privateKeyOrWrapped: string,
  opts: WriteKeyOptions = {},
): void {
  writeSecretFile(path, privateKeyOrWrapped, opts.force ?? false);
}

export function readSignerKey(path: string): string {
  return readFileSync(path, "utf-8").trim();
}

/* -------------------------------------------------------------------------- */
/*  Optional at-rest encryption (§G decision 4 opt-in flag)                    */
/* -------------------------------------------------------------------------- */

interface WrappedSigner {
  readonly v: 1;
  readonly alg: "aes-256-gcm";
  readonly kdf: "pbkdf2-sha256";
  readonly iterations: number;
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export function encryptSignerKey(
  privateKey: string,
  passphrase: string,
): string {
  if (!passphrase) {
    throw new Error("passphrase is empty — refusing to encrypt signer key");
  }
  const salt = randomBytes(SALT_BYTES);
  const key = pbkdf2Sync(
    passphrase,
    salt,
    PBKDF2_ITERATIONS,
    KEY_BYTES,
    "sha256",
  );
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const wrapped: WrappedSigner = {
    v: 1,
    alg: "aes-256-gcm",
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
  return JSON.stringify(wrapped);
}

export function decryptSignerKey(
  wrappedJson: string,
  passphrase: string,
): string {
  const wrapped = parseWrapped(wrappedJson);
  const key = pbkdf2Sync(
    passphrase,
    Buffer.from(wrapped.salt, "hex"),
    wrapped.iterations,
    KEY_BYTES,
    "sha256",
  );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(wrapped.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(wrapped.tag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(wrapped.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf-8");
}

export function isWrappedSigner(contents: string): boolean {
  try {
    const parsed = JSON.parse(contents.trim()) as {
      v?: unknown;
      alg?: unknown;
    };
    return parsed.v === 1 && parsed.alg === "aes-256-gcm";
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Internals                                                                  */
/* -------------------------------------------------------------------------- */

function writeSecretFile(path: string, contents: string, force: boolean): void {
  if (existsSync(path) && !force) {
    throw new Error(
      `refuse to overwrite existing secret at ${path} — pass { force: true } to replace it`,
    );
  }
  writeFileSync(path, contents, { mode: 0o600, encoding: "utf-8" });
  chmodSync(path, 0o600); // belt + suspenders: fs.writeFileSync mode flag is advisory on some platforms
}

function parseWrapped(input: string): WrappedSigner {
  const parsed = JSON.parse(input) as Partial<WrappedSigner>;
  if (parsed.v !== 1 || parsed.alg !== "aes-256-gcm") {
    throw new Error("unsupported wrapped-signer format");
  }
  if (
    typeof parsed.salt !== "string" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.iterations !== "number" ||
    parsed.kdf !== "pbkdf2-sha256"
  ) {
    throw new Error("wrapped-signer payload is malformed");
  }
  return parsed as WrappedSigner;
}
