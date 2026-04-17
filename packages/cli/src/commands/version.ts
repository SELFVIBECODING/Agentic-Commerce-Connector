import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // build layout: build/commands/version.js → ../../package.json
  const pkgPath = resolve(here, "..", "..", "package.json");
  const raw = readFileSync(pkgPath, "utf-8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export async function runVersion(): Promise<void> {
  process.stdout.write(`acc ${getVersion()}\n`);
}
