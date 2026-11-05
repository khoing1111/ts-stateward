import { describe, expect, it } from "vitest";
import { explainSectionProblems } from "../src/explain-sections.js";

const complete = [
  "# demo/rule",
  "",
  "A chain must handle every case.",
  "",
  "## Why",
  "",
  "text",
  "",
  "## When to use it",
  "",
  "text",
  "",
  "## What it catches",
  "",
  "### Bad",
  "",
  "```ts",
  "## not a section",
  "```",
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

describe("explainSectionProblems", () => {
  it("accepts the full set of sections in order", () => {
    expect(explainSectionProblems("demo/rule", complete.join("\n"))).toEqual([]);
  });

  it("names the rule and the missing section", () => {
    expect(explainSectionProblems("demo/rule", without("## What it does not catch"))).toEqual([
      'demo/rule: the explain text lacks the section "## What it does not catch"',
    ]);
  });

  it("does not count a heading inside a code fence", () => {
    const text = complete.join("\n").replace("## Why", "```\n## Why\n```");
    expect(explainSectionProblems("demo/rule", text)).toEqual([
      'demo/rule: the explain text lacks the section "## Why"',
    ]);
  });

  it("names a section that is out of order", () => {
    const text = complete
      .join("\n")
      .replace("## When to use it", "## TMP")
      .replace("## Why", "## When to use it")
      .replace("## TMP", "## Why");
    expect(explainSectionProblems("demo/rule", text)).toEqual([
      'demo/rule: the section "## Why" is out of order; the order is "Why", "When to use it", "What it catches", "What it does not catch", "Turn it on or off"',
    ]);
  });

  it("asks for the title and the summary", () => {
    expect(explainSectionProblems("demo/rule", "# other/rule\n\n## Why\n")).toContain(
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
