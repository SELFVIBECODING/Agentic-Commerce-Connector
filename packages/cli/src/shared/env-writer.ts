// ---------------------------------------------------------------------------
// Idempotent `.env` upsert.
//
// Line-oriented parse so we can preserve comments, blank lines, and unrelated
// keys byte-for-byte. Values containing whitespace or `#` are quoted on write
// and unquoted on read. We deliberately do not support multi-line values or
// shell expansion — this is a config file, not a bash script.
// ---------------------------------------------------------------------------

import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";

export type EnvMap = Readonly<Record<string, string>>;

export function readEnv(path: string): EnvMap {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const parsed = parseLine(line);
    if (parsed) out[parsed.key] = parsed.value;
  }
  return out;
}

export function upsertEnv(path: string, updates: EnvMap): void {
  const existingLines = existsSync(path)
    ? readFileSync(path, "utf-8").split("\n")
    : [];

  const seen = new Set<string>();
  const nextLines = existingLines.map((line) => {
    const parsed = parseLine(line);
    if (!parsed) return line;
    if (parsed.key in updates) {
      seen.add(parsed.key);
      const nextValue = updates[parsed.key]!;
      return `${parsed.key}=${serialiseValue(nextValue)}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${serialiseValue(value)}`);
  }

  // normalise trailing newline handling
  let body = nextLines.join("\n");
  if (!body.endsWith("\n")) body = body + "\n";

  writeFileSync(path, body, { mode: 0o600, encoding: "utf-8" });
  chmodSync(path, 0o600);
}

/* -------------------------------------------------------------------------- */
/*  Internals                                                                  */
/* -------------------------------------------------------------------------- */

interface ParsedLine {
  readonly key: string;
  readonly value: string;
}

function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  const rawValue = trimmed.slice(eq + 1);
  const value = deserialiseValue(rawValue);
  return { key, value };
}

function serialiseValue(value: string): string {
  if (value === "") return '""';
  // Quote if value contains whitespace, #, or quote itself. Keeps
  // parse-roundtrip simple and avoids shell-escape pitfalls.
  if (/[\s#"']/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

function deserialiseValue(raw: string): string {
  // Strip optional trailing inline comment when value is unquoted.
  if (raw.startsWith('"')) {
    const closing = findClosingQuote(raw);
    if (closing < 0) return raw;
    const inner = raw.slice(1, closing);
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  const hashIdx = raw.indexOf("#");
  const untrimmed = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  return untrimmed.trim();
}

function findClosingQuote(raw: string): number {
  let escaped = false;
  for (let i = 1; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return i;
  }
  return -1;
}
