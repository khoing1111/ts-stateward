import type { OptionValue, SeverityMap } from "@stateward/core";
import { describe, expect, it } from "vitest";
import { brief, checkWith, fixture } from "./helpers.js";

/*
 * Each option of the errors pack, shown changing what its rule reports. The default of
 * every option is today's behaviour, which the rule's own tests cover.
 */

/** How many findings of the rule mention `text` under the options given. */
function count(
  name: string,
  rule: Parameters<typeof checkWith>[1],
  options: Readonly<Record<string, OptionValue>>,
  text = "",
): number {
  return brief(checkWith(fixture(name), rule, ["error", options])).filter((line) =>
    line.includes(text),
  ).length;
}

describe("errors/catch-misses-error option `ignoreClasses`", () => {
  it("never asks for a branch for the classes listed", () => {
    expect(count("catch-misses-error/flagged", "catch-misses-error", {}, "SyntaxError")).toBe(3);
    expect(
      count("catch-misses-error/flagged", "catch-misses-error", { ignoreClasses: ["SyntaxError"] }),
    ).toBe(8);
    expect(
      count("catch-misses-error/flagged", "catch-misses-error", { ignoreClasses: ["*"] }),
    ).toBe(0);
  });
});

describe("errors/catch-hides-unexpected option `restUsesError`", () => {
  it("reports a last branch that never uses the error, only when set", () => {
    const dir = "catch-hides-unexpected/not-flagged";
    expect(count(dir, "catch-hides-unexpected", {})).toBe(0);
    expect(
      brief(checkWith(fixture(dir), "catch-hides-unexpected", ["error", { restUsesError: true }])),
    ).toEqual([
      "error handled.ts: `catch` handles errors other than `NotFoundError` without looking at `e`",
    ]);
  });
});

describe("errors/finally-can-throw option `severities`", () => {
  const dir = fixture("finally-can-throw/flagged");
  const severities = (setting: SeverityMap): string[] =>
    brief(checkWith(dir, "finally-can-throw", ["error", { severities: setting }])).map(
      (line) => line.split(" ")[0] ?? "",
    );
  it("gives each kind of call its own severity", () => {
    const all = severities({});
    expect(all.every((one) => one === "error")).toBe(true);
    const mixed = severities({ builtin: "warning", "own-function": "info" });
    expect(mixed.filter((one) => one === "error")).toHaveLength(1);
    expect(mixed.filter((one) => one === "warning")).toHaveLength(11);
    expect(mixed.filter((one) => one === "info")).toHaveLength(6);
    expect(severities({ builtin: "off", throw: "off", "own-function": "off" })).toEqual([]);
  });
});

describe("errors/throws-doc-mismatch options", () => {
  const dir = fixture("throws-doc-mismatch/flagged");
  it("`severities` sets a missing class and a stale one apart", () => {
    const lines = brief(
      checkWith(dir, "throws-doc-mismatch", ["error", { severities: { extra: "warning" } }]),
    );
    expect(lines.filter((line) => line.startsWith("warning"))).toEqual([
      "warning docs.ts: `@throws` of `listsTooMuch` lists `ValidationError`, which it cannot throw",
      "warning docs.ts: `@throws` of `viaThen` lists `ValidationError`, which it cannot throw",
    ]);
    expect(lines.filter((line) => line.startsWith("error"))).toHaveLength(4);
  });

  it("`ignoreClasses` never asks the tag to list those classes", () => {
    expect(count("throws-doc-mismatch/flagged", "throws-doc-mismatch", {}, "does not list")).toBe(
      4,
    );
    expect(
      count(
        "throws-doc-mismatch/flagged",
        "throws-doc-mismatch",
        { ignoreClasses: ["SyntaxError", "TypeError"] },
        "does not list",
      ),
    ).toBe(2);
  });
});

describe("errors/render-throw-without-boundary option `boundaries`", () => {
  it("counts only the package boundaries listed", () => {
    const dir = "react-boundaries/not-flagged";
    expect(count(dir, "render-throw-without-boundary", {})).toBe(0);
    expect(
      brief(
        checkWith(fixture(dir), "render-throw-without-boundary", ["error", { boundaries: {} }]),
      ),
    ).toEqual([
      "error main.tsx: `<App>` can throw `NotFoundError` and `ParseError` while rendering, with no error boundary above it",
    ]);
  });
});

describe("errors/render-throw-without-boundary: `skipContextGuards` and `skipInputGuards`", () => {
  const dir = fixture("react-boundaries/guards");
  const lines = (options: Record<string, boolean>): string[] =>
    brief(checkWith(dir, "render-throw-without-boundary", ["warning", options]));
  const both =
    "`<App>` can throw `Error` and `NotFoundError` while rendering, with no error boundary above it";

  it("leaves out a context hook's check and a check on a prop, and counts them when false", () => {
    const one =
      "warning main.tsx: `<App>` can throw `NotFoundError` while rendering, with no error boundary above it";
    expect(lines({})).toEqual([one]);
    // `useAuth`'s check is on a context hook's value too: an input check, still left out.
    expect(lines({ skipContextGuards: false })).toEqual([one]);
    // `<Card>`'s check on its `title` prop now counts.
    expect(lines({ skipInputGuards: false })).toEqual([`warning main.tsx: ${both}`]);
    expect(lines({ skipContextGuards: false, skipInputGuards: false })).toEqual([
      `warning main.tsx: ${both}`,
    ]);
  });
});

describe("errors/catch-misses-error option `ignoreClasses`, on an error boundary's fallback", () => {
  it("never asks for a branch for the classes listed", () => {
    const dir = "react-boundaries/flagged";
    expect(count(dir, "catch-misses-error", {}, "its boundary can catch")).toBe(1);
    expect(
      count(dir, "catch-misses-error", { ignoreClasses: ["ParseError"] }, "its boundary can catch"),
    ).toBe(0);
  });
});
