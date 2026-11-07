import { describe, expect, it } from "vitest";
import { checkFixture, ruleCode } from "@stateward/core/testing";
import type { RuleSetting, RuleTier, Severity } from "@stateward/core";
import { asyncFlow } from "../src/index.js";
import { fixture } from "./helpers.js";

/** The rule keys the plugin has: a key that is not one is a compile error. */
type AsyncKey = keyof ReturnType<typeof asyncFlow>["rules"];

/** Rule key, default severity, tier, and the severity under the default (recommended) preset. */
const EXPECTED: readonly (readonly [AsyncKey, Severity, RuleTier, Severity])[] = [
  ["pending-state-stuck-on-failure", "warning", "core", "warning"],
  ["handler-rejection-lost", "error", "core", "error"],
];

describe("async", () => {
  it("is a plugin named async with its two rules, one group, and no editor contributions", () => {
    const plugin = asyncFlow();
    expect(plugin.name).toBe("async");
    expect(Object.keys(plugin.rules)).toEqual(EXPECTED.map(([key]) => key));
    expect(Object.values(plugin.rules).map((rule) => rule.meta.group)).toEqual([
      "failures",
      "failures",
    ]);
    expect(plugin.editor).toBeUndefined();
    expect(plugin.description).toBe(
      "An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails.",
    );
  });

  it.each(EXPECTED)(
    "%s has a severity, a tier, a description and an explain page",
    (key, severity, tier) => {
      const rule = ruleCode(asyncFlow(), key);
      expect(rule.kind).toBe("file");
      expect(rule.meta.defaultSeverity).toBe(severity);
      expect(rule.meta.tier).toBe(tier);
      expect(rule.meta.description.length).toBeGreaterThan(0);
      const explain = rule.meta.explain;
      expect(explain).toContain(`# async/${key}`);
      expect(explain).toContain("example-bad");
      expect(explain).toContain("example-good");
      expect(explain).toContain(`rules: { "async/${key}": "off" }`);
    },
  );

  it.each(EXPECTED)("%s reports nothing once switched off", (key) => {
    const rules: Record<string, RuleSetting> = { [`async/${key}`]: "off" };
    const { findings } = checkFixture(fixture(`${key}/flagged`), [asyncFlow()], rules);
    expect(findings.filter((finding) => finding.ruleId === `async/${key}`)).toEqual([]);
  });

  it.each(EXPECTED)("%s reports at its preset severity", (key, _d, _t, severity) => {
    const { findings } = checkFixture(fixture(`${key}/flagged`), [asyncFlow()]);
    const own = findings.filter((finding) => finding.ruleId === `async/${key}`);
    expect(own.length).toBeGreaterThan(0);
    expect(
      own.every((finding) => finding.kind === "problem" && finding.severity === severity),
    ).toBe(true);
  });
});
