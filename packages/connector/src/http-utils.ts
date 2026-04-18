// ---------------------------------------------------------------------------
// Shared HTTP helpers.
//
// `readBody` replaces four prior copies scattered across portal.ts,
// ucp/routes.ts, adapters/shopify/oauth/routes.ts and webhook-handler.ts.
// Every caller now enforces an explicit byte cap so a gigabyte POST can't
// exhaust the Node heap — closing a DoS surface flagged in the security
// audit. Callers pass the max they want to accept; there is no default so
// the cap is always an informed choice at the call site.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_JSON_API = 512 * 1024; // 512 KiB — UCP / REST / admin
export const MAX_BODY_WEBHOOK = 5 * 1024 * 1024; // 5 MiB — webhook payloads

export class BodyTooLargeError extends Error {
  readonly status = 413 as const;
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Security headers — applied on every response from the connector. Notes:
//  - X-Frame-Options: DENY   → defence-in-depth against clickjacking of
//    the admin dashboard when operators front the connector without a
//    reverse proxy that adds its own CSP/frame-ancestors.
//  - X-Content-Type-Options: nosniff → prevents MIME-sniffing on served
//    skill.md bytes and admin HTML.
//  - Referrer-Policy: no-referrer → the admin surface accepts `?token=`
//    today (Phase 6 convenience). no-referrer keeps that token out of
//    third-party Referer headers if the admin page ever links off-site.
// HSTS is intentionally omitted — TLS termination is the reverse proxy's
// job; setting HSTS here risks locking operators into broken certs during
// local development.
// ---------------------------------------------------------------------------

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}
