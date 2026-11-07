import { describe, expect, it } from "vitest";
import { explainSectionProblems } from "../src/explain-sections.js";

const complete = [
  "# demo/rule",
  "",
  "A chain must handle every case.",
  "",
  "```ts example-bad",
  "## not a section",
  "```",
  "",
  "```ts example-good",
  "const fixed = 1;",
  "```",
  "",
  "## Why it matters",
  "",
  "text",
  "",
  "## When it says “not checked”",
  "",
  "text",
  "",
  "## What it does not catch",
  "",
  "text",
  "",
  "## Turn it on or off",
  "",
  "text",
  "",
];

function without(heading: string): string {
  const index = complete.indexOf(heading);
  return [...complete.slice(0, index), ...complete.slice(index + 1)].join("\n");
}

const ORDER =
  '"Why it matters", "When it says “not checked”", "What it does not catch", "Getting the best from it", "Turn it on or off"';

describe("explainSectionProblems", () => {
  it("accepts the sections in order, with the optional ones left out or present", () => {
    expect(explainSectionProblems("demo/rule", complete.join("\n"))).toEqual([]);
    expect(explainSectionProblems("demo/rule", without("## When it says “not checked”"))).toEqual(
      [],
    );
  });

  it("names the rule and the missing section", () => {
    expect(explainSectionProblems("demo/rule", without("## What it does not catch"))).toEqual([
      'demo/rule: the explain text lacks the section "## What it does not catch"',
    ]);
  });

  it("does not count a heading inside a code fence", () => {
    const text = complete.join("\n").replace("## Why it matters", "```\n## Why it matters\n```");
    expect(explainSectionProblems("demo/rule", text)).toEqual([
      'demo/rule: the explain text lacks the section "## Why it matters"',
    ]);
  });

  it("names a section that is out of order", () => {
    const text = complete
      .join("\n")
      .replace("## What it does not catch", "## TMP")
      .replace("## Why it matters", "## What it does not catch")
      .replace("## TMP", "## Why it matters");
    expect(explainSectionProblems("demo/rule", text)).toEqual([
      `demo/rule: the section "## Why it matters" is out of order; the order is ${ORDER}`,
    ]);
  });

  it("names a section that is not one of the list", () => {
    const text = complete.join("\n").replace("## Why it matters", "## Why it matters\n\n## Bad");
    expect(explainSectionProblems("demo/rule", text)).toEqual([
      `demo/rule: "## Bad" is not one of the sections; the order is ${ORDER}`,
    ]);
  });

  it("asks for a bad and a good example before the sections", () => {
    const text = complete.join("\n").replace("```ts example-good", "```ts");
    expect(explainSectionProblems("demo/rule", text)).toEqual([
      "demo/rule: the explain text needs a `ts example-good` block before its sections",
    ]);
    const late = complete
      .join("\n")
      .replace("```ts example-bad", "```ts")
      .replace("text\n\n## Turn", "```tsx example-bad\nx\n```\n\n## Turn");
    expect(explainSectionProblems("demo/rule", late)).toEqual([
      "demo/rule: the explain text needs a `ts example-bad` block before its sections",
    ]);
  });

  it("asks for the title and the summary", () => {
    expect(explainSectionProblems("demo/rule", "# other/rule\n\n## Why it matters\n")).toContain(
      'demo/rule: the explain text must start with "# demo/rule"',
    );
    expect(
      explainSectionProblems(
        "demo/rule",
        complete.filter((l) => l !== "A chain must handle every case.").join("\n"),
      ),
    ).toContain("demo/rule: the explain text needs a one-sentence summary after the title");
  });
});
