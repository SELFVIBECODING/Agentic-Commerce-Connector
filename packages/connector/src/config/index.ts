// ---------------------------------------------------------------------------
// Top-level configuration — composes base + commerce + payment.
//
// Consumers still see a single flat `Config` type so downstream services keep
// their import sites unchanged. Internally the loader delegates to scoped
// modules that own their own env-var surfaces and provenance documentation.
// ---------------------------------------------------------------------------

import { loadBaseConfig, type BaseConfig } from "./base.js";
import {
  loadCommerceEnv,
  type CommerceEnv,
  type PlatformType,
} from "./commerce.js";
import {
  loadPaymentEnv,
  type NexusPaymentEnv,
  type NonePaymentEnv,
  type PaymentProviderType,
} from "./payment.js";

// Re-export scoped types for code that wants to narrow
export type { BaseConfig } from "./base.js";
export type {
  PlatformType,
  CommerceEnv,
  ShopifyEnv,
  ShopifyManualEnv,
  ShopifyOAuthEnv,
  WooCommerceEnv,
} from "./commerce.js";
export type {
  PaymentProviderType,
  NexusPaymentEnv,
  NonePaymentEnv,
} from "./payment.js";

// ---------------------------------------------------------------------------
// Combined shape (back-compat with the old flat Config)
//
// NexusPaymentEnv and NonePaymentEnv share field shape (only `provider`
// differs), so the flat intersection below surfaces the same keys either
// way. Consumers that reach past `provider` into `nexusCoreUrl` /
// `signerPrivateKey` / etc. read empty strings when payment is "none" —
// any attempt to actually use them (fetch, sign) fails at the network
// layer, which is the correct "payment unavailable" behaviour.
// ---------------------------------------------------------------------------

type PaymentCombined = NexusPaymentEnv | NonePaymentEnv;

type ShopifyCombined = BaseConfig &
  Extract<CommerceEnv, { platform: "shopify" }> &
  PaymentCombined;

type WooCommerceCombined = BaseConfig &
  Extract<CommerceEnv, { platform: "woocommerce" }> &
  PaymentCombined;

export type ShopifyConfig = ShopifyCombined;
export type WooCommerceConfig = WooCommerceCombined;
export type Config = ShopifyConfig | WooCommerceConfig;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

function assertOAuthEncryptionKey(key: string): void {
  if (!key) {
    throw new Error(
      "[Config] ACC_ENCRYPTION_KEY is required when SHOPIFY_CLIENT_ID is set (OAuth mode). Generate one with: openssl rand -hex 32",
    );
  }
  if (!HEX_32_BYTES.test(key)) {
    throw new Error(
      "[Config] ACC_ENCRYPTION_KEY must be 64 lowercase/uppercase hex chars (32 bytes). Generate one with: openssl rand -hex 32",
    );
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const commerce = loadCommerceEnv(env);
  const payment = loadPaymentEnv(env);
  const base = loadBaseConfig(env, commerce.storeUrl);

  // Cross-validation — OAuth mode requires a vetted encryption key. The check
  // lives here (not in the commerce loader) because the key is a base-level
  // concern shared by anything that persists credentials at rest.
  if (commerce.platform === "shopify" && commerce.mode === "oauth") {
    assertOAuthEncryptionKey(base.accEncryptionKey);
  }

  // Flatten into the legacy shape. The payment env always shares the same
  // field set (see payment.ts — NonePaymentEnv mirrors NexusPaymentEnv
  // with empty strings), so the spread is uniform regardless of provider.
  // Consumers that branch on `provider === "nexus"` still get narrowing;
  // consumers that read payment fields directly silently get empty values
  // when no provider is configured.
  return { ...base, ...commerce, ...payment } as Config;
}
