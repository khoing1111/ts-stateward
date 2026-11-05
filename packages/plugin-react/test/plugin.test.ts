import { describe, expect, it } from "vitest";
import { react } from "../src/index.js";

describe("react", () => {
  it("is a plugin named react with the rules of three groups: render, effects and state", () => {
    const plugin = react();
    expect(plugin.name).toBe("react");
    expect(Object.keys(plugin.rules)).toEqual([
      "dependency-changes-every-render",
      "provider-value-changes-every-render",
      "effect-copies-derived-value",
      "state-copies-prop",
      "effect-loops",
      "effect-missing-cleanup",
      "effect-response-race",
      "timer-runs-after-unmount",
      "closure-reads-stale-state",
      "index-key-on-reordered-list",
      "flags-allow-impossible-combos",
    ]);
    expect(plugin.editor).toBeUndefined();
  });

  it("gives each rule its kind, tier, group and severity; effect-response-race is a heuristic add-on, and index-key a heuristic core rule", () => {
    expect(
      Object.entries(react().rules).map(([key, rule]) => [
        key,
        // The kind the pack declares; its code loads when the rule is on.
        rule.ruleKind,
        rule.meta.tier,
        rule.meta.group,
        rule.meta.defaultSeverity,
        rule.meta.addon ?? null,
        rule.meta.heuristic ?? false,
      ]),
    ).toEqual([
      ["dependency-changes-every-render", "project", "core", "render", "warning", null, false],
      ["provider-value-changes-every-render", "file", "core", "render", "warning", null, false],
      ["effect-copies-derived-value", "file", "core", "effects", "warning", null, false],
      ["state-copies-prop", "file", "core", "state", "warning", null, false],
      ["effect-loops", "file", "core", "effects", "error", null, false],
      ["effect-missing-cleanup", "file", "core", "effects", "warning", null, false],
      ["effect-response-race", "file", "addon", "effects", "warning", "effect-race", true],
      ["timer-runs-after-unmount", "file", "core", "effects", "warning", null, false],
      ["closure-reads-stale-state", "file", "core", "state", "warning", null, false],
      ["index-key-on-reordered-list", "file", "core", "render", "warning", null, true],
      ["flags-allow-impossible-combos", "file", "addon", "state", "warning", "flag-combos", true],
    ]);
  });
});
