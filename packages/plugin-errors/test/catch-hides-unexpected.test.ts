import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding, TextEdit } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";
import { typeErrorsOfText as typeErrors } from "@stateward/core/testing";

const RULE = "catch-hides-unexpected";
const FILE = fixture(`${RULE}/flagged/chains.ts`);

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

function swallowed(classes: string): string {
  return `\`catch\` ignores errors other than ${classes}`;
}

function chainHint(variable: string): string {
  return `end the chain with a branch that rethrows the rest, so they reach the caller:\n    } else {\n      throw ${variable};\n    }`;
}

function switchHint(variable: string): string {
  return `end the switch with a case that rethrows the rest, so they reach the caller:\n    default:\n      throw ${variable};`;
}

/** Applies the edits to the text, last first so earlier offsets stay valid. */
function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

function editsOf(finding: Finding | undefined): readonly TextEdit[] {
  expect(finding?.kind).toBe("problem");
  return finding?.kind === "problem" ? finding.fixes.flatMap((fix) => fix.edits) : [];
}

/** The lines of the function that starts at `header`, after the fix of `finding` is applied. */
function fixedFunction(finding: Finding | undefined, header: string): string[] {
  const lines = applied(readFileSync(FILE, "utf8"), editsOf(finding)).split("\n");
  const start = lines.findIndex((line) => line.includes(header));
  const end = lines.findIndex((line, index) => index > start && line.startsWith("}"));
  return lines.slice(start, end + 1);
}

describe(`errors/${RULE}: a catch that handles some classes and swallows the rest`, () => {
  it("lists the handled classes and shows the branch to add", () => {
    expect(shown(flagged())).toEqual([
      says("chains.ts", swallowed("`NotFoundError` and `AuthError`"), chainHint("e")),
      says("chains.ts", swallowed("`NotFoundError`"), chainHint("error")),
      says(
        "chains.ts",
        swallowed("`NotFoundError`, `AuthError`, `RateLimitError` and 2 more"),
        chainHint("e"),
      ),
      says("chains.ts", swallowed("`NotFoundError`"), chainHint("e")),
      says("chains.ts", swallowed("`NotFoundError` and `AuthError`"), switchHint("e")),
      says("chains.ts", swallowed("`NotFoundError`"), switchHint("e")),
      says("chains.ts", swallowed("`NotFoundError`, `AuthError` and `Error`"), chainHint("e")),
      says("chains.ts", swallowed("`NotFoundError`"), chainHint("e")),
      says("chains.ts", swallowed("`NotFoundError`"), chainHint("e")),
      says("chains.ts", swallowed("`errors.Missing`"), chainHint("e")),
      says("chains.ts", swallowed("`NotFoundError`"), chainHint("e")),
      says(
        "chains.ts",
        swallowed(
          "`PaymentRequiredErrorWithAVeryLongName`, `AnotherQuiteLongClassNameForErrors` and `ThirdVeryLongClassNameThatKeepsGoing`",
        ),
        chainHint("e"),
      ),
      says("chains.ts", swallowed("`NotFoundError` and `AuthError`"), chainHint("e")),
      says("chains.ts", swallowed("`NotFoundError`"), chainHint("e")),
    ]);
  });

  it("is an error that names the first `if` or the `switch`", () => {
    const text = readFileSync(FILE, "utf8");
    const keywords = flagged().map((finding) =>
      text.slice(finding.location.start, finding.location.end),
    );
    expect(keywords).toEqual([
      "if",
      "if",
      "if",
      "if",
      "switch",
      "switch",
      "if",
      "if",
      "if",
      "if",
      "if",
      "if",
      "if",
      "if",
    ]);
    expect(flagged()[0]).toMatchObject({
      kind: "problem",
      ruleId: `errors/${RULE}`,
      severity: "error",
    });
  });

  it("reports the last chain of a catch that has several", () => {
    const found = flagged();
    expect(found.at(-2)?.message).toBe(swallowed("`NotFoundError` and `AuthError`"));
    const text = readFileSync(FILE, "utf8");
    const last = found.at(-2);
    expect(text.slice(last?.location.start).startsWith("if (e instanceof AuthError)")).toBe(true);
  });

  it("never cuts a class name: only the names make a headline longer than 100", () => {
    for (const finding of flagged()) {
      const words = finding.message.replace(/`[^`]*`/g, "");
      expect(words.length).toBeLessThanOrEqual(100);
      expect(finding.message).not.toContain("…");
    }
    const longest = Math.max(...flagged().map((finding) => finding.message.length));
    expect(longest).toBeGreaterThan(100);
  });
});

describe(`errors/${RULE}: the quick fix`, () => {
  it("adds `else { throw e; }` to a chain that ends without an else", () => {
    expect(fixedFunction(flagged()[0], "function twoClasses")).toEqual([
      "export async function twoClasses(): Promise<void> {",
      "  try {",
      "    await save();",
      "  } catch (e) {",
      "    if (e instanceof NotFoundError) {",
      '      show("missing");',
      "    } else if (e instanceof AuthError) {",
      '      show("login");',
      "    } else {",
      "      throw e;",
      "    }",
      "  }",
      "}",
    ]);
  });

  it("uses the name of the catch variable", () => {
    expect(fixedFunction(flagged()[1], "function oneClass")).toContain("      throw error;");
    expect(flagged()[1]).toMatchObject({
      fixes: [{ title: "Rethrow the other errors with `else { throw error; }`" }],
    });
  });

  it("follows a branch that is not a block", () => {
    expect(fixedFunction(flagged()[8], "function statementBranch")).toContain(
      "    if (e instanceof NotFoundError) return 0; else {",
    );
    expect(fixedFunction(flagged()[8], "function statementBranch").slice(5, 9)).toEqual([
      "    if (e instanceof NotFoundError) return 0; else {",
      "      throw e;",
      "    }",
      "  }",
    ]);
  });

  it("keeps tab indentation", () => {
    expect(fixedFunction(flagged()[10], "function tabs").slice(-6, -1)).toEqual([
      '\t\t\tshow("missing");',
      "\t\t} else {",
      "\t\t\tthrow e;",
      "\t\t}",
      "\t}",
    ]);
  });

  it("offers no fix for an else that does nothing or a switch", () => {
    const found = flagged();
    expect(found[3]).toMatchObject({ kind: "problem", fixes: [] });
    expect(found[4]).toMatchObject({ kind: "problem", fixes: [] });
    expect(found[5]).toMatchObject({ kind: "problem", fixes: [] });
  });
});

describe(`errors/${RULE}: the quick fix compiles`, { timeout: 60_000 }, () => {
  it("compiles with every fix applied at once", () => {
    const original = readFileSync(FILE, "utf8");
    const edits = flagged().flatMap((finding) => editsOf(finding));
    // All but the empty else and the two switches.
    expect(edits).toHaveLength(11);
    expect(typeErrors(original)).toBe("");
    const fixed = applied(original, edits);
    expect(fixed.match(/else \{\n\s+throw e(rror)?;/g)).toHaveLength(11);
    expect(typeErrors(fixed)).toBe("");
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts a rethrow, a wrap, a handling else, a trailing statement, guard clauses and tests it does not read", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
