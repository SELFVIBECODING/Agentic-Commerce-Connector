// ---------------------------------------------------------------------------
// readline-backed interactive prompts.
//
// A thin functional layer over `node:readline` that exposes ask / askYesNo /
// askChoice / askSecret. The underlying IO is injectable (`PromptIO`) so tests
// can stub stdin without spawning a subprocess.
//
// For `askSecret`, we flip the terminal into raw mode and manually consume
// bytes so that the password never appears on the user's screen. If the
// stream is non-TTY (e.g. piped stdin in CI) we fall back to a plain readline
// read — printing a warning that the secret will echo.
// ---------------------------------------------------------------------------

import * as readline from "node:readline";

export interface PromptIO {
  ask(question: string): Promise<string | null>;
  askSecret(question: string): Promise<string | null>;
  error?(message: string): void;
  close(): void;
}

export interface AskOptions {
  readonly default?: string;
  /** Return null to accept, or a string error message to reject and re-ask. */
  readonly validate?: (value: string) => string | null;
}

export interface YesNoOptions {
  readonly default?: boolean;
}

export interface Choice {
  readonly key: string;
  readonly label: string;
}

export interface MultiChoiceOptions {
  /** Require at least this many selections before Enter submits. Default 1. */
  readonly min?: number;
}

export interface Prompter {
  ask(question: string, opts?: AskOptions): Promise<string>;
  askYesNo(question: string, opts?: YesNoOptions): Promise<boolean>;
  /**
   * Single-select menu. On a TTY both stdin and stdout run in raw mode so
   * the user navigates with ↑/↓/j/k and confirms with Enter. When either
   * side is not a TTY (CI, pipes, some SSH chains), falls back to
   * letter-key input via PromptIO.ask — the key letters shown on each
   * row are typed literally then Enter. Behaviourally identical in the
   * fallback path to the pre-arrow-key wizard, which is what existing
   * tests exercise through mockIO.
   */
  askChoice(question: string, choices: readonly Choice[]): Promise<string>;
  /**
   * Multi-select menu. TTY mode: ↑/↓ navigate, Space toggles the row
   * under the cursor, Enter submits (requires `opts.min` selections,
   * default 1). Non-TTY fallback: prompts for comma-separated letters
   * (e.g. "a,c,h") — same input shape the non-TTY wizard used before
   * arrow-keys arrived.
   */
  askMultiChoice(
    question: string,
    choices: readonly Choice[],
    opts?: MultiChoiceOptions,
  ): Promise<readonly string[]>;
  askSecret(question: string): Promise<string>;
  close(): void;
}

