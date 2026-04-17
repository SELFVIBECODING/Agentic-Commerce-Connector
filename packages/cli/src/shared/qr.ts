// ---------------------------------------------------------------------------
// Thin wrapper around `qrcode-terminal` that returns the rendered ASCII
// instead of writing directly to stdout. Tests + headless SSH scenarios need
// the string form (to log, to render into a web page, or to hand off to a
// clipboard helper).
// ---------------------------------------------------------------------------

import qrcode from "qrcode-terminal";

export interface RenderQrOptions {
  readonly small?: boolean;
}

export function renderQr(input: string, opts: RenderQrOptions = {}): string {
  let captured = "";
  qrcode.generate(input, { small: opts.small ?? false }, (output) => {
    captured = output;
  });
  return captured;
}

export function printQr(input: string, opts: RenderQrOptions = {}): void {
  const text = renderQr(input, opts);
  process.stdout.write(`${text}\n`);
}
