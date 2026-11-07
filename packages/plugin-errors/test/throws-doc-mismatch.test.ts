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
        "`@throws` of `loadUser` does not list `SyntaxError`",
        "add it to the tag: `@throws {SyntaxError}`",
      ),
      says(
        "docs.ts",
        "`@throws` of `listsTooMuch` lists `ValidationError`, which it cannot throw",
        "remove `ValidationError` from the tag, or throw it where it can happen",
      ),
      says(
        "docs.ts",
        "`@throws` of `saysNever` does not list `ParseError`",
        "add it to the tag: `@throws {ParseError}`",
      ),
      says(
        "docs.ts",
        "`@throws` of `fetchUser` does not list `TypeError`",
        "add it to the tag: `@throws {TypeError}`",
      ),
      says(
        "docs.ts",
        "not checked: whether `unclear` throws `ParseError`: what `run` throws is not known (callback of unknown origin)",
        "remove `ParseError` from the tag if `unclear` cannot throw it; otherwise add `@throws` where it comes from",
      ),
      says(
        "docs.ts",
        "not checked: `@throws` names `Missing`: no class of that name is in scope",
        "name an error class that is in scope in this file, or import it",
      ),
      says(
        "docs.ts",
        "`@throws` of `viaThen` lists `ValidationError`, which it cannot throw",
        "remove `ValidationError` from the tag, or throw it where it can happen",
      ),
      says(
        "docs.ts",
        "`@throws` of `viaThen` does not list `NotFoundError`",
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
