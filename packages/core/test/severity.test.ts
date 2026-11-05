import { describe, expect, it } from "vitest";
import { addonNames, groupIds, ruleSetting } from "../src/internal.js";
import type { Config, RuleMeta } from "../src/internal.js";
import { meta as baseMeta, plugin } from "./probe-plugin.js";
import { callProbe } from "./probe-plugin.js";

type Settings = Pick<Config, "preset" | "addons" | "rules" | "groups">;

const recommended: Settings = { preset: "recommended", addons: [], rules: {}, groups: {} };
const strict: Settings = { ...recommended, preset: "strict" };

function meta(change: Partial<RuleMeta>): RuleMeta {
  return { ...baseMeta, defaultSeverity: "error", ...change };
}

const addon = meta({ tier: "addon", addon: "extras" });

describe("ruleSetting", () => {
  it("runs a core rule at its default severity under both presets", () => {
    const warning = meta({ tier: "core", defaultSeverity: "warning" });
    expect(ruleSetting(recommended, "p", "r", meta({ tier: "core" }))).toBe("error");
    expect(ruleSetting(strict, "p", "r", meta({ tier: "core" }))).toBe("error");
    expect(ruleSetting(recommended, "p", "r", warning)).toBe("warning");
  });

  it("turns nothing on without a preset, until a group, a rule or an add-on names it", () => {
    const none: Settings = { ...recommended, preset: undefined };
    for (const tier of ["core", "coverage"] as const) {
      expect(ruleSetting(none, "p", "r", meta({ tier }))).toBe("off");
    }
    expect(ruleSetting({ ...none, groups: { "p/probes": "warning" } }, "p", "r", meta({}))).toBe(
      "warning",
    );
    expect(ruleSetting({ ...none, rules: { "p/r": "info" } }, "p", "r", meta({}))).toBe("info");
    expect(ruleSetting({ ...none, addons: ["p/extras"] }, "p", "r", addon)).toBe("error");
  });

  it("runs a coverage rule as info under recommended and as an error under strict", () => {
    const coverage = meta({ tier: "coverage", defaultSeverity: "warning" });
    expect(ruleSetting(recommended, "p", "r", coverage)).toBe("info");
    expect(ruleSetting(strict, "p", "r", coverage)).toBe("error");
  });

  it("keeps an add-on rule off until its add-on is listed, then uses its default severity", () => {
    expect(ruleSetting(recommended, "p", "r", addon)).toBe("off");
    expect(ruleSetting(strict, "p", "r", addon)).toBe("off");
    expect(ruleSetting({ ...recommended, addons: ["q/extras"] }, "p", "r", addon)).toBe("off");
    expect(ruleSetting({ ...recommended, addons: ["p/extras"] }, "p", "r", addon)).toBe("error");
    expect(ruleSetting({ ...strict, addons: ["p/extras"] }, "p", "r", addon)).toBe("error");
  });

  it("lets an explicit setting win over tier, preset and add-on", () => {
    const rules = { "p/r": "warning" } as const;
    expect(ruleSetting({ ...strict, rules }, "p", "r", meta({ tier: "coverage" }))).toBe("warning");
    expect(ruleSetting({ ...recommended, rules }, "p", "r", addon)).toBe("warning");
    expect(
      ruleSetting({ ...recommended, rules: { "p/r": "off" } }, "p", "r", meta({ tier: "core" })),
    ).toBe("off");
    expect(
      ruleSetting(
        { ...recommended, rules: { "p/other": "off" } },
        "p",
        "r",
        meta({ tier: "core" }),
      ),
    ).toBe("error");
  });

  it("caps a heuristic rule at warning, but never raises one and never overrides the user", () => {
    const heuristicCore = meta({ tier: "core", heuristic: true });
    const heuristicCoverage = meta({ tier: "coverage", heuristic: true });
    const heuristicAddon = meta({ tier: "addon", addon: "extras", heuristic: true });
    const listed = { ...strict, addons: ["p/extras"] };
    expect(ruleSetting(recommended, "p", "r", heuristicCore)).toBe("warning");
    expect(ruleSetting(strict, "p", "r", heuristicCoverage)).toBe("warning");
    expect(ruleSetting(recommended, "p", "r", heuristicCoverage)).toBe("info");
    expect(ruleSetting(listed, "p", "r", heuristicAddon)).toBe("warning");
    expect(ruleSetting(recommended, "p", "r", heuristicAddon)).toBe("off");
    expect(
      ruleSetting({ ...recommended, rules: { "p/r": "error" } }, "p", "r", heuristicCore),
    ).toBe("error");
  });
});

