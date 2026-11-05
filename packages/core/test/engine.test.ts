import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { Config, Finding, Json, Rule } from "../src/internal.js";
import {
  MAX_FINDINGS_PER_RULE_PER_FILE,
  TsconfigError,
  check,
  explain,
  missingDefaultLib,
  parseConfig,
} from "../src/internal.js";
import { checkFixture } from "../src/testing.js";
import { fixturePath, posix, withPosixFile } from "./fixture-path.js";
import { callProbe, meta, plugin } from "./probe-plugin.js";

const probe = plugin({ calls: callProbe });
const probeDir = fixturePath("probe");
const FAILURE_HINT = "report this to the rule's authors; the rest of the check ran normally";

function messages(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.message);
}

function configFor(rules: Record<string, Rule>, settings = {}): Config {
  const parsed = parseConfig(
    { preset: "recommended", plugins: [plugin(rules)], rules: settings },
    probeDir,
  );
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

function isAnyValue(value: unknown): value is Json {
  return typeof value === "object";
}

describe("check: tiers, presets and add-ons", () => {
  const coverage: Rule = { ...callProbe, meta: { ...meta, tier: "coverage" } };
  const extra: Rule = { ...callProbe, meta: { ...meta, tier: "addon", addon: "extras" } };

  function severities(settings: Record<string, unknown>): (string | undefined)[] {
    const parsed = parseConfig(
      { preset: "recommended", plugins: [plugin({ coverage, extra })], ...settings },
      probeDir,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const { findings } = check({ config: parsed.value, cwd: probeDir });
    return [
      ...new Set(
        findings.map((f) => (f.kind === "problem" ? `${f.ruleId}:${f.severity}` : undefined)),
      ),
    ];
  }

  it("runs coverage rules as info under recommended and keeps add-ons off", () => {
    expect(severities({})).toEqual(["probe/coverage:info"]);
  });

  it("runs coverage rules as errors under strict", () => {
    expect(severities({ preset: "strict" })).toEqual(["probe/coverage:error"]);
  });

  it("runs an add-on's rules once its add-on is listed", () => {
    expect(severities({ addons: ["probe/extras"] })).toEqual([
      "probe/coverage:info",
      "probe/extra:warning",
    ]);
  });
});

describe("check: symbol ids and add-ons", () => {
  const ids: Rule = {
    kind: "file",
    meta,
    check(ctx) {
      if (!ctx.file.endsWith("b.ts")) return;
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node)) {
          for (const name of [node.expression, node.name]) {
            const symbol = ctx.types.symbolAt(name);
            if (symbol) ctx.report({ node, hint: "h", message: path.basename(symbol.id) });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ctx.sourceFile);
    },
  };

  it("names a module and a declaration in it by qualified ids", () => {
    const { findings } = checkFixture(fixturePath("ids"), [plugin({ ids })]);
    expect(messages(findings)).toEqual(["a.ts#", "a.ts#first"]);
  });

  it("gives a rule the add-ons of its own plugin, without the prefix", () => {
    const seen: string[] = [];
    const reader: Rule = {
      kind: "file",
      meta: { ...meta, widenedBy: ["wide"] },
      check(ctx) {
        seen.push(ctx.addons.join(","));
      },
    };
    checkFixture(probeDir, [plugin({ reader })], {}, ["probe/wide"]);
    checkFixture(probeDir, [plugin({ reader })]);
    expect([...new Set(seen)]).toEqual(["wide", ""]);
  });

  it("refuses an add-on that no loaded rule offers or is widened by", () => {
    expect(() => checkFixture(probeDir, [probe], {}, ["probe/wide"])).toThrow(
      /unknown add-on "probe\/wide"/,
    );
  });
});

describe("check", () => {
  it("answers type queries through the backend, resolving aliases", () => {
    const { findings } = checkFixture(probeDir, [probe]);
    expect(messages(findings)).toEqual([
      'hello|greet|a.ts|true|"x"',
      "pick|pick|a.ts|true|1",
      "pick|pick|a.ts|true|1,2",
      "hello|greet|a.ts|true|not-finite",
      "String|String|lib.es5.d.ts|false|not-finite",
    ]);
  });

  it("reports problems with a file location, the default severity and no fixes", () => {
    const { findings } = checkFixture(probeDir, [probe]);
    const first = findings[0];
    expect(first && withPosixFile(first)).toEqual({
      kind: "problem",
      ruleId: "probe/calls",
      severity: "warning",
      message: 'hello|greet|a.ts|true|"x"',
      hint: "probe hint",
      location: { file: posix(path.join(probeDir, "b.ts")), start: 69, end: 79 },
      related: [],
      fixes: [],
    });
  });

  it("checks only own files: not excluded, not .d.ts, not node_modules", () => {
    const rule: Rule = {
      kind: "file",
      meta,
      check: (ctx) => {
        ctx.report({ message: path.basename(ctx.file), hint: "h", node: ctx.sourceFile });
      },
    };
    const result = checkFixture(probeDir, [plugin({ files: rule })]);
    expect(messages(result.findings)).toEqual(["a.ts", "b.ts"]);
    expect(result.stats.files).toBe(2);
  });

  it("overrides severity and skips rules that are off", () => {
    const error = checkFixture(probeDir, [probe], { "probe/calls": "error" });
    expect(error.findings.every((f) => f.kind === "problem" && f.severity === "error")).toBe(true);
    const off = checkFixture(probeDir, [probe], { "probe/calls": "off" });
    expect(off.findings).toEqual([]);
  });

  it("keeps only the first line of a throwing rule's error, so the headline stays one line", () => {
    const throwing: Rule = {
      kind: "file",
      meta,
      check: () => {
        throw new Error("boom\n    at somewhere (file.ts:1:1)");
      },
    };
    const { findings } = checkFixture(probeDir, [plugin({ throwing })]);
    expect(findings.map((f) => f.message)).toEqual([
      "rule probe/throwing failed: boom",
      "rule probe/throwing failed: boom",
    ]);
  });

  it("turns a throwing rule into a failure finding that names the rule", () => {
    const throwing: Rule = {
      kind: "file",
      meta,
      check: () => {
        throw new Error("boom");
      },
    };
    const { findings } = checkFixture(probeDir, [plugin({ throwing })]);
    expect(findings.map(withPosixFile)).toEqual([
      {
        kind: "failure",
        ruleId: "probe/throwing",
        message: "rule probe/throwing failed: boom",
        hint: FAILURE_HINT,
        location: { file: posix(path.join(probeDir, "a.ts")), start: 0, end: 0 },
      },
      {
        kind: "failure",
        ruleId: "probe/throwing",
        message: "rule probe/throwing failed: boom",
        hint: FAILURE_HINT,
        location: { file: posix(path.join(probeDir, "b.ts")), start: 0, end: 0 },
      },
    ]);
  });

  it("reports unknowns from a rule as they are", () => {
    const undecided: Rule = {
      kind: "file",
      meta,
      check: (ctx) => {
        ctx.unknown({ message: "cannot tell", hint: "add a type", node: ctx.sourceFile });
      },
    };
    const { findings } = checkFixture(probeDir, [plugin({ undecided })]);
    expect(findings.map((f) => f.kind)).toEqual(["unknown", "unknown"]);
  });

  it("runs project rules as summarize per file, then one check", () => {
    const counting: Rule = {
      kind: "project",
      meta,
      summarize: (ctx) =>
        ctx.file.endsWith("b.ts") ? undefined : ctx.sourceFile.statements.length,
      check: (summaries, ctx) => {
        ctx.report({
          message: JSON.stringify([...summaries].map(([file, n]) => [path.basename(file), n])),
          hint: "h",
          location: { file: path.join(probeDir, "a.ts"), start: 1, end: 2 },
        });
        ctx.unknown({
          message: "undecided",
          hint: "decide",
          location: { file: path.join(probeDir, "a.ts"), start: 0, end: 0 },
        });
      },
    };
    const { findings } = checkFixture(probeDir, [plugin({ counting })]);
    expect(findings.map((f) => [f.kind, f.message])).toEqual([
      ["unknown", "undecided"],
      ["problem", '[["a.ts",2]]'],
    ]);
  });

  it("turns a throwing project check into a failure at the tsconfig", () => {
    const throwing: Rule = {
      kind: "project",
      meta,
      summarize: () => undefined,
      check: () => {
        throw new Error("late");
      },
    };
    const { findings } = checkFixture(probeDir, [plugin({ throwing })]);
    expect(findings.map(withPosixFile)).toEqual([
      {
        kind: "failure",
        ruleId: "probe/throwing",
        message: "rule probe/throwing failed: late",
        hint: FAILURE_HINT,
        location: { file: posix(path.join(probeDir, "tsconfig.json")), start: 0, end: 0 },
      },
    ]);
  });

  it("hands a project rule its summaries as JSON: a Map arrives as {}", () => {
    const received: unknown[] = [];
    const summarizing: Rule = {
      kind: "project",
      meta,
      summarize: () => {
        // A rule that breaks the Json contract; the guard lets the test say so without a cast.
        const smuggled: unknown = { plain: 1, nothing: undefined, map: new Map([["k", 1]]) };
        return isAnyValue(smuggled) ? smuggled : null;
      },
      check: (summaries) => {
        received.push(...summaries.values());
      },
    };
    checkFixture(probeDir, [plugin({ summarizing })]);
    expect(received).toEqual([
      { plain: 1, map: {} },
      { plain: 1, map: {} },
    ]);
  });

  it("gives a project rule the same findings whatever order the files were visited in", () => {
    const listing: Rule = {
      kind: "project",
      meta,
      summarize: (ctx) => path.basename(ctx.file),
      check: (summaries, ctx) => {
        ctx.report({
          message: JSON.stringify([...summaries.values()]),
          hint: "h",
          location: { file: path.join(probeDir, "a.ts"), start: 0, end: 0 },
        });
      },
    };
    const run = (tsconfig: string): readonly Finding[] => {
      const parsed = parseConfig(
        { preset: "recommended", plugins: [plugin({ listing })], tsconfig },
        probeDir,
      );
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      return check({ config: parsed.value, cwd: probeDir }).findings;
    };
    const forward = run("tsconfig.json");
    expect(messages(forward)).toEqual(['["a.ts","b.ts"]']);
    expect(run("tsconfig.reversed.json")).toEqual(forward);
  });

  it("lists the first 20 findings of a rule in a file and counts the rest as hidden", () => {
    const many = (count: number): Rule => ({
      kind: "file",
      meta,
      check: (ctx) => {
        if (!ctx.file.endsWith("a.ts")) return;
        for (let i = 0; i < count; i++)
          ctx.report({ message: `m${String(i)}`, hint: "h", node: ctx.sourceFile });
      },
    });
    const { findings, hidden } = checkFixture(probeDir, [
      plugin({
        b: many(MAX_FINDINGS_PER_RULE_PER_FILE + 5),
        a: many(MAX_FINDINGS_PER_RULE_PER_FILE),
      }),
    ]);
    expect(MAX_FINDINGS_PER_RULE_PER_FILE).toBe(20);
    expect(findings.filter((f) => f.ruleId === "probe/b")).toHaveLength(20);
    expect(findings.filter((f) => f.ruleId === "probe/a")).toHaveLength(20);
    expect(hidden.map((h) => ({ ...h, file: posix(h.file) }))).toEqual([
      { file: posix(path.join(probeDir, "a.ts")), ruleId: "probe/b", count: 5 },
    ]);
  });

  it("reports no hidden findings when nothing is over the limit", () => {
    expect(checkFixture(probeDir, [probe]).hidden).toEqual([]);
  });

  it("sorts findings by file, start, then rule id", () => {
    const at = (message: string, start: number): Rule => ({
      kind: "project",
      meta,
      summarize: () => undefined,
      check: (_summaries, ctx) => {
        ctx.report({
          message,
          hint: "h",
          location: { file: path.join(probeDir, "b.ts"), start, end: start },
        });
      },
    });
    const { findings } = checkFixture(probeDir, [
      plugin({ z: at("z at 5", 5), a: at("a at 5", 5), early: at("early", 1) }),
    ]);
    expect(messages(findings)).toEqual(["early", "a at 5", "z at 5"]);
  });

  it("serves overlays instead of the saved text", () => {
    const config = configFor({ calls: callProbe });
    const overlays = new Map([
      [path.join(probeDir, "b.ts"), 'import { greet } from "./a.js";\ngreet("o");\n'],
    ]);
    const { findings } = check({ config, cwd: probeDir, overlays });
    expect(messages(findings)).toEqual(['greet|greet|a.ts|true|"o"']);
  });

  it("serves overlays keyed by Windows-style paths (backslashes)", () => {
    const config = configFor({ calls: callProbe });
    const windowsStyle = path.join(probeDir, "b.ts").replaceAll("/", "\\");
    const overlays = new Map([[windowsStyle, 'import { greet } from "./a.js";\ngreet("w");\n']]);
    const { findings } = check({ config, cwd: probeDir, overlays });
    expect(messages(findings)).toEqual(['greet|greet|a.ts|true|"w"']);
  });

  it("throws a TsconfigError for a missing or invalid tsconfig", () => {
    const missing = configFor({ calls: callProbe });
    expect(() => check({ config: { ...missing, tsconfig: ["nope.json"] }, cwd: probeDir })).toThrow(
      TsconfigError,
    );
    expect(() => checkFixture(fixturePath("broken"), [probe])).toThrow(TsconfigError);
  });

  it("names the library file TypeScript cannot find, so a bundle without them fails loudly", () => {
    const none = (): boolean => false;
    expect(missingDefaultLib({}, none)).toMatch(/lib\.[a-z0-9.]+\.d\.ts$/);
    expect(missingDefaultLib({ noLib: true }, none)).toBeUndefined();
    expect(missingDefaultLib({}, () => true)).toBeUndefined();
  });

  it("gives a TsconfigError the one change that fixes it", () => {
    const missing = configFor({ calls: callProbe });
    const hintOf = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (error) {
        return error instanceof TsconfigError ? error.hint : undefined;
      }
      return undefined;
    };
    expect(
      hintOf(() => check({ config: { ...missing, tsconfig: ["nope.json"] }, cwd: probeDir })),
    ).toBe('point "tsconfig" in stateward.config.ts at your project\'s tsconfig.json');
    expect(hintOf(() => checkFixture(fixturePath("broken"), [probe]))).toBe(
      "fix the tsconfig errors above, then run stateward check again",
    );
  });
});

describe("explain", () => {
  it("returns a rule's explain text, or undefined for an unknown id", async () => {
    const config = configFor({ calls: callProbe });
    expect(await explain(config, "probe/calls")).toBe("probe explain");
    expect(await explain(config, "probe/other")).toBeUndefined();
    expect(await explain(config, "other/calls")).toBeUndefined();
  });
});
