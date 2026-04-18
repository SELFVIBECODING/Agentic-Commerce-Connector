import { describe, it, expect } from "vitest";
import { createPrompter, type PromptIO } from "../shared/prompts.js";

function mockIO(
  answers: string[],
  eof = false,
): PromptIO & { output: string[] } {
  const queue = [...answers];
  const output: string[] = [];
  return {
    output,
    ask(q: string): Promise<string | null> {
      output.push(q);
      if (queue.length === 0) return Promise.resolve(eof ? null : "");
      return Promise.resolve(queue.shift()!);
    },
    askSecret(q: string): Promise<string | null> {
      output.push(`SECRET:${q}`);
      if (queue.length === 0) return Promise.resolve(eof ? null : "");
      return Promise.resolve(queue.shift()!);
    },
    close(): void {},
  };
}

describe("createPrompter.ask", () => {
  it("returns entered value when present", async () => {
    const io = mockIO(["hello"]);
    const p = createPrompter(io);
    expect(await p.ask("name?")).toBe("hello");
    expect(io.output.some((l) => l.startsWith("name?"))).toBe(true);
  });

  it("returns default when user presses enter on empty input", async () => {
    const io = mockIO([""]);
    const p = createPrompter(io);
    expect(await p.ask("name?", { default: "Bob" })).toBe("Bob");
  });

  it("returns default on EOF (stdin closed)", async () => {
    const io = mockIO([], true);
    const p = createPrompter(io);
    expect(await p.ask("name?", { default: "Bob" })).toBe("Bob");
  });

  it("re-asks on validator failure until valid", async () => {
    const io = mockIO(["", "nope", "yes"]);
    const p = createPrompter(io);
    const result = await p.ask("name?", {
      validate: (v) => (v === "yes" ? null : "must be 'yes'"),
    });
    expect(result).toBe("yes");
    // First three prompts + two error messages woven in
    expect(io.output.filter((l) => l.startsWith("name?")).length).toBe(3);
  });
});

describe("createPrompter.askYesNo", () => {
  it("maps y/yes to true and n/no to false", async () => {
    const p = createPrompter(mockIO(["y"]));
    expect(await p.askYesNo("ok?")).toBe(true);
    const p2 = createPrompter(mockIO(["no"]));
    expect(await p2.askYesNo("ok?")).toBe(false);
  });

  it("falls back to default on empty", async () => {
    const p = createPrompter(mockIO([""]));
    expect(await p.askYesNo("ok?", { default: true })).toBe(true);
  });
});

describe("createPrompter.askChoice", () => {
  it("returns the selected key from valid options", async () => {
    const p = createPrompter(mockIO(["b"]));
    const choice = await p.askChoice("pick", [
      { key: "a", label: "Apple" },
      { key: "b", label: "Banana" },
    ]);
    expect(choice).toBe("b");
  });

  it("re-asks on invalid choice", async () => {
    const p = createPrompter(mockIO(["z", "a"]));
    const choice = await p.askChoice("pick", [
      { key: "a", label: "Apple" },
      { key: "b", label: "Banana" },
    ]);
    expect(choice).toBe("a");
  });
});

describe("createPrompter.askSecret", () => {
  it("reads without echoing", async () => {
    const io = mockIO(["shh"]);
    const p = createPrompter(io);
    expect(await p.askSecret("pw?")).toBe("shh");
    expect(io.output).toContain("SECRET:pw?");
  });
});

describe("createPrompter.askMultiChoice (non-TTY fallback)", () => {
  // Tests run under vitest which does not attach a TTY to stdin, so the
  // fallback letter-key path is what we can exercise here. The TTY
  // arrow-key path is covered by manual terminal testing.

  it("parses comma-separated letters and returns keys in catalog order", async () => {
    const p = createPrompter(mockIO(["a,c"]));
    const picked = await p.askMultiChoice("pick", [
      { key: "a", label: "Apple" },
      { key: "b", label: "Banana" },
      { key: "c", label: "Cherry" },
    ]);
    expect(picked).toEqual(["a", "c"]);
  });

  it("returns catalog order even when input letters are reversed", async () => {
    const p = createPrompter(mockIO(["c,a"]));
    const picked = await p.askMultiChoice("pick", [
      { key: "a", label: "Apple" },
      { key: "b", label: "Banana" },
      { key: "c", label: "Cherry" },
    ]);
    // Catalog order wins for skill.md hash stability.
    expect(picked).toEqual(["a", "c"]);
  });

  it("re-asks when fewer than min letters are picked", async () => {
    const p = createPrompter(mockIO(["", "a,b"]));
    const picked = await p.askMultiChoice(
      "pick",
      [
        { key: "a", label: "Apple" },
        { key: "b", label: "Banana" },
      ],
      { min: 2 },
    );
    expect(picked).toEqual(["a", "b"]);
  });

  it("re-asks on any unknown letter in the input", async () => {
    const p = createPrompter(mockIO(["a,z", "a"]));
    const picked = await p.askMultiChoice("pick", [
      { key: "a", label: "Apple" },
      { key: "b", label: "Banana" },
    ]);
    expect(picked).toEqual(["a"]);
  });
});
