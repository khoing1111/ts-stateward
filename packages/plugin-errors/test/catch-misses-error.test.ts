import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "catch-misses-error";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

const IF_HINT = (count: "it" | "each", variable: string, handler: string): string =>
  [
    `add a branch for ${count}, or rethrow what you do not handle:`,
    `    } else if (${variable} instanceof ${handler}) {`,
    "      …",
    "    } else {",
    `      throw ${variable};`,
  ].join("\n");

/** For a chain without `else`: a branch the chain can take, not an `else if`. */
const NO_ELSE_HINT = (count: "it" | "each", variable: string, handler: string): string =>
  [
    `add a branch for ${count}, or rethrow what you do not handle after the chain:`,
    `    if (${variable} instanceof ${handler}) {`,
    "      …",
    "    }",
    `    throw ${variable};`,
  ].join("\n");

const SWITCH_HINT = [
  "add a branch for each, or rethrow what you do not handle:",
  "    case e instanceof ConflictError:",
  "      …",
  "    default:",
  "      throw e;",
].join("\n");

describe(`errors/${RULE}: a catch that leaves a known error unhandled`, () => {
  it("names the classes and the call they come from, through calls in other files, in handlers and callbacks once each, with a fix in the catch's shape", () => {
    expect(shown(flagged())).toEqual([
      says(
        "catches.ts",
        "`catch` does not handle `RateLimitError` from `send(…)`",
        IF_HINT("it", "e", "RateLimitError"),
      ),
      says(
        "catches.ts",
        "`catch` does not handle `SyntaxError` from `parse(…)`",
        NO_ELSE_HINT("it", "error", "SyntaxError"),
      ),
      says(
        "catches.ts",
        "`catch` does not handle `ConflictError`, `QuotaError` and `RateLimitError` from `store(…)`",
        SWITCH_HINT,
      ),
      says(
        "catches.ts",
        "`catch` does not handle `AuthError`, `ConflictError`, `QuotaError` and 2 more thrown in its `try` block",
        IF_HINT("each", "e", "AuthError"),
      ),
      says(
        "catches.ts",
        "`catch` does not handle `ParseError` and `RateLimitError` thrown in its `try` block",
        IF_HINT("each", "e", "ParseError"),
      ),
      says(
        "catches.ts",
        "`catch` does not handle `SyntaxError` from `parse(…)`",
        IF_HINT("it", "e", "SyntaxError"),
      ),
      says(
        "catches.ts",
        "`catch` does not handle `SyntaxError` from `parse(…)`",
        IF_HINT("it", "e", "SyntaxError"),
      ),
      says(
        "catches.ts",
        "`catch` does not handle `TypeError` and `RateLimitError` from `send(…)`",
        NO_ELSE_HINT("each", "e", "TypeError"),
      ),
      says(
        "declared.ts",
        "`catch` does not handle `SecondError` from `load(…)`",
        IF_HINT("it", "e", "SecondError"),
      ),
      says(
        "declared.ts",
        "`catch` does not handle `SecondError` from `open(…)`",
        IF_HINT("it", "e", "SecondError"),
      ),
      says(
        "declared.ts",
        "`catch` does not handle `SecondError` from `local(…)`",
        IF_HINT("it", "e", "SecondError"),
      ),
    ]);
  });

  it("reads `@throws` on a function declared without a body: in a project .d.ts, with overloads, or `declare` in a .ts", () => {
    const found = shown(flagged()).filter((one) => one.file === "declared.ts");
    expect(found.map((one) => one.message)).toEqual([
      "`catch` does not handle `SecondError` from `load(…)`",
      "`catch` does not handle `SecondError` from `open(…)`",
      "`catch` does not handle `SecondError` from `local(…)`",
    ]);
  });

  it("is an error on the `catch` keyword, with the calls that bring each class", () => {
    const found = flagged().filter((one) => one.location.file.endsWith("catches.ts"));
    const text = readFileSync(fixture(`${RULE}/flagged/catches.ts`), "utf8");
    expect(found.map((f) => text.slice(f.location.start, f.location.end))).toEqual(
      Array.from({ length: 8 }, () => "catch"),
    );
    expect(found[0]).toMatchObject({
      kind: "problem",
      ruleId: `errors/${RULE}`,
      severity: "error",
    });
    const related = found[0]?.kind === "problem" ? found[0].related : [];
    expect(related.map((one) => one.message)).toEqual(["`send(…)` can throw `RateLimitError`"]);
    expect(text.slice(related[0]?.location.start, related[0]?.location.end)).toBe("send");
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts every class handled, a base class, a rethrow or wrap of the rest, a rest that is used, unknown-only errors, no chain, tests it cannot read, unawaited promises, open class chains, a @throws of a promise and fetch without a signal", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
