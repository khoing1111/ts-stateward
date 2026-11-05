import { describe, expect, it } from "vitest";
import type { OptionValue } from "@stateward/core";
import { check, fixture } from "./helpers.js";

/*
 * Each option of the react pack, shown changing what its rule reports. The default of every
 * option is today's behaviour, which the rule's own tests cover.
 */

const ADDONS = ["react/effect-race"];

/** `severity: headline` of each problem of `rule` over a fixture, with the options given. */
function lines(
  name: string,
  rule: string,
  options: Readonly<Record<string, OptionValue>> = {},
): string[] {
  return check(
    fixture(name),
    { [`react/${rule}`]: ["warning", options] },
    undefined,
    ADDONS,
  ).flatMap((finding) =>
    finding.kind === "problem" && finding.ruleId === `react/${rule}`
      ? [`${finding.severity}: ${finding.message}`]
      : [],
  );
}

const count = (...args: Parameters<typeof lines>): number => lines(...args).length;

describe("react render-stability options", () => {
  it("dependency-changes-every-render: `memoProps`, `ignore` and `severities`", () => {
    expect(count("shop", "dependency-changes-every-render")).toBe(12);
    expect(count("shop", "dependency-changes-every-render", { memoProps: false })).toBe(10);
    expect(count("shop", "dependency-changes-every-render", { ignore: ["useCart"] })).toBe(6);
    const mixed = lines("shop", "dependency-changes-every-render", {
      severities: { "from-function": "info" },
    });
    expect(mixed.filter((line) => line.startsWith("info"))).toEqual([
      "info: `columns` from `getColumns(…)` is a new array every render, so this effect runs after every render",
      "info: `columns` from `getColumns(…)` is a new array every render, so `<Table>` re-renders every time",
      "info: `columns` from `buildColumns(…)` is a new array every render, so this effect runs after every render",
      // `useColumns` returns what a plain function inside it builds.
      "info: `columns` from `useColumns(…)` is a new array every render, so this effect runs after every render",
    ]);
  });

  it("provider-value-changes-every-render: `ignore`", () => {
    expect(
      count("shop", "provider-value-changes-every-render", {
        ignore: ["ItemContext", "Theme*", "Toggle*", "Field*"],
      }),
    ).toBe(3);
  });
});

describe("react effects options", () => {
  it("effect-copies-derived-value and state-copies-prop: `ignore`", () => {
    expect(count("effects", "effect-copies-derived-value", { ignore: ["fullName", "vis*"] })).toBe(
      1,
    );
    expect(count("effects", "state-copies-prop", { ignore: ["draft"] })).toBe(0);
  });

  it("effect-missing-cleanup: what counts as started, and a severity per kind", () => {
    expect(count("effects", "effect-missing-cleanup")).toBe(8);
    expect(count("effects", "effect-missing-cleanup", { timeouts: false })).toBe(7);
    expect(
      count("effects", "effect-missing-cleanup", {
        observers: [],
        connections: [],
        subscribeMethods: [],
      }),
    ).toBe(4);
    const mixed = lines("effects", "effect-missing-cleanup", {
      severities: { "inline-handler": "error", "missing-cleanup": "info" },
    });
    expect(mixed.filter((line) => line.startsWith("error"))).toEqual([
      "error: the `resize` listener on `window` is an inline function, so no cleanup can remove it",
    ]);
    expect(mixed.filter((line) => line.startsWith("info"))).toHaveLength(7);
  });

  it("effect-response-race: `notRequests`", () => {
    expect(count("effects", "effect-response-race")).toBe(2);
    expect(lines("effects", "effect-response-race", { notRequests: ["searchUsers"] })).toEqual([
      "warning: a slow response for an old `userId` can overwrite a newer one",
    ]);
  });
});

describe("react state-updates options", () => {
  it("closure-reads-stale-state: `listenerMethods`", () => {
    expect(count("state-updates", "closure-reads-stale-state")).toBe(5);
    expect(count("state-updates", "closure-reads-stale-state", { listenerMethods: [] })).toBe(3);
  });

  it("index-key-on-reordered-list: `textOnlyRows` and `ignore`", () => {
    expect(count("state-updates", "index-key-on-reordered-list")).toBe(4);
    expect(count("state-updates", "index-key-on-reordered-list", { textOnlyRows: true })).toBe(5);
    expect(count("state-updates", "index-key-on-reordered-list", { ignore: ["todos"] })).toBe(1);
  });
});
