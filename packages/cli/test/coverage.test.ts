import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckResult, Config, Finding, Plugin, Rule } from "@stateward/core/internal";
import { buildCoverage, formatCoveragePretty } from "../src/coverage.js";

const meta = { description: "d", defaultSeverity: "error", explain: "e", group: "g" } as const;
const rule = (tier: "core" | "coverage"): Rule => ({
  kind: "file",
  meta: { ...meta, tier },
  check: () => undefined,
});
const plugin = (name: string, rules: Record<string, Rule>): Plugin => ({
  name,
  description: `${name} description`,
  rules,
});

const cwd = path.resolve("/work");
const file = path.join(cwd, "src", "a.ts");
const location = { file, start: 4, end: 5 };
const config: Config = {
  tsconfig: [path.join(cwd, "tsconfig.json")],
  include: [],
  exclude: [],
  replacesDefaultExclude: false,
  warnings: [],
  overrides: [],
  ignores: { requireReason: true, reportUnused: "warning" },
  unknowns: "info",
  maxMemory: undefined,
  preset: "recommended",
  addons: [],
  rules: {},
  groups: {},
  ruleOptions: {},
  rollout: false,
  facts: {},
  configDir: cwd,
  plugins: [
    plugin("one", { core: rule("core"), cover: rule("coverage") }),
    plugin("two", { core: rule("core") }),
  ],
};

const problem = (ruleId: string, message: string): Finding => ({
  kind: "problem",
  ruleId,
  severity: "error",
  message,
  hint: `fix ${message}`,
  location,
  related: [],
  fixes: [],
});

function result(findings: Finding[], hidden: CheckResult["hidden"] = []): CheckResult {
  return { findings, hidden, stats: { files: 1, durationMs: 0 } };
}

const readText = (): string => "ab\nxyz\n";

describe("buildCoverage", () => {
  it("sorts findings into outside the standard (coverage rules, unknown) and problems, per plugin", () => {
    const report = buildCoverage({
      config,
      cwd,
      readText,
      result: result([
        problem("one/core", "c1"),
        problem("one/cover", "v1"),
        { kind: "unknown", ruleId: "one/core", message: "u1", hint: "make it checkable", location },
        problem("two/core", "c2"),
        problem("two/core", "c3"),
        { kind: "failure", ruleId: "two/core", message: "boom", hint: "h", location },
      ]),
    });
    expect(report.plugins.map((p) => [p.plugin, p.description, p.problems])).toEqual([
      ["one", "one description", 1],
      ["two", "two description", 2],
    ]);
    expect(report.plugins[0]?.outside).toEqual([
      {
        ruleId: "one/cover",
        kind: "problem",
        file: "src/a.ts",
        line: 2,
        column: 2,
        message: "v1",
        hint: "fix v1",
      },
      {
        ruleId: "one/core",
        kind: "unknown",
        file: "src/a.ts",
        line: 2,
        column: 2,
        message: "u1",
        hint: "make it checkable",
      },
    ]);
    expect(report.failures).toEqual([{ ruleId: "two/core", message: "boom" }]);
  });

  it("counts findings beyond the per-file cap without listing them", () => {
    const report = buildCoverage({
      config,
      cwd,
      readText,
      result: result(
        [],
        [
          { file, ruleId: "one/cover", count: 3 },
          { file, ruleId: "two/core", count: 2 },
        ],
      ),
    });
    expect(report.plugins.map((p) => [p.outside.length, p.outsideNotListed, p.problems])).toEqual([
      [0, 3, 0],
      [0, 0, 2],
    ]);
    expect(formatCoveragePretty(report)).toContain("3 places it cannot check yet");
    expect(formatCoveragePretty(report)).toContain("… and 3 more not listed");
  });

  it("says baselined findings on their own line, never as problems", () => {
    const report = buildCoverage({
      config,
      cwd,
      readText,
      result: result([problem("two/core", "c2")]),
      baselined: 3,
    });
    expect(report.plugins.map((p) => p.problems)).toEqual([0, 1]);
    expect(report.baselined).toBe(3);
    expect(formatCoveragePretty(report)).toContain("3 findings baselined, not counted above");
    expect(
      formatCoveragePretty(buildCoverage({ config, cwd, readText, result: result([]) })),
    ).not.toContain("baselined");
  });

  it("falls back to line 1, column 1 when the file cannot be read", () => {
    const report = buildCoverage({
      config,
      cwd,
      readText: () => undefined,
      result: result([problem("one/cover", "v1")]),
    });
    expect(report.plugins[0]?.outside[0]).toMatchObject({ line: 1, column: 1 });
  });
});

describe("buildCoverage: rules that are silent", () => {
  it("lists the reason under the plugin that owns the rule", () => {
    const report = buildCoverage({
      config,
      cwd,
      readText,
      result: result([]),
      silent: new Map([["two/core", "your app's root has an error boundary"]]),
    });
    expect(report.plugins.map((p) => p.silent)).toEqual([
      [],
      [{ ruleId: "two/core", reason: "your app's root has an error boundary" }],
    ]);
    expect(formatCoveragePretty(report)).toContain(
      "two/core is on and silent: your app's root has an error boundary",
    );
  });
});
