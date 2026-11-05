import path from "node:path";
import { describe, expect, it } from "vitest";
import { advance, buildPlan, parseConfig } from "../src/internal.js";
import type { CheckResult, Config, Finding, FileRule, Plugin, RuleTier } from "../src/internal.js";

const cwd = path.resolve("/work");
const rule = (tier: RuleTier, description = "d"): FileRule => ({
  kind: "file",
  meta: {
    description,
    defaultSeverity: "error",
    tier,
    group: "g",
    explain: "e",
    ...(tier === "addon" ? { addon: "extra" } : {}),
  },
  check: () => undefined,
});
const pack = (name: string, rules: Record<string, FileRule>): Plugin => ({
  name,
  description: name,
  rules,
});

function configOf(plugins: readonly Plugin[], extra: Record<string, unknown> = {}): Config {
  const parsed = parseConfig({ preset: "recommended", plugins, ...extra }, cwd);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

const place = { file: path.join(cwd, "a.ts"), start: 0, end: 1 };
function problems(ruleId: string, count: number, fixable: number): Finding[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "problem",
    ruleId,
    severity: "error",
    message: "m",
    hint: "h",
    location: place,
    related: [],
    fixes: index < fixable ? [{ title: "t", edits: [] }] : [],
  }));
}
const resultOf = (findings: Finding[], hidden: CheckResult["hidden"] = []): CheckResult => ({
  findings,
  hidden,
  stats: { files: 1, durationMs: 1 },
});
const ids = (config: Config, result: CheckResult): string[] =>
  buildPlan(config, result).rules.map((row) => row.ruleId);

describe("buildPlan: groups", () => {
  it("gives each row its group as <plugin>/<group>", () => {
    const grouped: FileRule = { ...rule("core"), meta: { ...rule("core").meta, group: "sw" } };
    const config = configOf([pack("a", { x: grouped, y: rule("core") })]);
    const rows = buildPlan(config, resultOf([])).rules;
    expect(rows.map((row) => [row.ruleId, row.group])).toEqual([
      ["a/x", "a/sw"],
      ["a/y", "a/g"],
    ]);
  });

  it("leaves out the rules of a group that the config turns off", () => {
    const config = configOf([pack("a", { x: rule("core") })], { groups: { "a/g": "off" } });
    expect(ids(config, resultOf([]))).toEqual([]);
  });
});

describe("buildPlan: order", () => {
  const config = configOf(
    [
      pack("a", { core1: rule("core"), core2: rule("core"), cover: rule("coverage") }),
      pack("b", { core3: rule("core"), core4: rule("core"), plus: rule("addon") }),
    ],
    { addons: ["b/extra"] },
  );

  it("puts core before coverage before add-ons, whatever the counts", () => {
    const result = resultOf([...problems("b/plus", 9, 9), ...problems("a/cover", 5, 5)]);
    expect(ids(config, result).slice(-2)).toEqual(["a/cover", "b/plus"]);
  });

  it("orders a tier by fewest findings, then most fixable, then pack order, then rule id", () => {
    const result = resultOf([
      ...problems("a/core1", 6, 2),
      ...problems("a/core2", 4, 3),
      ...problems("b/core3", 3, 2),
      ...problems("b/core4", 3, 2),
    ]);
    // core3 and core4 (3 findings, 2 fixable, by rule id), then core2 (4), then core1 (6)
    expect(ids(config, result).slice(0, 4)).toEqual(["b/core3", "b/core4", "a/core2", "a/core1"]);
  });

  it("breaks a full tie by pack order, then by rule id", () => {
    const tie = configOf([
      pack("z", { b: rule("core"), a: rule("core") }),
      pack("y", { c: rule("core") }),
    ]);
    expect(ids(tie, resultOf([]))).toEqual(["z/a", "z/b", "y/c"]);
  });

  it("lists a rule with no findings, with zeros", () => {
    const plan = buildPlan(config, resultOf(problems("a/core1", 1, 1)));
    expect(plan.rules).toHaveLength(6);
    expect(plan.rules[0]).toMatchObject({ order: 1, findings: 0, fixable: 0, protects: "d" });
    expect(plan.rules.find((row) => row.ruleId === "a/core1")).toMatchObject({
      findings: 1,
      fixable: 1,
    });
  });

  it("counts findings past the per-file cap, and does not guess that they are fixable", () => {
    const result = resultOf(problems("a/core1", 2, 2), [
      { file: place.file, ruleId: "a/core1", count: 7 },
    ]);
    const row = buildPlan(config, result).rules.find((r) => r.ruleId === "a/core1");
    expect(row).toMatchObject({ findings: 9, fixable: 2 });
  });

  it("ignores unknown findings and leaves out rules the config switches off", () => {
    const off = configOf([pack("a", { x: rule("core"), y: rule("core") })], {
      rules: { "a/y": "off" },
    });
    expect(ids(off, resultOf([]))).toEqual(["a/x"]);
    expect(ids(configOf([pack("b", { plus: rule("addon") })]), resultOf([]))).toEqual([]);
    const unknown: Finding = {
      kind: "unknown",
      ruleId: "a/x",
      message: "m",
      hint: "h",
      location: place,
    };
    expect(buildPlan(off, resultOf([unknown])).rules[0]?.findings).toBe(0);
  });
});

