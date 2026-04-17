// ---------------------------------------------------------------------------
// Resolve + create the `acc-data/` layout described in
// docs/plans/2026-04-16-phase-8-cli-wizard-structure.md §C.
//
// Pure resolution (`resolveDataDir`) is separated from the disk-touching
// `ensureDataDir` so callers that only need path derivation (tests, dry-runs,
// help output) never create files.
// ---------------------------------------------------------------------------

import { mkdirSync, chmodSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

export interface DataDirLayout {
  readonly root: string;
  readonly keys: string;
  readonly skill: string;
  readonly db: string;
  readonly configPath: string;
  readonly envPath: string;
  readonly dbFile: string;
  readonly skillMd: string;
  readonly encKeyFile: string;
  readonly signerKeyFile: string;
  /** True iff a `config.json` already exists at the expected path. */
  readonly alreadyInitialised: boolean;
}

export function resolveDataDir(input: string): DataDirLayout {
  const root = resolve(input);
  const configPath = join(root, "config.json");
  return {
    root,
    keys: join(root, "keys"),
    skill: join(root, "skill"),
    db: join(root, "db"),
    configPath,
    envPath: join(root, ".env"),
    dbFile: join(root, "db", "acc.sqlite"),
    skillMd: join(root, "skill", "acc-skill.md"),
    encKeyFile: join(root, "keys", "enc.key"),
    signerKeyFile: join(root, "keys", "signer.key"),
    alreadyInitialised: existsSync(configPath),
  };
}

export function ensureDataDir(input: string): DataDirLayout {
  const layout = resolveDataDir(input);

  mkdirSync(layout.root, { recursive: true, mode: 0o700 });
  mkdirSync(layout.keys, { recursive: true, mode: 0o700 });
  mkdirSync(layout.skill, { recursive: true, mode: 0o700 });
  mkdirSync(layout.db, { recursive: true, mode: 0o700 });

  // Re-run may encounter looser perms from a prior manual mkdir; tighten.
  for (const dir of [layout.keys, layout.skill, layout.db]) {
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      chmodSync(dir, 0o700);
    }
  }

  return { ...layout, alreadyInitialised: existsSync(layout.configPath) };
}
