// ---------------------------------------------------------------------------
// Minimal ANSI colour helpers for the CLI. No external dependency —
// `chalk` et al. would more than double the Bun-compiled binary size and
// we only need a handful of codes.
//
// Colours are suppressed automatically when:
//   - stdout is not a TTY (piped to a file or another command),
//   - NO_COLOR is set to anything non-empty (de-facto standard,
//     https://no-color.org/),
//   - TERM=dumb (rare, but some CI lines still report that).
//   - ACC_NO_COLOR=1 (project-specific override used by tests).
//
// Codes used are 3/4-bit ANSI so they render on basically every terminal
// back to VT100. We avoid 24-bit truecolour on purpose — Terminal.app's
// default profile and tmux without -2 fall back weirdly.
// ---------------------------------------------------------------------------

function colourEnabled(): boolean {
  if (process.env.ACC_NO_COLOR === "1") return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.env.TERM === "dumb") return false;
  return process.stdout.isTTY === true;
}

const ENABLED = colourEnabled();

function wrap(code: string, close: string): (s: string) => string {
  if (!ENABLED) return (s) => s;
  return (s) => `\x1b[${code}m${s}\x1b[${close}m`;
}

// 3/4-bit palette. Close sequence `0` resets all attributes — fine for
// small one-off snippets where we don't nest styles.
export const bold = wrap("1", "0");
export const dim = wrap("2", "0");
export const cyan = wrap("36", "0");
export const brightCyan = wrap("96", "0");
export const brightBlue = wrap("94", "0");
export const green = wrap("32", "0");
export const yellow = wrap("33", "0");
export const red = wrap("31", "0");

/** Exposed for tests so they don't have to re-derive the gate. */
export const __colourEnabledForTests = ENABLED;
