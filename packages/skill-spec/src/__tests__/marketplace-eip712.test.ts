import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { MarketplaceSubmission } from "../marketplace-types.js";
import {
  ZERO_SHA256,
  buildMarketplaceSubmissionTypedData,
  recoverSubmissionSigner,
} from "../marketplace-types.js";

const CHAIN_ID = 1;
const SAMPLE_SHA256: Hex =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function makePublishSubmission(wallet: `0x${string}`): MarketplaceSubmission {
  return {
    action: "publish",
    wallet,
    skill_id: "skill-woo-analytics-v1",
    skill_url:
      "https://merchant.example.com/.well-known/acc-skill.md",
    skill_sha256: SAMPLE_SHA256,
    nonce: "abc123-nonce",
    submitted_at: 1713168000000,
  };
}

function makeTakedownSubmission(wallet: `0x${string}`): MarketplaceSubmission {
  return {
    action: "takedown",
    wallet,
    skill_id: "skill-woo-analytics-v1",
    skill_url: "",
    skill_sha256: ZERO_SHA256,
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

  it("round-trip sign + recover for takedown action", async () => {
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

  it("tampered skill_sha256 produces different recovered address", async () => {
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

    const tampered: MarketplaceSubmission = {
      ...submission,
      skill_sha256:
        "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
    };

    const recovered = await recoverSubmissionSigner(
      tampered,
      CHAIN_ID,
      signature,
    );

    expect(recovered.toLowerCase()).not.toBe(account.address.toLowerCase());
  });
});
