import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, type RuleKey } from "./helpers.js";

/** The options every unions rule takes: `ignore` for named things, per-kind severities. */

type Case = { rule: RuleKey; dir: string; name: string; extra?: Record<string, unknown> };

/** For each rule: a fixture folder and a name its findings are about, to ignore. */
const CASES: readonly Case[] = [
  {
    rule: "non-exhaustive-switch",
    dir: "non-exhaustive-switch/real-a",
    name: "EventName",
  },
  { rule: "ambiguous-discriminant", dir: "ambiguous-discriminant/flagged", name: "Event" },
];

function run(test: Case, ignore?: readonly string[]): readonly Finding[] {
  const options = { ...test.extra, ...(ignore === undefined ? {} : { ignore }) };
  return checkOnly(fixture(test.dir), test.rule, ["warning", options]);
}

describe("unions: ignore", () => {
  it.each(CASES.map((test) => [test.rule, test] as const))(
    "%s skips the names it lists, and only those",
    (_, test) => {
      const all = run(test).length;
      const named = run(test, [test.name]).length;
      expect(all).toBeGreaterThan(0);
      expect(named).toBeLessThan(all);
      expect(named).toBeGreaterThan(0);
      // A glob matches too.
      expect(run(test, [`${test.name.slice(0, 2)}*`]).length).toBeLessThanOrEqual(named);
    },
  );
});

describe("unions: the order of severities", () => {
  const many = (setting: Parameters<typeof checkOnly>[2]): string[] =>
    checkOnly(fixture("non-exhaustive-switch/real-a"), "non-exhaustive-switch", setting)
      .filter((finding) => finding.location.file.endsWith("many.ts"))
      .map((finding) => (finding.kind === "problem" ? finding.severity : finding.kind));

  it("reports a default hiding many cases as info: the rule's own choice for that finding", () => {
    expect(many("error")).toEqual(["info", "info", "error"]);
    expect(many("warning")).toEqual(["info", "info", "warning"]);
  });

  it("lets the config's severities for a kind override that choice", () => {
    expect(many(["error", { severities: { "many-hidden": "error" } }])).toEqual([
      "error",
      "error",
      "error",
    ]);
    expect(many(["error", { severities: { "many-hidden": "off", hidden: "warning" } }])).toEqual([
      "warning",
    ]);
  });
});
