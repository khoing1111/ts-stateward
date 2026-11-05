import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import type { OptionValue, RuleConfig } from "@stateward/core";
import { react } from "../src/index.js";
import { fixture } from "./helpers.js";

/*
 * Each option of the flag-combos add-on, shown changing what its rule reports. The default
 * of every option is today's behaviour, which the rule's own tests cover.
 */

type RuleKey = "flags-allow-impossible-combos";
const pack = react();

/** `file: headline` of each finding of `rule` over a fixture, with the options given. */
function lines(
  name: string,
  rule: RuleKey,
  options: Readonly<Record<string, OptionValue>> = {},
): string[] {
  const rules: Record<string, RuleConfig> = {};
  for (const key of Object.keys(pack.rules)) {
    rules[`react/${key}`] = key === rule ? ["warning", options] : "off";
  }
  const { findings } = checkFixture(fixture(name), [pack], rules, ["react/flag-combos"]);
  expectMessageStandard(findings);
  return findings.map((finding) => `${path.basename(finding.location.file)}: ${finding.message}`);
}

const count = (...args: Parameters<typeof lines>): number => lines(...args).length;

describe("react/flags-allow-impossible-combos options", () => {
  const dir = "flags-allow-impossible-combos/flagged";
  it("`minVariables` reports only larger groups", () => {
    expect(count(dir, "flags-allow-impossible-combos")).toBe(6);
    expect(lines(dir, "flags-allow-impossible-combos", { minVariables: 3 })).toEqual([
      "components.tsx: `isLoading`, `error` and `data` describe one state in 3 variables",
      "components.tsx: `uploading`, `failure`, `url` and 1 more describe one state in 4 variables",
      "components.tsx: `a`, `b`, `c` and 2 more describe one state in 5 variables",
    ]);
  });

  it("`setTogether: false` counts only variables read together", () => {
    expect(lines(dir, "flags-allow-impossible-combos", { setTogether: false })).not.toContain(
      "components.tsx: `isLoading`, `error` and `data` describe one state in 3 variables",
    );
    expect(count(dir, "flags-allow-impossible-combos", { setTogether: false })).toBe(5);
  });

  it("`ignore` never counts the flags named", () => {
    expect(lines(dir, "flags-allow-impossible-combos", { ignore: ["is*"] })).not.toContain(
      "components.tsx: `isOpen` and `isDirty` describe one state in 2 variables",
    );
  });
});
