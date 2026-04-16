import { createHash } from "node:crypto";
import yaml from "js-yaml";
import type { Hex } from "viem";

/* ------------------------------------------------------------------ */
/*  Frontmatter contract                                              */
/* ------------------------------------------------------------------ */

export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly skill_id: string;
  readonly categories: readonly string[];
  readonly supported_platforms: readonly string[];
  readonly supported_payments: readonly string[];
  readonly health_url: string;
  readonly tags?: readonly string[];
  readonly logo_url?: string;
  readonly website_url?: string;
  readonly contact_url?: string;
  readonly languages?: readonly string[];
  readonly countries_served?: readonly string[];
}

export interface ParsedSkillMd {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

export const SKILL_MD_SPEC_VERSION = "acc-skill-md/1.0" as const;

const FRONTMATTER_DELIMITER = "---";
const REQUIRED_FIELDS: readonly (keyof SkillFrontmatter)[] = [
  "name",
  "description",
  "skill_id",
  "categories",
  "supported_platforms",
  "supported_payments",
  "health_url",
];

const OPTIONAL_ARRAY_FIELDS: readonly (keyof SkillFrontmatter)[] = [
  "tags",
  "languages",
  "countries_served",
];

const REQUIRED_ARRAY_FIELDS: readonly (keyof SkillFrontmatter)[] = [
  "categories",
  "supported_platforms",
  "supported_payments",
];

// categories must not be empty — every listing needs at least one for
// filter indexing. platforms/payments can legitimately be empty (e.g. the
// marketplace's own market skill is neither a platform nor a payment).
const NON_EMPTY_ARRAY_FIELDS: readonly (keyof SkillFrontmatter)[] = [
  "categories",
];

const SKILL_ID_PATTERN = /^[a-z0-9-]{3,64}$/;
const HTTPS_URL_PATTERN = /^https:\/\/\S+$/;
const MAX_DESCRIPTION_LENGTH = 280;

/* ------------------------------------------------------------------ */
/*  Normalization                                                     */
/*  Makes the sha256 stable across editors and hosting gateways.      */
/* ------------------------------------------------------------------ */

export function normalizeSkillMd(raw: string): string {
  let text = raw.normalize("NFC");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n?/g, "\n");
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  text = text.replace(/\n+$/, "") + "\n";
  return text;
}

/* ------------------------------------------------------------------ */
/*  Hashing                                                           */
/* ------------------------------------------------------------------ */

export function computeSkillSha256(raw: string): Hex {
  const normalized = normalizeSkillMd(raw);
  const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `0x${digest}` as Hex;
}

/* ------------------------------------------------------------------ */
/*  Parse                                                             */
/* ------------------------------------------------------------------ */

function splitFrontmatter(raw: string): {
  readonly frontmatter: string;
  readonly body: string;
} {
  const normalized = normalizeSkillMd(raw);
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new Error(
      "Skill markdown must start with a '---' YAML frontmatter delimiter.",
    );
  }
  const rest = normalized.slice(FRONTMATTER_DELIMITER.length + 1);
  const endIdx = rest.indexOf(`\n${FRONTMATTER_DELIMITER}\n`);
  if (endIdx < 0) {
    throw new Error(
      "Skill markdown frontmatter is not terminated by a '---' line.",
    );
  }
  return {
    frontmatter: rest.slice(0, endIdx),
    body: rest.slice(endIdx + FRONTMATTER_DELIMITER.length + 2),
  };
}

export function parseSkillMd(raw: string): ParsedSkillMd {
  const { frontmatter: yamlText, body } = splitFrontmatter(raw);
  const loaded = yaml.load(yamlText, { schema: yaml.FAILSAFE_SCHEMA });
  if (typeof loaded !== "object" || loaded === null || Array.isArray(loaded)) {
    throw new Error("Skill markdown frontmatter must be a YAML object.");
  }
  const result = validateSkillFrontmatter(loaded);
  if (!result.valid) {
    throw new Error(`Invalid skill frontmatter: ${result.errors.join("; ")}`);
  }
  return { frontmatter: loaded as SkillFrontmatter, body };
}

/* ------------------------------------------------------------------ */
/*  Validate                                                          */
/* ------------------------------------------------------------------ */

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function validateSkillFrontmatter(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["frontmatter must be a YAML object"] };
  }
  const obj = raw as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      errors.push(`missing required field "${field}"`);
    }
  }

  if (typeof obj.name === "string" && obj.name.trim().length === 0) {
    errors.push(`"name" must be a non-empty string`);
  }

  if (typeof obj.description === "string") {
    if (obj.description.length === 0) {
      errors.push(`"description" must be a non-empty string`);
    } else if (obj.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`"description" exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
    }
  }

  if (
    typeof obj.skill_id === "string" &&
    !SKILL_ID_PATTERN.test(obj.skill_id)
  ) {
    errors.push(`"skill_id" must match ${SKILL_ID_PATTERN.source}`);
  }

  if (
    typeof obj.health_url === "string" &&
    !HTTPS_URL_PATTERN.test(obj.health_url)
  ) {
    errors.push(`"health_url" must be an https:// URL`);
  }

  for (const field of REQUIRED_ARRAY_FIELDS) {
    const value = obj[field];
    if (value !== undefined && value !== null && !isStringArray(value)) {
      errors.push(`"${field}" must be an array of strings`);
    } else if (
      isStringArray(value) &&
      value.length === 0 &&
      NON_EMPTY_ARRAY_FIELDS.includes(field)
    ) {
      errors.push(`"${field}" must contain at least one entry`);
    }
  }

  for (const field of OPTIONAL_ARRAY_FIELDS) {
    const value = obj[field];
    if (value !== undefined && value !== null && !isStringArray(value)) {
      errors.push(`"${field}" must be an array of strings`);
    }
  }

  for (const urlField of ["logo_url", "website_url", "contact_url"] as const) {
    const value = obj[urlField];
    if (value !== undefined && value !== null) {
      if (typeof value !== "string" || !HTTPS_URL_PATTERN.test(value)) {
        errors.push(`"${urlField}" must be an https:// URL when present`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/*  Build (CLI scaffolding)                                           */
/* ------------------------------------------------------------------ */

export function buildSkillMd(
  frontmatter: SkillFrontmatter,
  body: string,
): string {
  const yamlText = yaml.dump(frontmatter, {
    noRefs: true,
    sortKeys: false,
    lineWidth: -1,
  });
  const trimmedYaml = yamlText.replace(/\n+$/, "");
  const trimmedBody = body.replace(/\n+$/, "");
  return normalizeSkillMd(
    `${FRONTMATTER_DELIMITER}\n${trimmedYaml}\n${FRONTMATTER_DELIMITER}\n\n${trimmedBody}\n`,
  );
}
