import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  check,
  defineRule,
  definePlugin,
  matchesFile,
  matchesName,
  option,
  parseConfig,
} from "../src/internal.js";
import type { CheckResult } from "../src/internal.js";

/*
 * A severity per kind of finding (`option.severities`) and the config's `unknowns` setting: how a
 * team chooses how strict each part of a rule is, and how the places not checked show.
 */

const kinds = option.severities({
  kinds: { sure: "A case the rule is sure of.", guess: "A case it guesses." },
  description: "Severity per kind.",
});

/** `sure*` names are reported as `sure`, `guess*` as `guess`, `odd*` as a kind it does not declare, `unknown*` as unknown. */
function visitNames(
  sourceFile: ts.SourceFile,
  each: (node: ts.VariableDeclaration, name: string) => void,
): void {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) each(node, node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function kindOf(name: string): string | undefined {
  if (name.startsWith("sure")) return "sure";
  if (name.startsWith("guess")) return "guess";
  if (name.startsWith("odd")) return "odd";
  return undefined;
}

const fileRule = defineRule({
  kind: "file",
  meta: {
    description: "d",
    defaultSeverity: "error",
    tier: "core",
    group: "g",
    explain: "e",
    options: { severities: kinds },
  },
  check(ctx) {
    visitNames(ctx.sourceFile, (node, name) => {
      if (name.startsWith("unknown")) {
        ctx.unknown({ node, message: "`x` cannot be checked", hint: "type it" });
        return;
      }
      if (name.startsWith("low")) {
        // The rule's own choice: a guess, reported as a warning at most.
        const message = `\`${name}\` is flagged`;
        const lowered = { message, hint: "rename it", findingKind: "guess" };
        ctx.report({ node, ...lowered, severity: "warning" });
        return;
      }
      const findingKind = kindOf(name);
      if (findingKind === undefined) return;
      ctx.report({ node, message: `\`${name}\` is flagged`, hint: "rename it", findingKind });
    });
  },
});

const projectRule = defineRule({
  kind: "project",
  meta: {
    description: "d",
    defaultSeverity: "error",
    tier: "core",
    group: "g",
    explain: "e",
    options: { severities: kinds },
  },
  summarize(ctx) {
    const names: string[] = [];
    visitNames(ctx.sourceFile, (_node, name) => names.push(name));
    return names;
  },
  check(summaries, ctx) {
    for (const [file, names] of summaries) {
      for (const name of Array.isArray(names) ? names : []) {
        const findingKind = typeof name === "string" ? kindOf(name) : undefined;
        if (findingKind === undefined || findingKind === "odd") continue;
        ctx.report({
          location: { file, start: 0, end: 1 },
          message: `\`${name}\` is flagged across files`,
          hint: "rename it",
          findingKind,
        });
      }
    }
  },
});

const plugin = definePlugin({ name: "k", description: "k", rules: { fileRule, projectRule } });

let dir = "";
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-kinds-"));
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
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, "src", name)), { recursive: true });
    writeFileSync(path.join(dir, "src", name), text);
  }
  return dir;
}

function run(cwd: string, input: Record<string, unknown>): CheckResult {
  const parsed = parseConfig({ preset: "recommended", plugins: [plugin], ...input }, cwd);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return check({ config: parsed.value, cwd });
}

/** `rule severity kind file` per problem, `rule unknown shown` per unknown, `rule failure` per failure. */
function lines(result: CheckResult): string[] {
  return result.findings.map((finding) => {
    const file = path.relative(dir, finding.location.file).split(path.sep).join("/");
    switch (finding.kind) {
      case "problem":
        return `${finding.ruleId} ${finding.severity} ${finding.findingKind ?? "-"} ${file}`;
      case "unknown":
        return `${finding.ruleId} unknown ${finding.shown ?? "info"} ${file}`;
      case "failure":
        return `${finding.ruleId} failure ${file}`;
      default: {
        const unreachable: never = finding;
        return unreachable;
      }
    }
  });
}

function errorsOf(input: Record<string, unknown>): readonly string[] {
  const result = parseConfig({ preset: "recommended", plugins: [plugin], ...input }, "/work");
  return result.ok ? [] : result.errors;
}

