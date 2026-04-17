// ---------------------------------------------------------------------------
// Zod-validated load / save of `acc-data/config.json`.
//
// Atomic write: serialise to `<path>.tmp` then rename. Guarantees that a
// reader never observes a torn JSON document even if the process is killed
// mid-write.
// ---------------------------------------------------------------------------

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { z } from "zod";

const SUPPORTED_DATA_VERSIONS = [1] as const;

const WalletSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid 0x address"),
  encrypted: z.boolean(),
});

const ConfigSchema = z.object({
  dataVersion: z
    .number()
    .int()
    .refine(
      (v) => SUPPORTED_DATA_VERSIONS.includes(v as 1),
      (v) => ({
        message: `unsupported dataVersion: ${v} (expected one of ${SUPPORTED_DATA_VERSIONS.join(", ")})`,
      }),
    ),
  registry: z.string().url(),
  chainId: z.number().int().positive(),
  selfUrl: z.string().url(),
  skillMdPath: z.string().min(1),
  wallet: WalletSchema.optional(),
});

export type AccConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(path: string): AccConfig | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

export function saveConfig(path: string, config: AccConfig): void {
  const validated = ConfigSchema.parse(config);
  const tmpPath = `${path}.tmp`;
  const body = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    writeFileSync(tmpPath, body, { mode: 0o600, encoding: "utf-8" });
    renameSync(tmpPath, path);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore cleanup failure */
      }
    }
    throw err;
  }
}

export function backupConfig(path: string): string | null {
  if (!existsSync(path)) return null;
  const backup = `${path}.bak`;
  const contents = readFileSync(path, "utf-8");
  writeFileSync(backup, contents, { mode: 0o600, encoding: "utf-8" });
  return backup;
}
