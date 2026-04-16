import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signTypedData } from "viem/accounts";
import type { MarketplaceSubmission } from "../marketplace-types.js";
import {
  buildMarketplaceSubmissionTypedData,
  recoverSubmissionSigner,
} from "../marketplace-types.js";

const CHAIN_ID = 1;

function makePublishSubmission(
  wallet: `0x${string}`,
): MarketplaceSubmission {
  return {
    action: "publish",
    wallet,
    skill_id: "skill-woo-analytics-v1",
    skill_url: "https://merchant.example.com/skills/woo-analytics",
    health_url: "https://merchant.example.com/skills/woo-analytics/health",
    name: "WooCommerce Analytics",
    description: "Real-time sales dashboard for WooCommerce stores",
    categories: ["analytics", "ecommerce"],
    tags: ["woocommerce", "dashboard", "sales"],
    logo_url: "https://merchant.example.com/logo.png",
    website_url: "https://merchant.example.com",
    supported_platforms: ["woocommerce"],
    supported_payments: ["stripe", "nexus"],
    languages: ["en", "es"],
    countries_served: ["US", "GB", "DE"],
    contact_url: "https://merchant.example.com/contact",
    nonce: "abc123-nonce",
    submitted_at: 1713168000000,
  };
}

function makeTakedownSubmission(
  wallet: `0x${string}`,
): MarketplaceSubmission {
  return {
    action: "takedown",
    wallet,
    skill_id: "skill-woo-analytics-v1",
    skill_url: "https://merchant.example.com/skills/woo-analytics",
    health_url: "https://merchant.example.com/skills/woo-analytics/health",
    name: "WooCommerce Analytics",
    categories: [],
    nonce: "takedown-nonce-456",
    submitted_at: 1713254400000,
  };
}

describe("MarketplaceSubmission EIP-712", () => {
  it("round-trip sign + recover for publish action", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const submission = makePublishSubmission(account.address);
    const typedData = buildMarketplaceSubmissionTypedData(submission, CHAIN_ID);

    const signature = await account.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const recovered = await recoverSubmissionSigner(
      submission,
      CHAIN_ID,
      signature,
    );

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("round-trip sign + recover for takedown action (minimal fields)", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const submission = makeTakedownSubmission(account.address);
    const typedData = buildMarketplaceSubmissionTypedData(submission, CHAIN_ID);

    const signature = await account.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    const recovered = await recoverSubmissionSigner(
      submission,
      CHAIN_ID,
      signature,
    );

    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it("tampered payload produces different recovered address", async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const submission = makePublishSubmission(account.address);
    const typedData = buildMarketplaceSubmissionTypedData(submission, CHAIN_ID);

    const signature = await account.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    // Tamper with the submission after signing
    const tampered: MarketplaceSubmission = {
      ...submission,
      name: "Tampered Name",
    };

    const recoveredFromTampered = await recoverSubmissionSigner(
      tampered,
      CHAIN_ID,
      signature,
    );

    expect(recoveredFromTampered.toLowerCase()).not.toBe(
      account.address.toLowerCase(),
    );
  });
});
