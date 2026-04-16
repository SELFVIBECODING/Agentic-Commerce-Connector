import { describe, it, expect } from "vitest";
import {
  buildSkillMd,
  computeSkillSha256,
  normalizeSkillMd,
  parseSkillMd,
  validateSkillFrontmatter,
} from "../skill-md.js";

const SAMPLE_FRONTMATTER = {
  name: "NeuroThreads",
  description:
    "Cyberpunk-inspired streetwear and neural-reactive fabrics for the modern netrunner.",
  skill_id: "neurothreads-v1",
  categories: ["fashion", "digital"],
  supported_platforms: ["shopify", "custom"],
  supported_payments: ["crypto", "stripe"],
  health_url: "https://neurothreads.example.com/health",
  tags: ["streetwear", "cyberpunk"],
  website_url: "https://neurothreads.example.com",
};

const SAMPLE_BODY = "# NeuroThreads\n\nWearable tech for netrunners.";

describe("normalizeSkillMd", () => {
  it("normalizes CRLF to LF", () => {
    expect(normalizeSkillMd("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("strips BOM", () => {
    expect(normalizeSkillMd("\uFEFFhello")).toBe("hello\n");
  });

  it("trims trailing whitespace on each line", () => {
    expect(normalizeSkillMd("a   \nb\t\n")).toBe("a\nb\n");
  });

  it("enforces single trailing newline", () => {
    expect(normalizeSkillMd("a\n\n\n")).toBe("a\n");
    expect(normalizeSkillMd("a")).toBe("a\n");
  });
});

describe("computeSkillSha256", () => {
  it("returns stable 32-byte hex hash with 0x prefix", () => {
    const hash = computeSkillSha256("hello\n");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is insensitive to line-ending / trailing-whitespace drift", () => {
    const a = computeSkillSha256("hello world\n");
    const b = computeSkillSha256("hello world   \r\n");
    expect(a).toBe(b);
  });

  it("changes when content changes", () => {
    const a = computeSkillSha256("one\n");
    const b = computeSkillSha256("two\n");
    expect(a).not.toBe(b);
  });
});

describe("parseSkillMd", () => {
  it("parses frontmatter and body from a valid skill.md", () => {
    const md = buildSkillMd(SAMPLE_FRONTMATTER, SAMPLE_BODY);
    const parsed = parseSkillMd(md);
    expect(parsed.frontmatter.name).toBe("NeuroThreads");
    expect(parsed.frontmatter.skill_id).toBe("neurothreads-v1");
    expect(parsed.frontmatter.categories).toEqual(["fashion", "digital"]);
    expect(parsed.body.trim()).toBe(SAMPLE_BODY.trim());
  });

  it("rejects a markdown file with no frontmatter delimiter", () => {
    expect(() => parseSkillMd("# Just a title\n")).toThrow(
      /frontmatter delimiter/i,
    );
  });

  it("rejects unterminated frontmatter", () => {
    expect(() => parseSkillMd("---\nname: foo\n")).toThrow(/not terminated/i);
  });
});

describe("validateSkillFrontmatter", () => {
  it("accepts a full valid frontmatter", () => {
    const result = validateSkillFrontmatter(SAMPLE_FRONTMATTER);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects missing required fields", () => {
    const result = validateSkillFrontmatter({ name: "x" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("skill_id"))).toBe(true);
    expect(result.errors.some((e) => e.includes("health_url"))).toBe(true);
  });

  it("rejects an invalid skill_id slug", () => {
    const result = validateSkillFrontmatter({
      ...SAMPLE_FRONTMATTER,
      skill_id: "NOT VALID",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("skill_id"))).toBe(true);
  });

  it("rejects a non-https health_url", () => {
    const result = validateSkillFrontmatter({
      ...SAMPLE_FRONTMATTER,
      health_url: "http://insecure.example.com/health",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("health_url"))).toBe(true);
  });

  it("rejects an empty categories array", () => {
    const result = validateSkillFrontmatter({
      ...SAMPLE_FRONTMATTER,
      categories: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("categories"))).toBe(true);
  });
});
