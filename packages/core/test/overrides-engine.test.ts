import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { check, createChecker, emptyCache, parseConfig, activeRuleIds } from "../src/internal.js";
import type { CheckResult, Plugin, ResultCache, Rule } from "../src/internal.js";

const meta = {
  description: "d",
  defaultSeverity: "error",
  tier: "core",
  group: "g",
  explain: "d",
} as const;

function badNames(sourceFile: ts.SourceFile): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.startsWith("bad")
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The names of the files `flag` ran on, to see what a cache reused. */
const ran: string[] = [];

const flag: Rule = {
  kind: "file",
  meta,
  check(ctx) {
    ran.push(
      path
        .relative(path.dirname(path.dirname(ctx.file)), ctx.file)
        .split(path.sep)
        .join("/"),
    );
    for (const declaration of badNames(ctx.sourceFile)) {
      ctx.report({ node: declaration, message: "`bad` is bad", hint: "make it good" });
    }
  },
};

/** A project rule: a file with a `bad` name is a finding, decided from all the summaries. */
const spread: Rule = {
  kind: "project",
  meta,
  summarize: (ctx) => badNames(ctx.sourceFile).length,
  check(summaries, ctx) {
    for (const [file, count] of summaries) {
      if (typeof count === "number" && count > 0) {
        ctx.report({
          location: { file, start: 0, end: 1 },
          message: "`bad` names spread",
          hint: "rename them",
        });
      }
    }
  },
};
const widely: Rule = {
  kind: "file",
  meta: { ...meta, tier: "addon", addon: "wide", defaultSeverity: "warning" },
  check(ctx) {
    for (const declaration of badNames(ctx.sourceFile)) {
      ctx.report({ node: declaration, message: "`bad` is wide", hint: "narrow it" });
    }
  },
};
const plugins: Plugin[] = [{ name: "p", description: "p", rules: { flag, spread, widely } }];

let dir = "";
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-overrides-"));
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        target: "ES2022",
        noEmit: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }),
  );
  for (const folder of ["legacy", "payments", "app"]) {
    mkdirSync(path.join(dir, "src", folder), { recursive: true });
    writeFileSync(path.join(dir, "src", folder, "a.ts"), "export const bad1 = 1;\n");
  }
  return dir;
}

function configOf(cwd: string, input: Record<string, unknown>) {
  const parsed = parseConfig({ preset: "recommended", plugins, ...input }, cwd);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.value;
}

/** `rule severity file` for each finding. */
function lines(result: CheckResult): string[] {
  return result.findings.flatMap((finding) =>
    finding.kind === "problem"
      ? [
          `${finding.ruleId} ${finding.severity} ${path.relative(dir, finding.location.file).split(path.sep).join("/")}`,
        ]
      : [],
  );
}

const legacyOff = { files: ["src/legacy/**"], rules: { "p/flag": "off", "p/spread": "off" } };

