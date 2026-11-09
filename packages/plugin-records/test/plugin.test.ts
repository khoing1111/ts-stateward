import { describe, expect, it } from "vitest";
import { parseConfig, type RuleConfig } from "@stateward/core";
import { checkFixture, ruleCode } from "@stateward/core/testing";
import { records } from "../src/index.js";
import { fixture } from "./helpers.js";

describe("records", () => {
  it("is a plugin named records with its rules, one group, and no editor contributions", () => {
    const plugin = records();
    expect(plugin.name).toBe("records");
    expect(Object.keys(plugin.rules)).toEqual([
      "lookup-misses-key",
      "ambiguous-table",
      "duplicate-key",
      "unchecked-key",
    ]);
    expect(Object.values(plugin.rules).map((rule) => rule.meta.group)).toEqual([
      "keys",
      "keys",
      "keys",
      "keys",
    ]);
    expect(plugin.editor).toBeUndefined();
    expect(plugin.description).toBe(
      "Lookup tables and records keyed by a union have every key, once, under a type that names them.",
    );
  });

  it.each(["lookup-misses-key", "duplicate-key"] as const)(
    "makes %s a core file rule, an error under the default preset",
    (key) => {
      const rule = ruleCode(records(), key);
      expect(rule.kind).toBe("file");
      expect(rule.meta.tier).toBe("core");
      expect(rule.meta.explain).toContain(`# records/${key}`);
      expect(rule.meta.explain).toContain(`rules: { "records/${key}": "off" }`);
      const { findings } = checkFixture(fixture(`${key}/flagged`), [records()]);
      const own = findings.filter((finding) => finding.ruleId === `records/${key}`);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((f) => f.kind === "problem" && f.severity === "error")).toBe(true);
      const off = checkFixture(fixture(`${key}/flagged`), [records()], {
        [`records/${key}`]: "off",
      }).findings;
      expect(off.filter((finding) => finding.ruleId === `records/${key}`)).toEqual([]);
    },
  );

  it("makes unchecked-key an add-on project rule, a warning once its add-on is listed", () => {
    const rule = ruleCode(records(), "unchecked-key");
    expect(rule.kind).toBe("project");
    expect(rule.meta.defaultSeverity).toBe("warning");
    expect(rule.meta.tier).toBe("addon");
    expect(rule.meta.addon).toBe("unchecked-key");
    const off = checkFixture(fixture("unchecked-key/flagged"), [records()]);
    expect(off.findings.filter((f) => f.ruleId === "records/unchecked-key")).toEqual([]);
    const { findings } = checkFixture(fixture("unchecked-key/flagged"), [records()], {}, [
      "records/unchecked-key",
    ]);
    const own = findings.filter((finding) => finding.ruleId === "records/unchecked-key");
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((f) => f.kind === "problem" && f.severity === "warning")).toBe(true);
  });

  it("makes ambiguous-table a core project rule, an error by default", () => {
    const rule = ruleCode(records(), "ambiguous-table");
    expect(rule.kind).toBe("project");
    expect(rule.meta.defaultSeverity).toBe("error");
    expect(rule.meta.tier).toBe("core");
    expect(rule.meta.description.length).toBeGreaterThan(0);
    const explain = rule.meta.explain;
    expect(explain).toContain("# records/ambiguous-table");
    expect(explain).toContain("example-bad");
    expect(explain).toContain("example-good");
    expect(explain).toContain('rules: { "records/ambiguous-table": "off" }');
  });

  it("reports nothing once switched off", () => {
    const { findings } = checkFixture(fixture("ambiguous-table/flagged"), [records()], {
      "records/ambiguous-table": "off",
    });
    expect(findings.filter((f) => f.ruleId === "records/ambiguous-table")).toEqual([]);
  });

  it("reports as an error under the default preset", () => {
    const { findings } = checkFixture(fixture("ambiguous-table/flagged"), [records()]);
    const own = findings.filter((f) => f.ruleId === "records/ambiguous-table");
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((f) => f.kind === "problem" && f.severity === "error")).toBe(true);
  });
});

describe("records: one cause, one message", () => {
  it("leaves out a lookup into a table that ambiguous-table reports, and only then", () => {
    const dir = fixture("ambiguous-table/flagged");
    const lookups = (rules: Record<string, RuleConfig>): number =>
      checkFixture(dir, [records()], rules).findings.filter(
        (finding) => finding.ruleId === "records/lookup-misses-key",
      ).length;
    const alone = lookups({ "records/ambiguous-table": "off" });
    expect(alone).toBeGreaterThan(0);
    expect(lookups({})).toBeLessThan(alone);
    expect(ruleCode(records(), "lookup-misses-key").meta.yieldsTo).toEqual(["ambiguous-table"]);
  });
});

describe("records/ambiguous-table option `ignore`", () => {
  const dir = fixture("ambiguous-table/ignored");
  const named = (rules: Record<string, RuleConfig>): string[] =>
    checkFixture(dir, [records()], rules).findings.flatMap((finding) =>
      finding.kind === "problem" && finding.ruleId === "records/ambiguous-table"
        ? [finding.message.split("`")[1] ?? ""]
        : [],
    );

  it("reports every record when nothing is ignored", () => {
    expect(named({})).toEqual(["ERROR_MESSAGES", "legacy", "titles"]);
  });

  it("skips the names and globs listed", () => {
    expect(
      named({ "records/ambiguous-table": ["error", { ignore: ["*_MESSAGES", "legacy"] }] }),
    ).toEqual(["titles"]);
  });

  it("treats the dot and other characters of a name literally", () => {
    expect(
      named({ "records/ambiguous-table": ["error", { ignore: ["l.gacy", "t?tles"] }] }),
    ).toEqual(["ERROR_MESSAGES", "legacy", "titles"]);
  });

  it("rejects a bad value in the config, naming the rule and the option", () => {
    const result = parseConfig(
      { plugins: [records()], rules: { "records/ambiguous-table": ["error", { ignore: 3 }] } },
      fixture("ambiguous-table/ignored"),
    );
    expect(result).toEqual({
      ok: false,
      errors: ['rules["records/ambiguous-table"].ignore must be a list of strings, got 3'],
    });
  });
});