describe("ruleSetting with groups", () => {
  const core = meta({ tier: "core", group: "switches" });
  const groups = { "p/switches": "warning" } as const;

  it("lets a group setting win over the tier, the preset and a heuristic cap", () => {
    expect(ruleSetting({ ...recommended, groups }, "p", "r", core)).toBe("warning");
    expect(
      ruleSetting(
        { ...strict, groups: { "p/switches": "info" } },
        "p",
        "r",
        meta({ tier: "coverage", group: "switches" }),
      ),
    ).toBe("info");
    const heuristic = meta({ tier: "core", group: "switches", heuristic: true });
    expect(
      ruleSetting({ ...recommended, groups: { "p/switches": "error" } }, "p", "r", heuristic),
    ).toBe("error");
  });

  it("turns a whole group off", () => {
    expect(ruleSetting({ ...recommended, groups: { "p/switches": "off" } }, "p", "r", core)).toBe(
      "off",
    );
  });

  it("lets a group setting turn on an add-on rule whose add-on is not listed", () => {
    const extra = meta({ tier: "addon", addon: "extras", group: "switches" });
    expect(ruleSetting({ ...recommended, groups }, "p", "r", extra)).toBe("warning");
  });

  it("lets an explicit rule setting win over its group", () => {
    const rules = { "p/r": "error" } as const;
    expect(
      ruleSetting({ ...recommended, rules, groups: { "p/switches": "off" } }, "p", "r", core),
    ).toBe("error");
    expect(ruleSetting({ ...recommended, rules: { "p/r": "off" }, groups }, "p", "r", core)).toBe(
      "off",
    );
  });

  it("falls back to the defaults for a rule whose group, plugin or key is not set", () => {
    expect(
      ruleSetting({ ...recommended, groups }, "p", "r", meta({ tier: "core", group: "lookups" })),
    ).toBe("error");
    expect(ruleSetting({ ...recommended, groups }, "q", "r", core)).toBe("error");
    expect(
      ruleSetting({ ...recommended, groups, rules: { "p/other": "off" } }, "p", "r", core),
    ).toBe("warning");
  });
});

describe("groupIds", () => {
  it("lists each group once as <plugin>/<group>, in the order of its first rule", () => {
    const rule = (group: string) => ({ ...callProbe, meta: meta({ group }) });
    const a = plugin({ one: rule("b-group"), two: rule("a-group"), three: rule("b-group") });
    expect(groupIds([a, { ...a, name: "other" }])).toEqual([
      "probe/b-group",
      "probe/a-group",
      "other/b-group",
      "other/a-group",
    ]);
    expect(groupIds([])).toEqual([]);
  });
});

describe("addonNames", () => {
  it("lists each add-on of each plugin once, sorted", () => {
    const two = { ...callProbe, meta: meta({ tier: "addon", addon: "b-extras" }) };
    const one = { ...callProbe, meta: addon };
    const again = { ...callProbe, meta: addon };
    const core = { ...callProbe, meta: meta({ tier: "core" }) };
    expect(addonNames([plugin({ two, one, again, core })])).toEqual([
      "probe/b-extras",
      "probe/extras",
    ]);
    expect(addonNames([])).toEqual([]);
  });
});
