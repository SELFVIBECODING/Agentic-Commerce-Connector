import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertEnv, readEnv } from "../shared/env-writer.js";

describe("upsertEnv", () => {
  let tmp: string;
  let envPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-env-"));
    envPath = join(tmp, ".env");
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the file with 0600 perms when missing", () => {
    upsertEnv(envPath, { SELF_URL: "https://example.com" });
    expect(existsSync(envPath)).toBe(true);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    const parsed = readEnv(envPath);
    expect(parsed.SELF_URL).toBe("https://example.com");
  });

  it("preserves comments, blank lines, and unknown keys", () => {
    writeFileSync(
      envPath,
      [
        "# top-level comment",
        "",
        "UNRELATED_VAR=keep-me",
        "SELF_URL=https://old.example.com  # inline comment",
      ].join("\n"),
      "utf-8",
    );
    upsertEnv(envPath, { SELF_URL: "https://new.example.com" });
    const body = readFileSync(envPath, "utf-8");
    expect(body).toContain("# top-level comment");
    expect(body).toContain("UNRELATED_VAR=keep-me");
    expect(body).toContain("SELF_URL=https://new.example.com");
    expect(body).not.toContain("https://old.example.com");
  });

  it("appends new keys at the end", () => {
    writeFileSync(envPath, "EXISTING=value\n", "utf-8");
    upsertEnv(envPath, { ACC_ENCRYPTION_KEY: "deadbeef" });
    const body = readFileSync(envPath, "utf-8");
    expect(body).toMatch(/EXISTING=value\s+ACC_ENCRYPTION_KEY=deadbeef/s);
  });

  it("is idempotent on repeated upsert of same values", () => {
    upsertEnv(envPath, { SELF_URL: "https://example.com" });
    const first = readFileSync(envPath, "utf-8");
    upsertEnv(envPath, { SELF_URL: "https://example.com" });
    const second = readFileSync(envPath, "utf-8");
    expect(first).toBe(second);
  });

  it("quotes values containing whitespace or #", () => {
    upsertEnv(envPath, { NOTE: "hello world", HASH: "a#b" });
    const body = readFileSync(envPath, "utf-8");
    expect(body).toContain('NOTE="hello world"');
    expect(body).toContain('HASH="a#b"');
  });
});

describe("readEnv", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "acc-env-r-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty object on missing file", () => {
    expect(readEnv(join(tmp, "missing"))).toEqual({});
  });

  it("unquotes double-quoted values", () => {
    const p = join(tmp, ".env");
    writeFileSync(p, 'A="hello world"\nB=plain\n', "utf-8");
    expect(readEnv(p)).toEqual({ A: "hello world", B: "plain" });
  });
});
