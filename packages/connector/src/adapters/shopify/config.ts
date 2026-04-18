// ---------------------------------------------------------------------------
// Shopify-specific platform configuration
// ---------------------------------------------------------------------------

/**
 * Default per-request timeout applied to Shopify Storefront / Admin API
 * calls. Shopify's own p99 for authenticated Admin queries is well under
 * 10 s, so 15 s leaves headroom for the occasional slow CDN edge while
 * ensuring a broken upstream doesn't hang the checkout path indefinitely.
 * The WooCommerce adapter uses the same pattern.
 */
export const DEFAULT_SHOPIFY_REQUEST_TIMEOUT_MS = 15_000;

export interface ShopifyPlatformConfig {
  readonly storeUrl: string;
  readonly storefrontToken: string;
  readonly adminToken: string;
  readonly apiVersion: string;
  /**
   * Per-request timeout in milliseconds for Shopify fetches. Exposed so
   * tests can shrink it and operators can extend it via
   * `SHOPIFY_REQUEST_TIMEOUT_MS`.
   */
  readonly requestTimeoutMs: number;
}

export function validateShopifyConfig(
  env: Record<string, string | undefined>,
): ShopifyPlatformConfig {
  const storeUrl = env.SHOPIFY_STORE_URL;
  if (!storeUrl) {
    throw new Error("[ShopifyConfig] SHOPIFY_STORE_URL is required");
  }

  const storefrontToken = env.SHOPIFY_STOREFRONT_TOKEN;
  if (!storefrontToken) {
    throw new Error("[ShopifyConfig] SHOPIFY_STOREFRONT_TOKEN is required");
  }

  return {
    storeUrl,
    storefrontToken,
    adminToken: env.SHOPIFY_ADMIN_TOKEN ?? "",
    apiVersion: env.SHOPIFY_API_VERSION ?? "2025-07",
    requestTimeoutMs: parseTimeout(
      env.SHOPIFY_REQUEST_TIMEOUT_MS,
      DEFAULT_SHOPIFY_REQUEST_TIMEOUT_MS,
    ),
  };
}

function parseTimeout(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}