export function createPrompter(io: PromptIO): Prompter {
  return {
    async ask(question, opts = {}) {
      while (true) {
        const raw = await io.ask(decorate(question, opts));
        const value = raw === null || raw === "" ? (opts.default ?? "") : raw;
        const err = opts.validate?.(value) ?? null;
        if (err === null) return value;
        (io.error ?? ((m: string) => process.stderr.write(`${m}\n`)))(
          `  ↳ ${err}`,
        );
      }
    },

    async askYesNo(question, opts = {}) {
      const def = opts.default;
      const suffix = def === true ? "[Y/n]" : def === false ? "[y/N]" : "[y/n]";
      while (true) {
        const raw = await io.ask(`${question} ${suffix} `);
        const value = (raw ?? "").trim().toLowerCase();
        if (value === "" && def !== undefined) return def;
        if (value === "y" || value === "yes") return true;
        if (value === "n" || value === "no") return false;
      }
    },

    async askChoice(question, choices) {
      if (isInteractiveTty()) {
        return interactiveSingleSelect(question, choices);
      }
      // Non-TTY fallback — literal letter-key input, same shape the tests
      // inject via mockIO queues.
      const rendered =
        `${question}\n` +
        choices.map((c) => `  (${c.key}) ${c.label}`).join("\n") +
        "\n> ";
      while (true) {
        const raw = await io.ask(rendered);
        const value = (raw ?? "").trim().toLowerCase();
        const match = choices.find((c) => c.key.toLowerCase() === value);
        if (match) return match.key;
      }
    },

    async askMultiChoice(question, choices, opts = {}) {
      const min = opts.min ?? 1;
      if (isInteractiveTty()) {
        return interactiveMultiSelect(question, choices, min);
      }
      // Non-TTY fallback — comma-separated letters, same shape step9
      // accepted before arrow-keys. Validate client-side; re-ask until OK.
      const rendered =
        `${question}\n` +
        choices.map((c) => `  (${c.key}) ${c.label}`).join("\n") +
        `\n  (comma-separated, e.g. "a,c")\n> `;
      while (true) {
        const raw = await io.ask(rendered);
        const letters = (raw ?? "")
          .split(/[,\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0);
        if (letters.length < min) continue;
        const valid = letters.every((l) =>
          choices.some((c) => c.key.toLowerCase() === l),
        );
        if (!valid) continue;
        // Preserve catalog order (not input order) so output is deterministic.
        return choices
          .filter((c) => letters.includes(c.key.toLowerCase()))
          .map((c) => c.key);
      }
    },

    async askSecret(question) {
      const raw = await io.askSecret(question);
      return raw ?? "";
    },

    close() {
      io.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Default IO bound to node:readline + process.stdin                          */
/* -------------------------------------------------------------------------- */

export function defaultPromptIO(): PromptIO {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return {
    ask(q) {
      return new Promise((resolve) => {
        rl.question(q, (answer) => resolve(answer));
        rl.once("close", () => resolve(null));
      });
    },
    askSecret(q) {
      return new Promise((resolve) => {
        process.stdout.write(q);
        const stdin = process.stdin;
        if (!stdin.isTTY) {
          rl.once("line", (line) => resolve(line));
          return;
        }
        stdin.setRawMode(true);
        let buf = "";
        const onData = (chunk: Buffer): void => {
          for (const byte of chunk) {
            if (byte === 0x03) {
              // ctrl-c
              stdin.setRawMode(false);
              stdin.off("data", onData);
              process.stdout.write("\n");
              process.exit(130);
            }
            if (byte === 0x0a || byte === 0x0d) {
              stdin.setRawMode(false);
              stdin.off("data", onData);
              process.stdout.write("\n");
              resolve(buf);
              return;
            }
            if (byte === 0x7f || byte === 0x08) {
              if (buf.length > 0) buf = buf.slice(0, -1);
              continue;
            }
            buf += String.fromCharCode(byte);
          }
        };
        stdin.on("data", onData);
      });
    },
    close() {
      rl.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function decorate(question: string, opts: AskOptions): string {
  if (opts.default !== undefined && opts.default !== "") {
    return `${question} [${opts.default}] `;
  }
  return `${question} `;
}

/* -------------------------------------------------------------------------- */
/*  Interactive TTY selection (arrow keys + space)                             */
/* -------------------------------------------------------------------------- */

function isInteractiveTty(): boolean {
  // Both sides must be TTYs — stdin for raw-mode reading, stdout for
  // redrawing the menu. Most CI runners and `curl | bash` streams fail
  // at least one of these, which cleanly routes them to the letter-key
  // fallback.
  return (
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    // NO_COLOR alone doesn't imply non-TTY, but if the user explicitly
    // asked for plain mode respect it — some dumb terminals also report
    // isTTY=true but don't handle escape codes well.
    process.env.ACC_NO_INTERACTIVE !== "1"
  );
}

// ANSI sequences we emit. Kept as constants so the byte-level output is
// easy to grep when debugging weird terminal behaviour.
const ANSI_HIDE_CURSOR = "\x1b[?25l";
const ANSI_SHOW_CURSOR = "\x1b[?25h";
const ANSI_CLEAR_LINE = "\x1b[2K";
const ANSI_CURSOR_COL_0 = "\r";
function ansiMoveUp(n: number): string {
  return n > 0 ? `\x1b[${n}A` : "";
}

interface KeyPress {
  readonly name:
    | "up"
    | "down"
    | "space"
    | "enter"
    | "ctrl-c"
    | "q"
    | "escape"
    | "other";
}

/**
 * Byte-level key decoder. stdin delivers "chunks" that may contain one or
 * several logical key presses (fast typing) or a multi-byte escape
 * sequence split across chunks. We handle the common codes we care about
 * and route everything else to `other` — the caller just ignores unknown
 * keys rather than buffering partial sequences.
 */
function decodeKeys(chunk: Buffer): KeyPress[] {
  const keys: KeyPress[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const b = chunk[i]!;
    if (b === 0x03) {
      keys.push({ name: "ctrl-c" });
      continue;
    }
    if (b === 0x0d || b === 0x0a) {
      keys.push({ name: "enter" });
      continue;
    }
    if (b === 0x20) {
      keys.push({ name: "space" });
      continue;
    }
    if (b === 0x71) {
      keys.push({ name: "q" });
      continue;
    }
    if (b === 0x6b) {
      // vim-style: k = up
      keys.push({ name: "up" });
      continue;
    }
    if (b === 0x6a) {
      // vim-style: j = down
      keys.push({ name: "down" });
      continue;
    }
    if (b === 0x1b) {
      // Escape sequence. Most terminals send ESC [ A/B/C/D for arrows.
      // We peek two bytes ahead; if they're not the classic arrow keys,
      // treat the whole thing as a bare Escape press.
      if (chunk[i + 1] === 0x5b) {
        const arrow = chunk[i + 2];
        if (arrow === 0x41) {
          keys.push({ name: "up" });
          i += 2;
          continue;
        }
        if (arrow === 0x42) {
          keys.push({ name: "down" });
          i += 2;
          continue;
        }
        // Right/left arrows (C/D) not used here — fall through to other.
        keys.push({ name: "other" });
        i += 2;
        continue;
      }
      keys.push({ name: "escape" });
      continue;
    }
    keys.push({ name: "other" });
  }
  return keys;
}

async function interactiveSingleSelect(
  question: string,
  choices: readonly Choice[],
): Promise<string> {
  return interactiveSelectLoop(question, choices, {
    multi: false,
    min: 1,
  }).then((picked) => picked[0]!);
}

async function interactiveMultiSelect(
  question: string,
  choices: readonly Choice[],
  min: number,
): Promise<readonly string[]> {
  return interactiveSelectLoop(question, choices, { multi: true, min });
}

interface SelectLoopOpts {
  readonly multi: boolean;
  readonly min: number;
}

async function interactiveSelectLoop(
  question: string,
  choices: readonly Choice[],
  opts: SelectLoopOpts,
): Promise<string[]> {
  if (choices.length === 0) {
    throw new Error("[prompts] cannot present an empty choice list");
  }

  const stdin = process.stdin;
  const stdout = process.stdout;

  let cursor = 0;
  const selected = new Set<number>();
  let errorMsg: string | null = null;
  let linesWritten = 0;

  const hint = opts.multi
    ? "(↑/↓ to move, Space to toggle, Enter to submit, Ctrl+C to cancel)"
    : "(↑/↓ to move, Enter to select, Ctrl+C to cancel)";

  function render(): void {
    if (linesWritten > 0) {
      // Move back to the first line of the previous render, then clear
      // downward by overwriting each line. `ansiMoveUp` is 0-safe so the
      // first render draws at the current cursor position.
      stdout.write(ansiMoveUp(linesWritten));
    }
    const lines: string[] = [];
    lines.push(question);
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i]!;
      const cursorMark = i === cursor ? "❯" : " ";
      const selectMark = opts.multi ? (selected.has(i) ? "[x]" : "[ ]") : "";
      const row = [cursorMark, selectMark, c.label]
        .filter((s) => s.length > 0)
        .join(" ");
      lines.push(`  ${row}`);
    }
    if (errorMsg) lines.push(`  ${errorMsg}`);
    lines.push(`  ${hint}`);

    // Clear each pre-existing line we're about to overwrite, then
    // rewrite. Using CLEAR_LINE + \r before each write keeps leftover
    // glyphs from a longer previous render from bleeding through.
    for (let i = 0; i < Math.max(lines.length, linesWritten); i++) {
      stdout.write(ANSI_CURSOR_COL_0 + ANSI_CLEAR_LINE);
      const text = lines[i] ?? "";
      stdout.write(`${text}\n`);
    }
    linesWritten = lines.length;
  }

  return new Promise<string[]>((resolve, reject) => {
    let settled = false;

    function cleanup(): void {
      stdin.removeListener("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        /* some environments don't implement setRawMode */
      }
      stdin.pause();
      stdout.write(ANSI_SHOW_CURSOR);
    }

    function onData(chunk: Buffer): void {
      if (settled) return;
      for (const key of decodeKeys(chunk)) {
        if (key.name === "ctrl-c") {
          settled = true;
          cleanup();
          // Match the `askSecret` ctrl-c handler — print a newline so
          // the terminal prompt comes back on its own row, then exit
          // with the standard "killed by SIGINT" code.
          stdout.write("\n");
          process.exit(130);
          return;
        }
        if (key.name === "up") {
          cursor = (cursor - 1 + choices.length) % choices.length;
          errorMsg = null;
          render();
          continue;
        }
        if (key.name === "down") {
          cursor = (cursor + 1) % choices.length;
          errorMsg = null;
          render();
          continue;
        }
        if (key.name === "space" && opts.multi) {
          if (selected.has(cursor)) selected.delete(cursor);
          else selected.add(cursor);
          errorMsg = null;
          render();
          continue;
        }
        if (key.name === "enter") {
          if (opts.multi) {
            if (selected.size < opts.min) {
              errorMsg = `Pick at least ${opts.min} (currently ${selected.size}).`;
              render();
              continue;
            }
            const keys = [...selected]
              .sort((a, b) => a - b)
              .map((i) => choices[i]!.key);
            settled = true;
            cleanup();
            resolve(keys);
            return;
          }
          settled = true;
          cleanup();
          resolve([choices[cursor]!.key]);
          return;
        }
        // Any other key: ignore. We never reject on unknown input; the
        // user can keep typing until they hit a recognised key.
      }
    }

    try {
      stdin.setRawMode(true);
    } catch (err) {
      // Extremely rare — some test harnesses stub stdin without
      // setRawMode. Fall back to a rejected promise so the caller can
      // decide to handle it (tests route through non-TTY path anyway,
      // so this path shouldn't hit in practice).
      reject(err);
      return;
    }
    stdin.resume();
    stdin.on("data", onData);
    stdout.write(ANSI_HIDE_CURSOR);
    render();
  });
}
