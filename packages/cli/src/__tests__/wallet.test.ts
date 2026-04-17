import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ensureDataDir } from "../shared/data-dir.js";
import { saveConfig, loadConfig, type AccConfig } from "../shared/config-store.js";
import { showWallet } from "../commands/wallet/show.js";
import { newWallet } from "../commands/wallet/new.js";
import { importWallet } from "../commands/wallet/import.js";

const SEED_CONFIG: AccConfig = {
  dataVersion: 1,
  registry: "https://api.siliconretail.com",
  chainId: 1,
  selfUrl: "https://acc.example.com",
  skillMdPath: "./acc-data/skill/acc-skill.md",
};

describe("wallet new", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-wallet-new-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses without --yes", async () => {
    const dataDir = join(tmp, "acc-data");
    ensureDataDir(dataDir);
    await expect(newWallet({ dataDir })).rejects.toThrow(/--yes/);
  });

  it("generates a fresh wallet and updates config.json", async () => {
    const dataDir = join(tmp, "acc-data");
    const layout = ensureDataDir(dataDir);
    saveConfig(layout.configPath, SEED_CONFIG);
    const address = await newWallet({ dataDir, yes: true });
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const cfg = loadConfig(layout.configPath);
    expect(cfg?.wallet?.address).toBe(address);
    expect(cfg?.wallet?.encrypted).toBe(false);
  });

  it("backs up prior signer.key before overwriting", async () => {
    const dataDir = join(tmp, "acc-data");
    const layout = ensureDataDir(dataDir);
    saveConfig(layout.configPath, SEED_CONFIG);
    await newWallet({ dataDir, yes: true });
    const first = readFileSync(layout.signerKeyFile, "utf-8");
    await newWallet({ dataDir, yes: true });
    expect(existsSync(`${layout.signerKeyFile}.bak`)).toBe(true);
    expect(readFileSync(`${layout.signerKeyFile}.bak`, "utf-8")).toBe(first);
  });
});

describe("wallet import", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-wallet-import-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects malformed hex", async () => {
    const dataDir = join(tmp, "acc-data");
    ensureDataDir(dataDir);
    await expect(
      importWallet({ dataDir, privateKey: "0xnothex" }),
    ).rejects.toThrow(/invalid private key/);
  });

  it("imports a valid key and derives the same address", async () => {
    const dataDir = join(tmp, "acc-data");
    const layout = ensureDataDir(dataDir);
    saveConfig(layout.configPath, SEED_CONFIG);
    const pk = generatePrivateKey();
    const expected = privateKeyToAccount(pk).address;
    const address = await importWallet({ dataDir, privateKey: pk });
    expect(address).toBe(expected);
    expect(readFileSync(layout.signerKeyFile, "utf-8")).toBe(pk);
  });
});

describe("wallet show", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-wallet-show-"));
    capturedOutput = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        capturedOutput.push(String(chunk));
        return true;
      });
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("prints only the address, never the private key", async () => {
    const dataDir = join(tmp, "acc-data");
    const layout = ensureDataDir(dataDir);
    saveConfig(layout.configPath, SEED_CONFIG);
    const pk = generatePrivateKey();
    await importWallet({ dataDir, privateKey: pk });
    capturedOutput.length = 0;
    const address = await showWallet({ dataDir });
    const full = capturedOutput.join("");
    expect(full).toContain(address);
    expect(full).not.toContain(pk);
    expect(full).not.toContain(pk.slice(2));
  });

  it("throws when no signer exists", async () => {
    const dataDir = join(tmp, "acc-data");
    ensureDataDir(dataDir);
    await expect(showWallet({ dataDir })).rejects.toThrow(/No signer.key/);
  });
});
