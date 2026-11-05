import type { OptionValue, SeverityMap } from "@stateward/core";
import { describe, expect, it } from "vitest";
import { brief, checkWith, fixture } from "./helpers.js";

/*
 * Each option of the errors pack, shown changing what its rule reports. The default of
 * every option is today's behaviour, which the rule's own tests cover.
 */

describe("errors/catch-without-intent options", () => {
  const dir = fixture("options/no-swallow");
  const logs = (options: Record<string, readonly string[]>): number =>
    brief(checkWith(dir, "catch-without-intent", ["warning", options])).filter((line) =>
      line.endsWith(": this catch logs the error and carries on as if nothing failed"),
    ).length;

  it("recognises console by default and nothing of the team's own", () => {
    expect(logs({})).toBe(1);
  });

  it("takes the team's own log functions, loggers and log methods", () => {
    expect(logs({ logFunctions: ["log*"] })).toBe(2);
    expect(logs({ loggers: ["console", "*Logger"] })).toBe(2);
    expect(logs({ logMethods: ["record"] })).toBe(2);
    expect(logs({ loggers: [], logMethods: [] })).toBe(0);
  });

  it("counts a project function as reporting or ignoring only when it is declared, Sentry without it", () => {
    const edge = fixture("catch-without-intent/edge");
    const count = (options: Record<string, readonly string[]>): number =>
      checkWith(edge, "catch-without-intent", ["warning", options]).length;
    expect(count({})).toBe(3);
    expect(count({ edgeHelpers: ["reportAndShow"] })).toBe(2);
    expect(count({ edgeHelpers: ["reportAndShow", "Sentry.*"] })).toBe(2);
    expect(count({ edgeHelpers: ["reportAndShow", "Sentry.*"], swallowHelpers: ["ignore*"] })).toBe(
      1,
    );
  });
});

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
      "error handled.ts: errors other than `NotFoundError` are handled here without ever using `e`",
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
      "warning docs.ts: `@throws` lists `ValidationError`, which `listsTooMuch` cannot throw",
      "warning docs.ts: `@throws` lists `ValidationError`, which `viaThen` cannot throw",
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
    expect(count(dir, "catch-misses-error", {}, "this boundary can catch")).toBe(1);
    expect(
      count(
        dir,
        "catch-misses-error",
        { ignoreClasses: ["ParseError"] },
        "this boundary can catch",
      ),
    ).toBe(0);
  });
});