describe("overrides in a check", () => {
  it("runs a file rule at the severity its file has, and not where it is off", () => {
    const cwd = project();
    const config = configOf(cwd, {
      rules: { "p/spread": "off" },
      overrides: [legacyOff, { files: ["src/payments/**"], rules: { "p/flag": "warning" } }],
    });
    expect(lines(check({ config, cwd }))).toEqual([
      "p/flag error src/app/a.ts",
      "p/flag warning src/payments/a.ts",
    ]);
  });

  it("filters and adjusts a project rule's findings by the file they are in", () => {
    const cwd = project();
    const config = configOf(cwd, {
      rules: { "p/flag": "off", "p/spread": "warning" },
      overrides: [
        { files: ["src/legacy/**"], rules: { "p/spread": "off" } },
        { files: ["src/payments/**"], rules: { "p/spread": "error" } },
      ],
    });
    expect(lines(check({ config, cwd }))).toEqual([
      "p/spread warning src/app/a.ts",
      "p/spread error src/payments/a.ts",
    ]);
  });

  it("runs a project rule that only an override turns on, for the files that override reaches", () => {
    const cwd = project();
    const config = configOf(cwd, {
      rules: { "p/flag": "off", "p/spread": "off" },
      overrides: [{ files: ["src/payments/**"], rules: { "p/spread": "info" } }],
    });
    expect(lines(check({ config, cwd }))).toEqual(["p/spread info src/payments/a.ts"]);
    expect(activeRuleIds(config, { kind: "configured" })).toEqual(new Set(["p/spread"]));
  });

  it("lets the later override win, and an override turn on an add-on for a folder", () => {
    const cwd = project();
    const config = configOf(cwd, {
      rules: { "p/spread": "off" },
      overrides: [
        { files: ["src/**"], rules: { "p/flag": "warning" } },
        { files: ["src/payments/**"], rules: { "p/flag": "info" }, addons: ["p/wide"] },
      ],
    });
    expect(lines(check({ config, cwd }))).toEqual([
      "p/flag warning src/app/a.ts",
      "p/flag warning src/legacy/a.ts",
      "p/flag info src/payments/a.ts",
      "p/widely warning src/payments/a.ts",
    ]);
  });

  it("gives the same findings with the fast pass as with a full check", () => {
    const cwd = project();
    const config = configOf(cwd, { rules: { "p/spread": "off" }, overrides: [legacyOff] });
    const checker = createChecker({ config, cwd });
    const full = lines(checker.check());
    const files = ["legacy", "payments", "app"].map((name) => path.join(cwd, "src", name, "a.ts"));
    expect(lines(checker.checkFiles(files))).toEqual(full);
  });
});

describe("the cache with overrides", () => {
  function runOn(config: ReturnType<typeof configOf>, cache: ResultCache): string[] {
    ran.length = 0;
    check({ config, cwd: dir, cache });
    return [...ran].sort();
  }

  it("runs again exactly the files whose setting changed", () => {
    const cwd = project();
    const cache = emptyCache();
    const rules = { "p/spread": "off" };
    const base = configOf(cwd, { rules });
    expect(runOn(base, cache)).toEqual(["app/a.ts", "legacy/a.ts", "payments/a.ts"]);
    expect(runOn(base, cache)).toEqual([]);
    // Off in one folder: nothing else runs again.
    const off = configOf(cwd, { rules, overrides: [legacyOff] });
    expect(runOn(off, cache)).toEqual([]);
    // Another severity in one folder: only that folder's file runs again.
    const warn = configOf(cwd, {
      rules,
      overrides: [legacyOff, { files: ["src/payments/**"], rules: { "p/flag": "warning" } }],
    });
    expect(runOn(warn, cache)).toEqual(["payments/a.ts"]);
    expect(runOn(warn, cache)).toEqual([]);
    // Back to the first setting: the result kept for it is used, nothing runs.
    expect(runOn(off, cache)).toEqual([]);
  });

  it("runs again what a change in an extended config changes, and nothing else", () => {
    const cwd = project();
    const cache = emptyCache();
    const team = (severity: string) => ({
      plugins,
      rules: { "p/spread": "off", "p/flag": severity },
      overrides: [{ files: ["src/app/**"], rules: { "p/flag": "info" } }],
    });
    const before = configOf(cwd, { extends: [team("error")] });
    runOn(before, cache);
    expect(runOn(before, cache)).toEqual([]);
    const after = configOf(cwd, { extends: [team("warning")] });
    // The app folder is info in both; the other two follow the team's new severity.
    expect(runOn(after, cache)).toEqual(["legacy/a.ts", "payments/a.ts"]);
  });

  it("keeps a project rule's cached findings when only an override changes", () => {
    const cwd = project();
    const cache = emptyCache();
    const rules = { "p/flag": "off", "p/spread": "warning" };
    const first = check({ config: configOf(cwd, { rules }), cwd, cache });
    expect(lines(first)).toHaveLength(3);
    const second = check({
      config: configOf(cwd, { rules, overrides: [legacyOff] }),
      cwd,
      cache,
    });
    expect(lines(second)).toEqual([
      "p/spread warning src/app/a.ts",
      "p/spread warning src/payments/a.ts",
    ]);
  });
});
