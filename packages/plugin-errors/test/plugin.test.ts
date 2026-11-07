import { describe, expect, it } from "vitest";
import { checkFixture, ruleCode } from "@stateward/core/testing";
import type { RuleSetting, RuleTier, Severity } from "@stateward/core";
import { errors } from "../src/index.js";
import { ADDONS, fixture } from "./helpers.js";

/** The rule keys the plugin has: a key that is not one is a compile error. */
type ErrorsKey = keyof ReturnType<typeof errors>["rules"];

/**
 * Rule key, default severity, tier, the severity under the default (recommended) preset, and
 * whether it is a project rule.
 */
const EXPECTED: readonly (readonly [ErrorsKey, Severity, RuleTier, Severity, boolean])[] = [
  ["catch-hides-unexpected", "error", "core", "error", false],
  ["finally-can-throw", "error", "core", "error", false],
  ["catch-misses-error", "error", "core", "error", true],
  ["throws-doc-mismatch", "error", "core", "error", true],
  ["render-throw-without-boundary", "warning", "core", "warning", true],
  ["must-handle-error", "error", "core", "error", true],
  ["narrow-try", "warning", "addon", "warning", true],
  ["result-ignored", "error", "core", "error", false],
  ["result-unchecked", "warning", "core", "warning", false],
];

/** The React boundary rule has one app per case. */
function fixtureOf(key: ErrorsKey, kind: "flagged" | "not-flagged"): string {
  return key === "render-throw-without-boundary"
    ? fixture(`react-boundaries/${kind}`)
    : fixture(`${key}/${kind}`);
}

describe("errors", () => {
  it("is a plugin named errors with its ten rules, a hover and its library facts", () => {
    const plugin = errors();
    expect(plugin.name).toBe("errors");
    expect(Object.keys(plugin.rules)).toEqual(EXPECTED.map(([key]) => key));
    expect(Object.keys(plugin.editor ?? {})).toEqual([
      "hover",
      "inlayHints",
      "codeActions",
      "libraryFacts",
    ]);
    expect(plugin.description).toBe(
      "Errors are handled where they can happen: none ignored, none replaced in `finally`, no `Result` dropped.",
    );
  });

  it("puts each rule in its group", () => {
    const rules = errors().rules;
    expect(EXPECTED.map(([key]) => rules[key].meta.group)).toEqual([
      "catch",
      "catch",
      "catch",
      "callers",
      "render",
      "callers",
      "catch",
      "callers",
      "callers",
    ]);
  });

  it("parses JSDoc only for the inference rules", () => {
    const rules = errors().rules;
    expect(rules["catch-misses-error"].meta.needsJsDoc).toBe(true);
    expect(rules["throws-doc-mismatch"].meta.needsJsDoc).toBe(true);
    expect(rules["render-throw-without-boundary"].meta.needsJsDoc).toBe(true);
    expect(rules["narrow-try"].meta.needsJsDoc).toBe(true);
    expect(rules["catch-hides-unexpected"].meta.needsJsDoc).toBeUndefined();
  });

  it("makes narrow-try an add-on, silent until listed", () => {
    const rules = errors().rules;
    expect(rules["narrow-try"].meta.addon).toBe("narrow-try");
    for (const key of ["narrow-try"] as const) {
      const { findings } = checkFixture(fixture(`${key}/flagged`), [errors()]);
      expect(findings.filter((finding) => finding.ruleId === `errors/${key}`)).toEqual([]);
    }
  });

  it("marks result-unchecked as a heuristic", () => {
    const rules = errors().rules;
    expect(rules["catch-hides-unexpected"].meta.heuristic).toBeUndefined();
    expect(rules["finally-can-throw"].meta.heuristic).toBeUndefined();
    expect(rules["result-unchecked"].meta.heuristic).toBe(true);
  });

  it.each(EXPECTED)(
    "%s has a severity, a tier, a description and an explain page",
    (key, severity, tier, _preset, project) => {
      const rule = ruleCode(errors(), key);
      expect(rule.kind).toBe(project ? "project" : "file");
      expect(rule.meta.defaultSeverity).toBe(severity);
      expect(rule.meta.tier).toBe(tier);
      expect(rule.meta.description.length).toBeGreaterThan(0);
      const explain = rule.meta.explain;
      expect(explain).toContain(`# errors/${key}`);
      expect(explain).toContain("example-bad");
      expect(explain).toContain("example-good");
      expect(explain).toContain(`rules: { "errors/${key}": "off" }`);
    },
  );

  it.each(EXPECTED)("%s reports nothing once switched off", (key) => {
    const rules: Record<string, RuleSetting> = { [`errors/${key}`]: "off" };
    const { findings } = checkFixture(fixtureOf(key, "flagged"), [errors()], rules);
    expect(findings.filter((finding) => finding.ruleId === `errors/${key}`)).toEqual([]);
  });

  it.each(EXPECTED)("%s reports at its preset severity", (key, _default, _tier, severity) => {
    const { findings } = checkFixture(fixtureOf(key, "flagged"), [errors()], {}, ADDONS);
    // Unknowns (what a rule cannot decide) have no severity of their own.
    const own = findings.filter(
      (finding) => finding.ruleId === `errors/${key}` && finding.kind !== "unknown",
    );
    expect(own.length).toBeGreaterThan(0);
    expect(
      own.every((finding) => finding.kind === "problem" && finding.severity === severity),
    ).toBe(true);
  });

  it.each(EXPECTED)("%s reports nothing on its not-flagged fixture, with every rule on", (key) => {
    const { findings } = checkFixture(fixtureOf(key, "not-flagged"), [errors()], {}, ADDONS);
    expect(findings.filter((finding) => finding.ruleId === `errors/${key}`)).toEqual([]);
  });
});