describe("advance", () => {
  const config = configOf([
    pack("a", { one: rule("core"), two: rule("core"), three: rule("core") }),
  ]);
  const plan = buildPlan(
    config,
    resultOf([...problems("a/one", 3, 3), ...problems("a/two", 1, 0)]),
  );
  // plan order: three (clean), two (1 finding), one (3 findings)

  it("turns on the first rule with findings, and every clean rule with it", () => {
    expect(advance(plan, [], false)).toMatchObject({
      kind: "turn-on",
      row: { ruleId: "a/two" },
      clean: [{ ruleId: "a/three" }],
    });
  });

  it("turns on the clean rules alone when no rule with findings is left", () => {
    const allClean = buildPlan(config, resultOf([]));
    expect(advance(allClean, [], false)).toMatchObject({ kind: "turn-on", row: undefined });
    const step = advance(allClean, [], false);
    expect(step.kind === "turn-on" ? step.clean.length : 0).toBe(3);
  });

  it("refuses to move on while the last rule turned on has findings", () => {
    expect(advance(plan, ["a/one"], false)).toMatchObject({
      kind: "blocked",
      row: { ruleId: "a/one", findings: 3 },
    });
  });

  it("moves on anyway when asked", () => {
    expect(advance(plan, ["a/one"], true)).toMatchObject({ kind: "turn-on" });
  });

  it("moves on once the last rule is clean, to the next rule that has findings", () => {
    const clean = buildPlan(config, resultOf(problems("a/two", 1, 0)));
    const [first, second] = clean.rules;
    expect(advance(clean, [first?.ruleId ?? ""], false)).toMatchObject({
      kind: "turn-on",
      row: { ruleId: "a/two" },
      clean: [{ ruleId: second?.ruleId }],
    });
  });

  it("only looks at the rule turned on last", () => {
    expect(advance(plan, ["a/one", "a/three"], false)).toMatchObject({
      kind: "turn-on",
      row: { ruleId: "a/two" },
    });
  });

  it("says every rule is on, even with findings left", () => {
    expect(
      advance(
        plan,
        plan.rules.map((row) => row.ruleId),
        false,
      ),
    ).toEqual({ kind: "all-on" });
  });
});

describe("buildPlan: rules that are silent for a known reason", () => {
  it("puts the reason on the row of the rule, and on no other", () => {
    const config = configOf([pack("one", { a: rule("core"), b: rule("core") })]);
    const plan = buildPlan(
      config,
      resultOf([]),
      new Map([["one/a", "your app's root has an error boundary"]]),
    );
    expect(plan.rules.map((row) => [row.ruleId, row.silent])).toEqual([
      ["one/a", "your app's root has an error boundary"],
      ["one/b", undefined],
    ]);
  });
});
