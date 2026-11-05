import { describe, expect, it } from "vitest";
import { reducers } from "../src/index.js";

describe("reducers", () => {
  it("is a plugin named reducers with its three rules and no editor contributions", () => {
    const plugin = reducers();
    expect(plugin.name).toBe("reducers");
    expect(Object.keys(plugin.rules)).toEqual([
      "state-cannot-leave",
      "reducer-not-readable",
      "state-unreachable",
    ]);
    expect(plugin.editor).toBeUndefined();
    expect(plugin.description).toBe(
      "A reducer reaches every state it declares and can leave every state it enters.",
    );
  });

  it("makes the three rules project rules of the graph group, with the planned tiers and severities", () => {
    const rules = reducers().rules;
    expect(
      Object.entries(rules).map(([key, rule]) => [
        key,
        // The kind the pack declares; its code loads when the rule is on.
        rule.ruleKind,
        rule.meta.tier,
        rule.meta.group,
        rule.meta.defaultSeverity,
      ]),
    ).toEqual([
      ["state-cannot-leave", "project", "core", "graph", "warning"],
      ["reducer-not-readable", "project", "coverage", "graph", "info"],
      ["state-unreachable", "project", "core", "graph", "error"],
    ]);
  });
});
