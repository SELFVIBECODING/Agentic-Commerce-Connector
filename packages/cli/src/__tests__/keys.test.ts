import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateEncKey,
  writeEncKey,
  generateSignerKey,
  writeSignerKey,
  readSignerKey,
  encryptSignerKey,
  decryptSignerKey,
} from "../shared/keys.js";

describe("generateEncKey", () => {
  it("returns 64 lowercase hex chars", () => {
    const k = generateEncKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is non-deterministic", () => {
    expect(generateEncKey()).not.toBe(generateEncKey());
  });
});

describe("writeEncKey", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-keys-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes key to file with 0600 perms", () => {
    const path = join(tmp, "enc.key");
    const key = generateEncKey();
    writeEncKey(path, key);
    expect(readFileSync(path, "utf-8")).toBe(key);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("refuses to overwrite without force", () => {
    const path = join(tmp, "enc.key");
    writeEncKey(path, generateEncKey());
    expect(() => writeEncKey(path, generateEncKey())).toThrow(/refuse/i);
  });

  it("overwrites with force=true", () => {
    const path = join(tmp, "enc.key");
    const first = generateEncKey();
    writeEncKey(path, first);
    const second = generateEncKey();
    writeEncKey(path, second, { force: true });
    expect(readFileSync(path, "utf-8")).toBe(second);
  });
});

describe("signer key", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-signer-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("generates a valid 0x-prefixed 32-byte hex", () => {
    const { privateKey, address } = generateSignerKey();
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("writeSignerKey → readSignerKey round-trips plaintext", () => {
    const path = join(tmp, "signer.key");
    const { privateKey } = generateSignerKey();
    writeSignerKey(path, privateKey);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readSignerKey(path)).toBe(privateKey);
  });

  it("encryptSignerKey → decryptSignerKey round-trips with passphrase", () => {
    const { privateKey } = generateSignerKey();
    const wrapped = encryptSignerKey(privateKey, "correct horse battery staple");
    expect(wrapped).not.toContain(privateKey);
    const unwrapped = decryptSignerKey(wrapped, "correct horse battery staple");
    expect(unwrapped).toBe(privateKey);
  });

  it("decryptSignerKey rejects wrong passphrase", () => {
    const { privateKey } = generateSignerKey();
    const wrapped = encryptSignerKey(privateKey, "right-pass");
    expect(() => decryptSignerKey(wrapped, "wrong-pass")).toThrow();
  });
});
