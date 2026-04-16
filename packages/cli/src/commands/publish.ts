import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  buildMarketplaceSubmissionTypedData,
  type MarketplaceSubmission,
} from "@acc/skill-spec";

/* ------------------------------------------------------------------ */
/*  Arg helpers                                                       */
/* ------------------------------------------------------------------ */

function parseFlag(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function positional(args: readonly string[]): string | undefined {
  return args.find((a) => !a.startsWith("--"));
}

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

interface SubmissionDescriptor {
  readonly skill_id: string;
  readonly skill_url: string;
  readonly health_url: string;
  readonly name: string;
  readonly description?: string;
  readonly categories: readonly string[];
  readonly tags?: readonly string[];
  readonly logo_url?: string;
  readonly website_url?: string;
  readonly supported_platforms?: readonly string[];
  readonly supported_payments?: readonly string[];
  readonly languages?: readonly string[];
  readonly countries_served?: readonly string[];
  readonly contact_url?: string;
}

const REQUIRED_FIELDS: readonly (keyof SubmissionDescriptor)[] = [
  "skill_id",
  "skill_url",
  "health_url",
  "name",
  "categories",
];

function validateDescriptor(raw: unknown): SubmissionDescriptor {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Submission descriptor must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new Error(`Missing required field "${field}" in submission descriptor.`);
    }
  }
  if (!Array.isArray(obj["categories"]) || obj["categories"].length === 0) {
    throw new Error('"categories" must be a non-empty array of strings.');
  }
  return raw as unknown as SubmissionDescriptor;
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export async function runPublish(args: string[]): Promise<void> {
  /* --- Parse CLI args --- */
  const filePath = positional(args);
  if (!filePath) {
    throw new Error(
      "Usage: acc-skill publish <descriptor.json> --registry=<url> --private-key=<hex>",
    );
  }

  const registry = parseFlag(args, "registry");
  if (!registry) {
    throw new Error("Missing required flag --registry=<url>.");
  }

  const privateKeyHex = parseFlag(args, "private-key");
  if (!privateKeyHex) {
    throw new Error("Missing required flag --private-key=<hex>.");
  }

  /* --- Read & validate descriptor file --- */
  const raw: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
  const descriptor = validateDescriptor(raw);

  /* --- Derive wallet address from private key --- */
  const account = privateKeyToAccount(privateKeyHex as Hex);

  /* --- Build MarketplaceSubmission --- */
  const submission: MarketplaceSubmission = {
    action: "publish",
    wallet: account.address,
    skill_id: descriptor.skill_id,
    skill_url: descriptor.skill_url,
    health_url: descriptor.health_url,
    name: descriptor.name,
    description: descriptor.description,
    categories: [...descriptor.categories],
    tags: descriptor.tags ? [...descriptor.tags] : undefined,
    logo_url: descriptor.logo_url,
    website_url: descriptor.website_url,
    supported_platforms: descriptor.supported_platforms
      ? [...descriptor.supported_platforms]
      : undefined,
    supported_payments: descriptor.supported_payments
      ? [...descriptor.supported_payments]
      : undefined,
    languages: descriptor.languages ? [...descriptor.languages] : undefined,
    countries_served: descriptor.countries_served
      ? [...descriptor.countries_served]
      : undefined,
    contact_url: descriptor.contact_url,
    nonce: randomUUID(),
    submitted_at: Date.now(),
  };

  /* --- EIP-712 sign --- */
  const chainId = Number(process.env.EIP712_CHAIN_ID ?? 1);
  const typedData = buildMarketplaceSubmissionTypedData(submission, chainId);

  const signature = await account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });

  /* --- POST to registry --- */
  const url = `${registry.replace(/\/+$/, "")}/v1/submissions`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: submission, signature }),
  });

  const body: unknown = await response.json();

  if (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).ok === true
  ) {
    const id = (body as Record<string, unknown>).id ?? "(unknown)";
    process.stdout.write(
      `Published "${submission.name}" (${submission.skill_id}) — submission id: ${String(id)}\n`,
    );
  } else {
    const message =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).error ?? JSON.stringify(body)
        : String(body);
    throw new Error(`Registry rejected submission: ${String(message)}`);
  }
}
