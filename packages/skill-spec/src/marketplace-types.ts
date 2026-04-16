import type { Address, Hex } from "viem";
import { recoverTypedDataAddress } from "viem";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } from "./constants.js";

export interface MarketplaceSubmission {
  action: "publish" | "takedown";
  wallet: Address;
  skill_id: string;
  skill_url: string;
  health_url: string;
  name: string;
  description?: string;
  categories: string[];
  tags?: string[];
  logo_url?: string;
  website_url?: string;
  supported_platforms?: string[];
  supported_payments?: string[];
  languages?: string[];
  countries_served?: string[];
  contact_url?: string;
  nonce: string;
  submitted_at: number; // unix ms
}

export const MARKETPLACE_EIP712_TYPES = {
  MarketplaceSubmission: [
    { name: "action", type: "string" },
    { name: "wallet", type: "address" },
    { name: "skill_id", type: "string" },
    { name: "skill_url", type: "string" },
    { name: "health_url", type: "string" },
    { name: "name", type: "string" },
    { name: "description", type: "string" },
    { name: "categories", type: "string" },
    { name: "tags", type: "string" },
    { name: "logo_url", type: "string" },
    { name: "website_url", type: "string" },
    { name: "supported_platforms", type: "string" },
    { name: "supported_payments", type: "string" },
    { name: "languages", type: "string" },
    { name: "countries_served", type: "string" },
    { name: "contact_url", type: "string" },
    { name: "nonce", type: "string" },
    { name: "submitted_at", type: "uint256" },
  ],
} as const;

function serializeArrayField(arr?: string[]): string {
  return (arr ?? []).join(",");
}

export function buildMarketplaceSubmissionTypedData(
  submission: MarketplaceSubmission,
  chainId: number,
) {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
    },
    types: MARKETPLACE_EIP712_TYPES,
    primaryType: "MarketplaceSubmission" as const,
    message: {
      action: submission.action,
      wallet: submission.wallet,
      skill_id: submission.skill_id,
      skill_url: submission.skill_url,
      health_url: submission.health_url,
      name: submission.name,
      description: submission.description ?? "",
      categories: serializeArrayField(submission.categories),
      tags: serializeArrayField(submission.tags),
      logo_url: submission.logo_url ?? "",
      website_url: submission.website_url ?? "",
      supported_platforms: serializeArrayField(submission.supported_platforms),
      supported_payments: serializeArrayField(submission.supported_payments),
      languages: serializeArrayField(submission.languages),
      countries_served: serializeArrayField(submission.countries_served),
      contact_url: submission.contact_url ?? "",
      nonce: submission.nonce,
      submitted_at: BigInt(submission.submitted_at),
    },
  };
}

export async function recoverSubmissionSigner(
  submission: MarketplaceSubmission,
  chainId: number,
  signature: Hex,
): Promise<Address> {
  const typedData = buildMarketplaceSubmissionTypedData(submission, chainId);
  return recoverTypedDataAddress({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature,
  });
}
