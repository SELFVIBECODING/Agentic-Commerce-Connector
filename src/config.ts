// ---------------------------------------------------------------------------
// Platform-agnostic configuration with discriminated union
// ---------------------------------------------------------------------------

export type PlatformType = "shopify" | "woocommerce";

interface BaseConfig {
  readonly platform: PlatformType;

  // Agent identity
  readonly merchantDid: string;
  readonly portalPort: number;
  readonly databaseUrl: string;
  readonly webhookSecret: string;
  readonly paymentAddress: string;
  readonly signerPrivateKey: string;
  readonly nexusCoreUrl: string;
  readonly selfUrl: string;
  readonly portalToken: string;

  // Store URL (platform-agnostic)
  readonly storeUrl: string;

  // Checkout / rate / payment
  readonly checkoutBaseUrl: string;
  readonly paymentCurrency: string;
  readonly fixedRate: number;
  readonly rateLockMinutes: number;
}

export interface ShopifyConfig extends BaseConfig {
  readonly platform: "shopify";
  readonly shopifyStoreUrl: string;
  readonly shopifyStorefrontToken: string;
  readonly shopifyAdminToken: string;
  readonly shopifyApiVersion: string;
}

export interface WooCommerceConfig extends BaseConfig {
  readonly platform: "woocommerce";
  readonly wooBaseUrl: string;
  readonly wooConsumerKey: string;
  readonly wooConsumerSecret: string;
}

export type Config = ShopifyConfig | WooCommerceConfig;

function parsePort(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? String(fallback), 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    console.error(`[Config] Invalid port "${raw}", using ${fallback}`);
    return fallback;
  }
  return n;
}

function loadBaseConfig(): Omit<BaseConfig, "platform" | "storeUrl"> {
  const signerPrivateKey = process.env.MERCHANT_SIGNER_PRIVATE_KEY;
  if (!signerPrivateKey) {
    throw new Error("[Config] MERCHANT_SIGNER_PRIVATE_KEY is required");
  }
  const paymentAddress = process.env.MERCHANT_PAYMENT_ADDRESS;
  if (!paymentAddress) {
    throw new Error("[Config] MERCHANT_PAYMENT_ADDRESS is required");
  }

  return {
    merchantDid:
      process.env.MERCHANT_DID ?? "did:nexus:20250407:nexus-demo-store-2",
    portalPort: parsePort(process.env.PORTAL_PORT, 10000),
    databaseUrl: process.env.DATABASE_URL ?? "",
    webhookSecret:
      process.env.NEXUS_WEBHOOK_SECRET ?? "webhook_secret_dev",
    paymentAddress,
    signerPrivateKey,
    nexusCoreUrl:
      process.env.NEXUS_CORE_URL || "https://api.nexus.platon.network",
    selfUrl: process.env.SELF_URL || "http://commerce-agent:10000",
    portalToken: process.env.PORTAL_TOKEN ?? "",
    checkoutBaseUrl:
      process.env.CHECKOUT_BASE_URL || "https://nexus.platon.network",
    paymentCurrency: process.env.PAYMENT_CURRENCY ?? "XSGD",
    fixedRate: parseFloat(process.env.CHECKOUT_FIXED_RATE ?? "1.00"),
    rateLockMinutes: parseInt(
      process.env.CHECKOUT_RATE_LOCK_MINUTES ?? "5",
      10,
    ),
  };
}

function loadShopifyConfig(base: Omit<BaseConfig, "platform" | "storeUrl">): ShopifyConfig {
  const shopifyStoreUrl = process.env.SHOPIFY_STORE_URL;
  if (!shopifyStoreUrl) {
    throw new Error("[Config] SHOPIFY_STORE_URL is required");
  }
  const shopifyStorefrontToken = process.env.SHOPIFY_STOREFRONT_TOKEN;
  if (!shopifyStorefrontToken) {
    throw new Error("[Config] SHOPIFY_STOREFRONT_TOKEN is required");
  }

  return {
    ...base,
    platform: "shopify",
    storeUrl: shopifyStoreUrl,
    shopifyStoreUrl,
    shopifyStorefrontToken,
    shopifyAdminToken: process.env.SHOPIFY_ADMIN_TOKEN ?? "",
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? "2025-07",
  };
}

function loadWooCommerceConfig(base: Omit<BaseConfig, "platform" | "storeUrl">): WooCommerceConfig {
  const wooBaseUrl = process.env.WOO_BASE_URL;
  if (!wooBaseUrl) {
    throw new Error("[Config] WOO_BASE_URL is required");
  }
  const wooConsumerKey = process.env.WOO_CONSUMER_KEY;
  if (!wooConsumerKey) {
    throw new Error("[Config] WOO_CONSUMER_KEY is required");
  }
  const wooConsumerSecret = process.env.WOO_CONSUMER_SECRET;
  if (!wooConsumerSecret) {
    throw new Error("[Config] WOO_CONSUMER_SECRET is required");
  }

  return {
    ...base,
    platform: "woocommerce",
    storeUrl: wooBaseUrl,
    wooBaseUrl,
    wooConsumerKey,
    wooConsumerSecret,
  };
}

export function loadConfig(): Config {
  const platform = (process.env.PLATFORM ?? "shopify") as PlatformType;
  const base = loadBaseConfig();

  switch (platform) {
    case "shopify":
      return loadShopifyConfig(base);
    case "woocommerce":
      return loadWooCommerceConfig(base);
    default:
      throw new Error(`[Config] Unsupported PLATFORM: "${platform}"`);
  }
}
