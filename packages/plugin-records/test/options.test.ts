import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { OptionValue, RuleConfig } from "@stateward/core";
import { records } from "../src/index.js";
import { fixture } from "./helpers.js";

/*
 * Each option of the records pack, shown changing what its rule reports. The default of
 * every option is today's behaviour, which the rule's own tests cover.
 */

const RULES = [
  "lookup-misses-key",
  "table-type-too-loose",
  "duplicate-key",
  "keyed-maps-out-of-sync",
] as const;
const pack = records();

/** `file: headline` of each finding of `rule` over a fixture, with the options given. */
function lines(
  name: string,
  rule: (typeof RULES)[number],
  options: Readonly<Record<string, OptionValue>> = {},
): string[] {
  const rules: Record<string, RuleConfig> = {};
  for (const key of RULES) rules[`records/${key}`] = key === rule ? ["warning", options] : "off";
  const { findings } = checkFixture(fixture(name), [pack], rules, ["records/keyed-maps"]);
  expectMessageStandard(findings);
  return findings.map((finding) => `${path.basename(finding.location.file)}: ${finding.message}`);
}

const count = (...args: Parameters<typeof lines>): number => lines(...args).length;

describe("records/keyed-maps-out-of-sync options", () => {
  const dir = "keyed-maps-out-of-sync/flagged";
  it("`plainStringKeys: false` keeps only named key types", () => {
    expect(count(dir, "keyed-maps-out-of-sync")).toBe(3);
    expect(lines(dir, "keyed-maps-out-of-sync", { plainStringKeys: false })).toEqual([
      "records.ts: `names` and `ages` are both keyed by `UserId` and always written together",
    ]);
  });

  it("`minFunctions` and `ignore` narrow what is reported", () => {
    expect(count(dir, "keyed-maps-out-of-sync", { minFunctions: 3 })).toBe(0);
    expect(count(dir, "keyed-maps-out-of-sync", { ignore: ["names", "labels"] })).toBe(1);
  });
});
