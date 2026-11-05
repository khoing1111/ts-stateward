import { describe, expect, it } from "vitest";
import { ownership } from "../src/index.js";
import { ruleCode } from "@stateward/core/testing";

describe("ownership", () => {
  it("is a plugin named ownership with its two rules, one group, and no editor contributions", () => {
    const plugin = ownership();
    expect(plugin.name).toBe("ownership");
    expect(Object.keys(plugin.rules)).toEqual([
      "state-written-outside-owner",
      "brand-built-outside-owner",
    ]);
    expect(plugin.editor).toBeUndefined();
    expect(plugin.description).toBe(
      "One owner per piece of shared state and per brand: others call the owner's functions.",
    );
  });

  it("makes brand-built-outside-owner a core file rule of the owners group, an error by default", () => {
    const rule = ruleCode(ownership(), "brand-built-outside-owner");
    expect(rule.kind).toBe("file");
    expect(rule.meta.defaultSeverity).toBe("error");
    expect(rule.meta.tier).toBe("core");
    expect(rule.meta.group).toBe("owners");
    expect(rule.meta.explain).toContain("# ownership/brand-built-outside-owner");
    expect(rule.meta.explain).toContain('rules: { "ownership/brand-built-outside-owner": "off" }');
  });

  it("makes state-written-outside-owner a core project rule of the owners group, an error by default", () => {
    const rule = ruleCode(ownership(), "state-written-outside-owner");
    expect(rule.kind).toBe("project");
    expect(rule.meta.defaultSeverity).toBe("error");
    expect(rule.meta.tier).toBe("core");
    expect(rule.meta.group).toBe("owners");
    expect(rule.meta.description.length).toBeGreaterThan(0);
    expect(rule.meta.explain).toContain("# ownership/state-written-outside-owner");
    expect(rule.meta.explain).toContain("## Bad");
    expect(rule.meta.explain).toContain("## Good");
    expect(rule.meta.explain).toContain(
      'rules: { "ownership/state-written-outside-owner": "off" }',
    );
  });
});
