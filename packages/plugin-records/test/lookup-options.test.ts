import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, type RuleKey } from "./lookup-helpers.js";

/** `ignore` of the lookup rules: the names listed are skipped, and only those. */

type Case = { rule: RuleKey; dir: string; name: string };

const CASES: readonly Case[] = [
  { rule: "lookup-misses-key", dir: "lookup-misses-key/flagged", name: "labels" },
  { rule: "duplicate-key", dir: "duplicate-key/flagged", name: "groups" },
];

function run(test: Case, ignore?: readonly string[]): readonly Finding[] {
  return checkOnly(fixture(test.dir), test.rule, [
    "warning",
    ignore === undefined ? {} : { ignore },
  ]);
}

describe("records: ignore", () => {
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