describe("a severity per kind of finding", () => {
  it("keeps the rule's severity for every kind when the config sets none", () => {
    const cwd = project({ "a.ts": "export const sure1 = 1;\nexport const guess1 = 2;\n" });
    expect(lines(run(cwd, { rules: { "k/fileRule": "warning", "k/projectRule": "off" } }))).toEqual(
      ["k/fileRule warning sure src/a.ts", "k/fileRule warning guess src/a.ts"],
    );
  });

  it("lets a rule lower a finding to a warning, never raise it, and the config's kind setting wins", () => {
    const cwd = project({ "a.ts": "export const low1 = 1;\n" });
    const at = (setting: unknown): string[] =>
      lines(run(cwd, { rules: { "k/fileRule": setting, "k/projectRule": "off" } }));
    expect(at("error")).toEqual(["k/fileRule warning guess src/a.ts"]);
    expect(at("info")).toEqual(["k/fileRule info guess src/a.ts"]);
    expect(at(["error", { severities: { guess: "error" } }])).toEqual([
      "k/fileRule error guess src/a.ts",
    ]);
  });

  it("gives each kind the severity the config sets, and drops a kind set to off", () => {
    const cwd = project({ "a.ts": "export const sure1 = 1;\nexport const guess1 = 2;\n" });
    const result = run(cwd, {
      rules: {
        "k/fileRule": ["error", { severities: { guess: "info" } }],
        "k/projectRule": ["error", { severities: { guess: "off" } }],
      },
    });
    expect(lines(result)).toEqual([
      "k/projectRule error sure src/a.ts",
      "k/fileRule error sure src/a.ts",
      "k/fileRule info guess src/a.ts",
    ]);
  });

  it("keeps a kind's severity in a folder an override changes, and drops it where the rule is off", () => {
    const cwd = project({
      "legacy/a.ts": "export const sure1 = 1;\nexport const guess1 = 2;\n",
      "old/a.ts": "export const sure2 = 1;\n",
    });
    const result = run(cwd, {
      rules: {
        "k/fileRule": ["error", { severities: { guess: "warning" } }],
        "k/projectRule": ["error", { severities: { guess: "warning" } }],
      },
      overrides: [
        { files: ["src/legacy/**"], rules: { "k/fileRule": "info", "k/projectRule": "info" } },
        { files: ["src/old/**"], rules: { "k/fileRule": "off", "k/projectRule": "off" } },
      ],
    });
    expect(lines(result)).toEqual([
      "k/projectRule warning guess src/legacy/a.ts",
      "k/projectRule info sure src/legacy/a.ts",
      "k/fileRule info sure src/legacy/a.ts",
      "k/fileRule warning guess src/legacy/a.ts",
    ]);
  });

  it("fails the rule when it reports a kind its options do not declare", () => {
    const cwd = project({ "a.ts": "export const odd1 = 1;\n" });
    const result = run(cwd, { rules: { "k/projectRule": "off" } });
    expect(lines(result)).toEqual(["k/fileRule failure src/a.ts"]);
    expect(result.findings[0]?.message).toBe(
      'rule k/fileRule failed: reported the kind of finding "odd", which its options do not declare',
    );
  });

  it.each([
    [
      { severities: { maybe: "info" } },
      'rules["k/fileRule"].severities must be an object of "sure", "guess" to "error", "warning", "info" or "off", got an object',
    ],
    [
      { severities: { guess: "loud" } },
      'rules["k/fileRule"].severities must be an object of "sure", "guess" to "error", "warning", "info" or "off", got an object',
    ],
    [
      { severities: ["info"] },
      'rules["k/fileRule"].severities must be an object of "sure", "guess" to "error", "warning", "info" or "off", got ["info"]',
    ],
  ])("rejects %j", (options, message) => {
    expect(errorsOf({ rules: { "k/fileRule": ["error", options] } })).toEqual([message]);
  });

  it("defaults to no kind set", () => {
    const parsed = parseConfig({ preset: "recommended", plugins: [plugin] }, "/work");
    expect(parsed.ok && parsed.value.ruleOptions["k/fileRule"]).toEqual({ severities: {} });
  });
});

describe("the unknowns setting", () => {
  const source = { "a.ts": "export const unknown1 = 1;\n" };
  const rules = { "k/projectRule": "off" };

  it("shows places not checked as infos by default", () => {
    const cwd = project(source);
    expect(lines(run(cwd, { rules }))).toEqual(["k/fileRule unknown info src/a.ts"]);
  });

  it("marks them as warnings, or off; off still keeps them in the result to count", () => {
    const cwd = project(source);
    expect(lines(run(cwd, { rules, unknowns: "warning" }))).toEqual([
      "k/fileRule unknown warning src/a.ts",
    ]);
    expect(lines(run(cwd, { rules, unknowns: "off" }))).toEqual([
      "k/fileRule unknown off src/a.ts",
    ]);
  });

  it("rejects another value, and is merged from a shared config", () => {
    expect(errorsOf({ unknowns: "error" })).toEqual([
      'unknowns must be "info", "warning" or "off", got "error"',
    ]);
    const parsed = parseConfig(
      { preset: "recommended", plugins: [plugin], extends: [{ unknowns: "off" }] },
      "/work",
    );
    expect(parsed.ok && parsed.value.unknowns).toBe("off");
  });
});

describe("matchesFile", () => {
  it("matches a glob written from the project against the end of an absolute path", () => {
    expect(matchesFile("/work/app/src/codecs/user.ts", ["src/codecs/**"])).toBe(true);
    expect(matchesFile("/work/app/src/codecs/user.ts", ["**/user.ts"])).toBe(true);
    expect(matchesFile("/work/app/src/other/user.ts", ["src/codecs/**"])).toBe(false);
    expect(matchesFile("/work/app/src/a.ts", [])).toBe(false);
  });
});

describe("matchesName", () => {
  it("matches `*` as any run of characters and every other character as itself", () => {
    expect(matchesName("ERROR_MESSAGES", ["*_MESSAGES"])).toBe(true);
    expect(matchesName("useUserQuery", ["use*Query"])).toBe(true);
    expect(matchesName("legacy", ["l.gacy"])).toBe(false);
    expect(matchesName("titles", ["t?tles"])).toBe(false);
    expect(matchesName("anything", [])).toBe(false);
  });
});
