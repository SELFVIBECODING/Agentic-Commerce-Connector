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

export interface Prompter {
  ask(question: string, opts?: AskOptions): Promise<string>;
  askYesNo(question: string, opts?: YesNoOptions): Promise<boolean>;
  askChoice(question: string, choices: readonly Choice[]): Promise<string>;
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
