// ---------------------------------------------------------------------------
// Base configuration — platform- and payment-provider-agnostic settings.
//
// These are the infra-level knobs every instance needs regardless of which
// e-commerce backend or which payment protocol is in use.
// ---------------------------------------------------------------------------

import { resolve, sep } from "node:path";

export interface BaseConfig {
  /** DID-style merchant identifier surfaced to payment handlers and webhooks. */
  readonly merchantDid: string;

  /** HTTP port the portal (UCP + MCP + legacy) listens on. */
  readonly portalPort: number;

  /** Postgres connection string. Optional — in-memory store is used if absent. */
  readonly databaseUrl: string;

  /** Publicly reachable URL of this service, used to advertise UCP endpoints. */
  readonly selfUrl: string;

  /** Admin portal token for dashboard / reconciler callbacks. Optional. */
  readonly portalToken: string;

  /** Currency the store prices in (advertised via UCP discovery). */
  readonly paymentCurrency: string;

  /** Fiat→stablecoin fixed rate (MVP — dynamic pricing later). */
  readonly fixedRate: number;

  /** How long a quote's rate stays locked before requiring a refresh. */
  readonly rateLockMinutes: number;

  /** Store URL used by the active adapter (mirrored here for logging). */
  readonly storeUrl: string;

  /**
   * AES-256-GCM hex-encoded key (64 chars = 32 bytes) used to encrypt Shopify
   * admin/storefront tokens at rest. Required only in Shopify OAuth mode;
   * manual-token mode leaves this empty. Cross-validation lives in loadConfig.
   */
  readonly accEncryptionKey: string;

  /**
   * Filesystem path to the skill markdown file the connector self-hosts at
   * `/.well-known/acc-skill.md`. Defaults to `<ACC_DATA_DIR>/skill/acc-skill.md`,
   * matching the `acc init` wizard layout. If the file doesn't exist, the
   * route returns 404; nothing else cares.
   */
  readonly accSkillMdPath: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    console.error(`[Config] Invalid port "${raw}", using ${fallback}`);
    return fallback;
  }
  return n;
}

export function loadBaseConfig(
  env: Record<string, string | undefined>,
  storeUrl: string,
): BaseConfig {
  const dataDir = env.ACC_DATA_DIR ?? "./acc-data";
  const skillMdRaw = env.ACC_SKILL_MD_PATH ?? `${dataDir}/skill/acc-skill.md`;
  return {
    merchantDid: env.MERCHANT_DID ?? "did:example:unknown-merchant",
    portalPort: parsePort(env.PORTAL_PORT, 10000),
    databaseUrl: env.DATABASE_URL ?? "",
    selfUrl: env.SELF_URL || "http://commerce-agent:10000",
    portalToken: env.PORTAL_TOKEN ?? "",
    paymentCurrency: env.PAYMENT_CURRENCY ?? "XSGD",
    fixedRate: parseFloat(env.CHECKOUT_FIXED_RATE ?? "1.00"),
    rateLockMinutes: parseInt(env.CHECKOUT_RATE_LOCK_MINUTES ?? "5", 10),
    storeUrl,
    accEncryptionKey: env.ACC_ENCRYPTION_KEY ?? "",
    accSkillMdPath: resolveSkillMdPath(skillMdRaw, dataDir),
  };
}

/**
 * Resolve and constrain `ACC_SKILL_MD_PATH` to live inside `ACC_DATA_DIR`.
 *
 * The connector serves whatever path the config points at via the
 * `/.well-known/acc-skill.md` route. Without this guard, a mis-set env var
 * (e.g. from a leaked deployment template) could make that public endpoint
 * serve `/etc/passwd` or any other file the process can read — a path-
 * traversal sink reachable without auth. We therefore refuse to load a
 * config whose skill path escapes the data directory.
 *
 * Containment check uses a trailing `sep` so that a sibling directory whose
 * name starts with the data-dir basename (e.g. `/data-evil` vs `/data`)
 * can't pass a naive `startsWith`.
 */
function resolveSkillMdPath(rawPath: string, dataDir: string): string {
  const resolvedPath = resolve(rawPath);
  const resolvedDir = resolve(dataDir);
  const dirWithSep = resolvedDir.endsWith(sep)
    ? resolvedDir
    : resolvedDir + sep;
  if (!resolvedPath.startsWith(dirWithSep) && resolvedPath !== resolvedDir) {
    throw new Error(
      `ACC_SKILL_MD_PATH (${rawPath}) must resolve under ACC_DATA_DIR (${dataDir}).`,
    );
  }
  return resolvedPath;
}
