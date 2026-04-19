// ---------------------------------------------------------------------------
// Relay-signed GDPR webhook verification — Phase 2 / Stream A / M5.
//
// When the connector is installed via a Silicon Retail-style relay (instead
// of the merchant's own Partners app), Shopify delivers GDPR webhooks to
// the relay, which then forwards them to this connector. The relay re-signs
// the body with a per-shop HMAC key the merchant received at install time
// (`ACC_RELAY_SECRET` in .env — see docs/spec/relayer-protocol.md §6).
//
// Wire format:
//   X-ACC-Relay-Signature: sha256=<base64(HMAC-SHA256(ACC_RELAY_SECRET, rawBody))>
//   X-ACC-Relay-Timestamp: <unix-ms>
//
// Verification rules:
//   1. Timestamp must be within ±5 min of local clock (replay protection).
//   2. Signature must match HMAC over the raw body bytes (pre-JSON-parse).
//   3. Comparison is timing-safe (crypto.timingSafeEqual).
//
// This verifier runs IN ADDITION to the existing Shopify-direct HMAC on
// the same endpoint (see webhook-handler.ts). A merchant with a classic
// Partners install never sets ACC_RELAY_SECRET; a relay-hosted merchant's
// webhook-handler falls through to this path when X-ACC-Relay-Signature
// is present and ACC_RELAY_SECRET is configured.
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "node:crypto";

/** ±5 minutes of drift between the relay and this process is acceptable. */
export const MAX_RELAY_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

const BASE64 = /^[A-Za-z0-9+/=]+$/;

export interface RelayHmacVerificationInput {
  readonly rawBody: string | Buffer;
  readonly signatureHeader: string | undefined;
  readonly timestampHeader: string | undefined;
  readonly relaySecret: string;
  /** Injectable clock for tests; defaults to Date.now. */
  readonly now?: () => number;
}

export interface RelayHmacVerificationResult {
  readonly ok: boolean;
  /** Present when ok === false; one of a handful of discriminator strings. */
  readonly reason?:
    | "missing_headers"
    | "missing_secret"
    | "bad_timestamp"
    | "timestamp_skew"
    | "malformed_signature"
    | "signature_mismatch";
}

/**
 * Returns ok:true iff both the timestamp freshness check AND the HMAC
 * comparison pass. Callers treat every ok:false path identically (fall
 * through to the Shopify-direct verifier, then 401 if that also fails);
 * `reason` is exposed for logging, not for user-facing distinction.
 */
export function verifyRelayWebhook(
  input: RelayHmacVerificationInput,
): RelayHmacVerificationResult {
  if (!input.signatureHeader || !input.timestampHeader) {
    return { ok: false, reason: "missing_headers" };
  }
  if (!input.relaySecret) {
    return { ok: false, reason: "missing_secret" };
  }

  const tsNum = Number.parseInt(input.timestampHeader, 10);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const nowMs = (input.now ?? Date.now)();
  if (Math.abs(nowMs - tsNum) > MAX_RELAY_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "timestamp_skew" };
  }

  // Header format is "sha256=<base64>". Accept a bare base64 too — a minor
  // convenience; the relay always prefixes, but forgiving tolerates an
  // ecosystem operator who ships a conformant but prefix-less signature.
  const headerValue = input.signatureHeader.trim();
  const b64 = headerValue.startsWith("sha256=")
    ? headerValue.slice("sha256=".length)
    : headerValue;
  if (!b64 || !BASE64.test(b64)) {
    return { ok: false, reason: "malformed_signature" };
  }

  const bodyBuf =
    typeof input.rawBody === "string"
      ? Buffer.from(input.rawBody, "utf8")
      : input.rawBody;
  const expected = createHmac("sha256", input.relaySecret)
    .update(bodyBuf)
    .digest();
  const provided = Buffer.from(b64, "base64");
  if (provided.length !== expected.length) {
    return { ok: false, reason: "signature_mismatch" };
  }
  if (!timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
}
