import { describe, expect, it } from "vitest";
import { checkFixture, ruleCode } from "@stateward/core/testing";
import type { RuleSetting, RuleTier, Severity } from "@stateward/core";
import { unions } from "../src/index.js";
import { ADDONS, fixture } from "./helpers.js";

/** The rule keys the plugin has: a key that is not one is a compile error. */
type UnionsKey = keyof ReturnType<typeof unions>["rules"];

/** Rule key, default severity, tier, and the severity under the default (recommended) preset. */
const EXPECTED: readonly (readonly [UnionsKey, Severity, RuleTier, Severity])[] = [
  ["default-hides-cases", "error", "core", "error"],
  ["if-chain-misses-case", "error", "core", "error"],
  ["tag-does-not-discriminate", "warning", "coverage", "info"],
];

/** The rules that need the whole project. */
const PROJECT_RULES: readonly UnionsKey[] = ["tag-does-not-discriminate"];

describe("unions", () => {
  it("is a plugin named unions with its three rules and no editor contributions", () => {
    const plugin = unions();
    expect(plugin.name).toBe("unions");
    expect(Object.keys(plugin.rules)).toEqual(EXPECTED.map(([key]) => key));
    expect(plugin.editor).toBeUndefined();
    expect(plugin.description).toBe(
      "Every case of a union is handled, and its tag tells the cases apart.",
    );
  });

  it.each(EXPECTED)(
    "%s has a severity, a tier, a description and an explain page",
    (key, severity, tier) => {
      const rule = ruleCode(unions(), key);
      expect(rule.kind).toBe(PROJECT_RULES.includes(key) ? "project" : "file");
      expect(rule.meta.addon).toBeUndefined();
      expect(rule.meta.group).toBe("cases");
      expect(rule.meta.defaultSeverity).toBe(severity);
      expect(rule.meta.tier).toBe(tier);
      expect(rule.meta.description.length).toBeGreaterThan(0);
      const explain = rule.meta.explain;
      expect(explain).toContain(`# unions/${key}`);
      expect(explain).toContain("example-bad");
      expect(explain).toContain("example-good");
      expect(explain).toContain(`rules: { "unions/${key}": "off" }`);
    },
  );

  it.each(EXPECTED)("%s reports nothing once switched off", (key) => {
    const rules: Record<string, RuleSetting> = { [`unions/${key}`]: "off" };
    const dir = fixture(`${key}/flagged`);
    const { findings } = checkFixture(dir, [unions()], rules, ADDONS);
    expect(findings.filter((finding) => finding.ruleId === `unions/${key}`)).toEqual([]);
  });

  it.each(EXPECTED)("%s reports at its preset severity", (key, _default, _tier, severity) => {
    const { findings } = checkFixture(fixture(`${key}/flagged`), [unions()], {}, ADDONS);
    const own = findings.filter((finding) => finding.ruleId === `unions/${key}`);
    expect(own.length).toBeGreaterThan(0);
    // if-chain-misses-case's guesses (a chain that leaves a case out) are warnings at most.
    const guess = (kind: string | undefined): boolean =>
      key === "if-chain-misses-case" && (kind === "missing" || kind === "hidden");
    expect(
      own.every(
        (finding) =>
          finding.kind === "problem" &&
          finding.severity === (guess(finding.findingKind) ? "warning" : severity),
      ),
    ).toBe(true);
  });

  it("has no heuristic rule", () => {
    const heuristic = EXPECTED.map(([key]) => key).filter(
      (key) => ruleCode(unions(), key).meta.heuristic === true,
    );
    expect(heuristic).toEqual([]);
  });
});
