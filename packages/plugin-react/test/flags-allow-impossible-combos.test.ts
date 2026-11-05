import { describe, expect, it } from "vitest";
import { react } from "../src/index.js";
import { checkFixture, expectMessageStandard, ruleCode } from "@stateward/core/testing";
import type { Finding, RuleConfig } from "@stateward/core";
import { checkWithPreset, fixture, shown } from "./flags-helpers.js";

const FLAGGED = fixture("flags-allow-impossible-combos/flagged");
const NOT_FLAGGED = fixture("flags-allow-impossible-combos/not-flagged");
const RULE = "react/flags-allow-impossible-combos";
/** Every other rule of the pack off, so a fixture is judged by this one. */
const ONLY: Readonly<Record<string, "off">> = Object.fromEntries(
  Object.keys(react().rules)
    .map((key) => `react/${key}`)
    .filter((id) => id !== RULE)
    .map((id) => [id, "off"] as const),
);

const ADDONS = ["react/flag-combos"] as const;

function check(dir: string, rules: Record<string, RuleConfig>): readonly Finding[] {
  const { findings } = checkFixture(dir, [react()], rules, ADDONS);
  expectMessageStandard(findings);
  return findings;
}

function finding(message: string, variables: number, example: readonly string[]) {
  return {
    file: "components.tsx",
    name: "useState(false)",
    message,
    hint: [
      `${String(variables)} variables allow ${String(2 ** variables)} combinations; keep the valid ones as one state:`,
      ...example,
    ].join("\n"),
    notes: [],
    fix: undefined,
  };
}

/** One union of the developer's own names. */
function union(message: string, variables: number, type: string, states: string) {
  return finding(message, variables, [
    `    type ${type} = ${states};`,
    `    const [state, setState] = useState<${type}>("none");`,
  ]);
}

describe(RULE, () => {
  it("says which variables describe one state, and how many combinations they allow", () => {
    expect(shown(check(FLAGGED, ONLY))).toEqual([
      // The classic trio, set together in the effect and its callbacks.
      union(
        "`isLoading`, `error` and `data` describe one state in 3 variables",
        3,
        "ProfileState",
        '"none" | "loading" | "error" | "data"',
      ),
      // A form's flags, read together in one condition: a guess, hence a warning.
      union(
        "`isOpen` and `isDirty` describe one state in 2 variables",
        2,
        "PanelState",
        '"none" | "open" | "dirty"',
      ),
      // A hook; the fourth variable is counted, not named.
      union(
        "`uploading`, `failure`, `url` and 1 more describe one state in 4 variables",
        4,
        "UploadState",
        '"none" | "uploading" | "failure" | "url" | "cancelled"',
      ),
      // The unrelated `open` is not part of it, and the finding is at the first involved state.
      union(
        "`busy` and `problem` describe one state in 2 variables",
        2,
        "MixedState",
        '"none" | "busy" | "problem"',
      ),
      union(
        "`a`, `b`, `c` and 2 more describe one state in 5 variables",
        5,
        "ManyState",
        '"none" | "a" | "b" | "c" | "d" | "e"',
      ),
      // Wrapped in `memo`.
      union(
        "`loading` and `value` describe one state in 2 variables",
        2,
        "WrappedState",
        '"none" | "loading" | "value"',
      ),
    ]);
  });

  it("reports once per component or hook, even when several groups of flags are involved", () => {
    const lines = check(FLAGGED, ONLY).map((finding) => finding.location.start);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("reports nothing for independent flags, a reducer, other hooks or a nested component's own state", () => {
    expect(check(NOT_FLAGGED, ONLY)).toEqual([]);
  });

  it("is an add-on, off unless it is listed in addons", () => {
    expect(checkFixture(FLAGGED, [react()], ONLY).findings).toEqual([]);
  });

  it("is a warning, never an error, under every preset (a heuristic rule)", () => {
    const rule = ruleCode(react(), "flags-allow-impossible-combos");
    expect(rule.meta.tier).toBe("addon");
    expect(rule.meta.addon).toBe("flag-combos");
    expect(rule.meta.group).toBe("state");
    expect(rule.meta.heuristic).toBe(true);
    expect(rule.meta.defaultSeverity).toBe("warning");
    for (const preset of ["recommended", "strict"] as const) {
      const ours = checkWithPreset(FLAGGED, preset, ONLY, ADDONS).filter(
        (finding) => finding.ruleId === RULE,
      );
      expect(ours).toHaveLength(6);
      expect(
        ours.every((finding) => finding.kind === "problem" && finding.severity === "warning"),
      ).toBe(true);
    }
  });

  it("can be turned off", () => {
    const { findings } = checkFixture(FLAGGED, [react()], { ...ONLY, [RULE]: "off" }, ADDONS);
    expect(findings).toEqual([]);
  });

  it("explains itself, and names no helper library", () => {
    const explain = ruleCode(react(), "flags-allow-impossible-combos").meta.explain;
    expect(explain).toContain("# react/flags-allow-impossible-combos");
    expect(explain).toContain("## Bad");
    expect(explain).toContain("## Good");
    expect(explain).not.toContain("@stateward/states");
    expect(explain).toContain('addons: ["react/flag-combos"]');
    expect(explain).toContain('rules: { "react/flags-allow-impossible-combos": "off" }');
  });
});
