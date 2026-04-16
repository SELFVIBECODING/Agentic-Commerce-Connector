import type { Address, Hex } from "viem";
import { recoverTypedDataAddress } from "viem";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } from "./constants.js";

/**
 * EIP-712 payload a merchant signs to add/remove a listing on a marketplace.
 *
 * The signature binds the signer wallet to *this specific skill.md content*
 * at *this specific URL*. The content hash is the sha256 of the normalized
 * markdown bytes (see skill-md.ts for normalization rules).
 *
 * For takedown, skill_url may be empty and skill_sha256 may be the zero hash.
 */
export interface MarketplaceSubmission {
  readonly action: "publish" | "takedown";
  readonly wallet: Address;
  readonly skill_id: string;
  readonly skill_url: string;
  readonly skill_sha256: Hex; // 0x<64 hex chars>
  readonly nonce: string;
  readonly submitted_at: number; // unix ms
}

export const ZERO_SHA256: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const MARKETPLACE_EIP712_TYPES = {
  MarketplaceSubmission: [
    { name: "action", type: "string" },
    { name: "wallet", type: "address" },
    { name: "skill_id", type: "string" },
    { name: "skill_url", type: "string" },
    { name: "skill_sha256", type: "bytes32" },
    { name: "nonce", type: "string" },
    { name: "submitted_at", type: "uint256" },
  ],
} as const;

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
      skill_sha256: submission.skill_sha256,
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
