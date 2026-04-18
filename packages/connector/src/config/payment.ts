// ---------------------------------------------------------------------------
// Payment provider configuration (discriminated union).
//
// The active provider is chosen by `PAYMENT_PROVIDER`. Each provider owns its
// own env-var surface, colocated in `src/payment/<provider>/config.ts`. This
// module only handles dispatch + surfaces the resolved fields the legacy
// checkout-session pipeline still reads directly.
//
// `PAYMENT_PROVIDER=none` (the Phase 1 `acc init` default) is a legitimate
// state — the connector boots without any payment rail, UCP discovery
// responses expose an empty `payment_handlers` array, and checkout calls
// that require a provider return UCP_ERR.PAYMENT_PROVIDER_UNAVAILABLE. A
// missing `PAYMENT_PROVIDER` env var is treated the same as `"none"` for
// backward compatibility with deployments that never set it.
// ---------------------------------------------------------------------------

export type PaymentProviderType = "nexus" | "none";

export interface NexusPaymentEnv {
  readonly provider: "nexus";
  readonly nexusCoreUrl: string;
  readonly signerPrivateKey: string;
  readonly paymentAddress: string;
  readonly checkoutBaseUrl: string;
  readonly webhookSecret: string;
  readonly chainId: number;
}

/**
 * Sentinel for "no payment provider wired". Structurally mirrors
 * NexusPaymentEnv so downstream code that spreads the payment env into
 * the flat Config type (see ../index.ts) keeps compiling; the only
 * operationally meaningful difference is the `provider` discriminant.
 * All string fields are empty, chainId is 0 — any consumer that hits
 * these will fail fast at the network layer, which is the correct
 * behaviour for "no payment provider".
 */
export interface NonePaymentEnv {
  readonly provider: "none";
  readonly nexusCoreUrl: string;
  readonly signerPrivateKey: string;
  readonly paymentAddress: string;
  readonly checkoutBaseUrl: string;
  readonly webhookSecret: string;
  readonly chainId: number;
}

export type PaymentEnv = NexusPaymentEnv | NonePaymentEnv;

const EMPTY_PAYMENT: NonePaymentEnv = {
  provider: "none",
  nexusCoreUrl: "",
  signerPrivateKey: "",
  paymentAddress: "",
  checkoutBaseUrl: "",
  webhookSecret: "",
  chainId: 0,
};

function loadNexusEnv(
  env: Record<string, string | undefined>,
): NexusPaymentEnv {
  const signerPrivateKey = env.MERCHANT_SIGNER_PRIVATE_KEY;
  if (!signerPrivateKey) {
    throw new Error(
      "[Config/Nexus] MERCHANT_SIGNER_PRIVATE_KEY is required. Get it from: the 0x-hex-encoded private key of the wallet that signs NUPS quotes (never the payout wallet).",
    );
  }
  const paymentAddress = env.MERCHANT_PAYMENT_ADDRESS;
  if (!paymentAddress) {
    throw new Error(
      "[Config/Nexus] MERCHANT_PAYMENT_ADDRESS is required. Get it from: the on-chain address that receives settled stablecoin funds.",
    );
  }

  return {
    provider: "nexus",
    nexusCoreUrl: env.NEXUS_CORE_URL || "https://api.nexus.platon.network",
    signerPrivateKey,
    paymentAddress,
    checkoutBaseUrl: env.CHECKOUT_BASE_URL || "https://nexus.platon.network",
    webhookSecret: env.NEXUS_WEBHOOK_SECRET ?? env.WEBHOOK_SECRET ?? "",
    chainId: parseInt(env.NEXUS_CHAIN_ID ?? "20250407", 10),
  };
}

export function loadPaymentEnv(
  env: Record<string, string | undefined>,
): PaymentEnv {
  const raw = env.PAYMENT_PROVIDER?.trim();
  const provider = (
    raw && raw.length > 0 ? raw : "none"
  ) as PaymentProviderType;
  switch (provider) {
    case "none":
      return EMPTY_PAYMENT;
    case "nexus":
      return loadNexusEnv(env);
    default:
      throw new Error(
        `[Config] Unsupported PAYMENT_PROVIDER: "${provider}". Expected "nexus" or "none".`,
      );
  }
}
