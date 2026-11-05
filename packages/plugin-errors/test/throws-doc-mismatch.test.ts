import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "throws-doc-mismatch";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

describe(`errors/${RULE}: a @throws tag that does not match the body`, () => {
  it("reports classes left out, classes that cannot come, and what it cannot tell", () => {
    expect(shown(flagged())).toEqual([
      says(
        "docs.ts",
        "`loadUser` can throw `SyntaxError`, which its `@throws` does not list",
        "add it to the tag: `@throws {SyntaxError}`",
      ),
      says(
        "docs.ts",
        "`@throws` lists `ValidationError`, which `listsTooMuch` cannot throw",
        "remove `ValidationError` from the tag, or throw it where it can happen",
      ),
      says(
        "docs.ts",
        "`saysNever` can throw `ParseError`, which its `@throws` does not list",
        "add it to the tag: `@throws {ParseError}`",
      ),
      says(
        "docs.ts",
        "`fetchUser` can throw `TypeError`, which its `@throws` does not list",
        "add it to the tag: `@throws {TypeError}`",
      ),
      says(
        "docs.ts",
        "stateward cannot tell whether `unclear` throws `ParseError` (via `run`: callback of unknown origin)",
        "if `unclear` cannot throw it, remove `ParseError` from the tag; else add `@throws` where it comes from",
      ),
      says(
        "docs.ts",
        "stateward cannot find the class `Missing` this `@throws` names",
        "name an error class that is in scope in this file, or import it",
      ),
      says(
        "docs.ts",
        "`@throws` lists `ValidationError`, which `viaThen` cannot throw",
        "remove `ValidationError` from the tag, or throw it where it can happen",
      ),
      says(
        "docs.ts",
        "`viaThen` can throw `NotFoundError`, which its `@throws` does not list",
        "add it to the tag: `@throws {NotFoundError}`",
      ),
    ]);
  });

  it("shows a class left out on the function's name and a class that cannot come on the tag", () => {
    const text = readFileSync(fixture(`${RULE}/flagged/docs.ts`), "utf8");
    const found = flagged();
    expect(found.map((f) => text.slice(f.location.start, f.location.end))).toEqual([
      "loadUser",
      "ValidationError",
      "saysNever",
      "fetchUser",
      "ParseError",
      "Missing",
      "ValidationError",
      "viaThen",
    ]);
    expect(found.map((f) => f.kind)).toEqual([
      "problem",
      "problem",
      "problem",
      "problem",
      "unknown",
      "unknown",
      "problem",
      "problem",
    ]);
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts an exact tag, a base class, a caught error, rejections, an untyped tag, tests it cannot read, held promises and a comparator", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
