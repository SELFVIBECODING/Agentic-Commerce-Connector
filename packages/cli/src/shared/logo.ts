// ---------------------------------------------------------------------------
// ACC terminal logo. Printed once at the top of the wizard so the CLI has
// a recognisable identity next to tools like `hermes`, `openclaw`, etc.
//
// Block-letter glyphs (U+2588 FULL BLOCK + U+255x box-drawing) render on
// every Unicode-capable terminal back to xterm-256; plain ASCII fallback
// is skipped — if the user's terminal can't render UTF-8 the rest of the
// wizard is unreadable anyway (prompt boxes, spinner, QR code).
// ---------------------------------------------------------------------------

import { brightCyan, dim } from "./ansi.js";

const LOGO_LINES = [
  "   █████╗   ██████╗ ██████╗",
  "  ██╔══██╗ ██╔════╝██╔════╝",
  "  ███████║ ██║     ██║     ",
  "  ██╔══██║ ██║     ██║     ",
  "  ██║  ██║ ╚██████╗╚██████╗",
  "  ╚═╝  ╚═╝  ╚═════╝ ╚═════╝",
] as const;

/**
 * Render the ACC logo + tagline. Returns a string so callers can choose
 * how to emit it (stdout, log, test assertion). Includes leading +
 * trailing blank lines so it slots into the wizard flow without extra
 * whitespace bookkeeping at call sites.
 */
export function renderLogo(tagline?: string): string {
  const body = LOGO_LINES.map((line) => brightCyan(line)).join("\n");
  const subtitle = dim(
    `  Agentic Commerce Connector${tagline ? `  ${tagline}` : ""}`,
  );
  return `\n${body}\n${subtitle}\n\n`;
}

/** Convenience: write the logo straight to stdout. */
export function printLogo(tagline?: string): void {
  process.stdout.write(renderLogo(tagline));
}
