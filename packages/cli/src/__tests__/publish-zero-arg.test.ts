import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { buildSkillMd } from "@acc/skill-spec";
import { ensureDataDir } from "../shared/data-dir.js";
import { saveConfig, type AccConfig } from "../shared/config-store.js";
import { importWallet } from "../commands/wallet/import.js";
import { runPublish } from "../commands/publish.js";

const SEED_CONFIG: AccConfig = {
  dataVersion: 1,
  registry: "https://api.siliconretail.com",
  chainId: 1,
  selfUrl: "https://acc.example.com",
  skillMdPath: "", // set per test below
};

function writeSkillFile(path: string): void {
  const md = buildSkillMd(
    {
      name: "Test Store",
      description: "Testing zero-arg publish",
      skill_id: "test-store-v1",
      categories: ["digital"],
      supported_platforms: ["custom"],
      supported_payments: ["stripe"],
      health_url: "https://store.example.com/health",
      tags: [],
      website_url: "https://store.example.com",
    },
    "# Test Store\n\nbody\n",
  );
  writeFileSync(path, md, "utf-8");
}

describe("publish zero-arg mode", () => {
  let tmp: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const cwd = process.cwd();

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-pub-"));
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, data: {} }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    // Run the CLI from inside tmp so default ./acc-data resolves correctly
    process.chdir(tmp);
  });
  afterEach(() => {
    process.chdir(cwd);
    stdoutSpy.mockRestore();
    vi.unstubAllGlobals();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reads config.json + signer.key + skill path to POST submission", async () => {
    const layout = ensureDataDir(join(tmp, "acc-data"));
    writeSkillFile(layout.skillMd);
    saveConfig(layout.configPath, {
      ...SEED_CONFIG,
      skillMdPath: layout.skillMd,
    });
    const pk = generatePrivateKey();
    await importWallet({ dataDir: layout.root, privateKey: pk });

    await runPublish([]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchSpy.mock.calls[0]!;
    expect(endpoint).toBe("https://api.siliconretail.com/v1/submissions");
    const body = JSON.parse(String(init.body)) as {
      payload: { skill_url: string; skill_id: string };
      signature: string;
    };
    expect(body.payload.skill_url).toBe(
      "https://acc.example.com/.well-known/acc-skill.md",
    );
    expect(body.payload.skill_id).toBe("test-store-v1");
    expect(body.signature).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  it("errors out if config.json is missing and no flags provided", async () => {
    await expect(runPublish([])).rejects.toThrow(/acc init/);
  });

  it("errors out with an actionable message if skill.md is missing", async () => {
    const layout = ensureDataDir(join(tmp, "acc-data"));
    // Config + signer exist, but no skill.md at skillMdPath.
    saveConfig(layout.configPath, {
      ...SEED_CONFIG,
      skillMdPath: layout.skillMd,
    });
    const pk = generatePrivateKey();
    await importWallet({ dataDir: layout.root, privateKey: pk });

    await expect(runPublish([])).rejects.toThrow(
      /skill file not found.*acc init shopify/s,
    );
    // No network call should have been made — publish must abort before
    // submitting anything when the file is missing.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
