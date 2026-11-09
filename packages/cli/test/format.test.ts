import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckResult, Finding } from "@stateward/core/internal";
import { formatJson, formatPretty } from "../src/format.js";

const cwd = path.resolve("/work");
const file = path.join(cwd, "src", "a.ts");
const text = "const a = 1;\n\tconst b = foo(\n  1,\n);\n";

const problem: Finding = {
  kind: "problem",
  ruleId: "demo/rule",
  severity: "error",
  message: "bad call",
  hint: "call it the good way",
  location: { file, start: text.indexOf("foo"), end: text.indexOf(");") + 2 },
  related: [
    { location: { file, start: 6, end: 7 }, message: "declared here" },
    { location: { file, start: 20, end: 21 }, message: "and used here" },
  ],
  fixes: [],
};
const unknown: Finding = {
  kind: "unknown",
  ruleId: "demo/rule",
  message: "could not decide",
  hint: "declare the type",
  location: { file, start: 0, end: 5 },
};

const failure: Finding = {
  kind: "failure",
  ruleId: "demo/rule",
  message: "rule demo/rule failed: boom",
  hint: "report this to the rule's authors",
  location: { file, start: 0, end: 5 },
};

const options = { cwd, readText: (f: string) => (f === file ? text : undefined), color: false };

function result(
  findings: readonly Finding[],
  files = 14,
  hidden: CheckResult["hidden"] = [],
): CheckResult {
  return { findings, hidden, stats: { files, durationMs: 1234 } };
}

describe("formatPretty", () => {
  it("prints the anatomy: headline, location, frame, fix, notes in order (no location for one on the shown line), docs", () => {
    expect(formatPretty(result([problem]), options)).toBe(
      [
        "error[demo/rule]: bad call",
        " --> src/a.ts:2:12",
        "  |",
        "2 |  const b = foo(",
        "  |            ^^^^",
        "  = fix: call it the good way",
        "  = note: src/a.ts:1: declared here",
        "  = note: and used here",
        "  = docs: stateward explain demo/rule",
        "",
        "1 error in 14 files (1.2 s). Run `stateward explain <rule>` for details.",
        "",
      ].join("\n"),
    );
  });

  it("widens the gutter with the line number", () => {
    const long = `${"\n".repeat(11)}foo(1);\n`;
    const finding: Finding = { ...problem, related: [], location: { file, start: 11, end: 14 } };
    expect(formatPretty(result([finding]), { ...options, readText: () => long })).toContain(
      [
        "  --> src/a.ts:12:1",
        "   |",
        "12 | foo(1);",
        "   | ^^^",
        "   = fix: call it the good way",
      ].join("\n"),
    );
  });

  it("indents the lines of a hint's code example under the fix", () => {
    const withExample: Finding = { ...problem, related: [], hint: "keep it:\n    a = {\n    }" };
    expect(formatPretty(result([withExample]), options)).toContain(
      ["  = fix: keep it:", "        a = {", "        }"].join("\n"),
    );
  });

  it("indents each way to fix under the fix, and a way's code example under it (M22)", () => {
    const withList: Finding = {
      ...problem,
      related: [],
      hint: 'one of\n- add `case "x":` with its own code\n- or allow it in `default`:\n    default: void (k satisfies "x");',
    };
    expect(formatPretty(result([withList]), options)).toContain(
      [
        "  = fix: one of",
        '      - add `case "x":` with its own code',
        "      - or allow it in `default`:",
        '            default: void (k satisfies "x");',
      ].join("\n"),
    );
  });

  it("counts places not checked in one line naming the rules, and lists them only with --verbose", () => {
    const other: Finding = { ...unknown, ruleId: "demo/other" };
    expect(formatPretty(result([unknown, other, unknown]), options)).toBe(
      [
        "3 places not checked (demo/rule 2, demo/other 1); list them with `--verbose` or `stateward coverage`",
        "No problems in 14 files (1.2 s).",
        "",
      ].join("\n"),
    );
    const many = ["a/1", "a/2", "a/3", "a/4", "a/5"].map((ruleId): Finding => ({
      ...unknown,
      ruleId,
    }));
    expect(formatPretty(result(many), options)).toContain(
      "5 places not checked (a/1 1, a/2 1, a/3 1 and 2 more rules); list them",
    );
  });

  it("lists stateward's own places not checked (a file it could not read) without --verbose", () => {
    const syntax: Finding = { ...unknown, ruleId: "stateward/syntax" };
    const output = formatPretty(result([syntax]), options);
    expect(output).toContain("info[stateward/syntax]: could not decide");
    expect(output).not.toContain("--verbose");
  });

  it("lists the places not checked of a rule that asks for it (listUnknowns) without --verbose", () => {
    const asked: Finding = { ...unknown, ruleId: "errors/must-handle-error", listed: true };
    const output = formatPretty(result([asked, unknown]), options);
    expect(output).toContain("info[errors/must-handle-error]: could not decide");
    expect(output).not.toContain("info[demo/rule]");
    expect(output).toContain("1 place not checked (demo/rule 1); list them with `--verbose`");
  });

  it("with --verbose, prints an unknown as info with the same frame, fix and docs lines", () => {
    expect(formatPretty(result([unknown]), { ...options, verbose: true })).toBe(
      [
        "info[demo/rule]: could not decide",
        " --> src/a.ts:1:1",
        "  |",
        "1 | const a = 1;",
        "  | ^^^^^",
        "  = fix: declare the type",
        "  = docs: stateward explain demo/rule",
        "",
        "1 place not checked in 14 files (1.2 s). Run `stateward explain <rule>` for details.",
        "",
      ].join("\n"),
    );
  });

  it("prints a failure with the same frame, fix and docs lines and counts it as a rule failure", () => {
    expect(formatPretty(result([failure]), options)).toBe(
      [
        "failure[demo/rule]: rule demo/rule failed: boom",
        " --> src/a.ts:1:1",
        "  |",
        "1 | const a = 1;",
        "  | ^^^^^",
        "  = fix: report this to the rule's authors",
        "  = docs: stateward explain demo/rule",
        "",
        "1 rule failure in 14 files (1.2 s). Run `stateward explain <rule>` for details.",
        "",
      ].join("\n"),
    );
    expect(formatPretty(result([failure, failure, problem]), options)).toContain(
      "\n2 rule failures, 1 error in 14 files",
    );
  });

  it("prints hidden counts after the findings of their file", () => {
    const output = formatPretty(
      result([problem], 14, [{ file, ruleId: "demo/rule", count: 3 }]),
      options,
    );
    expect(output).toContain(
      "  = docs: stateward explain demo/rule\n\n  \u2026 and 3 more demo/rule in src/a.ts\n\n1 error",
    );
  });

  it("counts singular and plural, omits zeros, and says so when nothing was found", () => {
    expect(formatPretty(result([], 1), options)).toBe("No problems in 1 file (1.2 s).\n");
    const warning: Finding = { ...problem, severity: "warning" };
    expect(formatPretty(result([problem, problem, warning, unknown, unknown]), options)).toContain(
      "2 errors, 1 warning in 14 files (1.2 s). Run `stateward explain <rule>` for details.\n",
    );
    // The places not checked are said once, in their own line, not again in the summary.
    expect(formatPretty(result([unknown]), options)).toBe(
      "1 place not checked (demo/rule 1); list them with `--verbose` or `stateward coverage`\nNo problems in 14 files (1.2 s).\n",
    );
    expect(formatPretty(result([problem, unknown]), options)).toContain(
      "\n1 error in 14 files (1.2 s).",
    );
  });

  it("shows places not checked as warnings, or leaves them out but counts them, as `unknowns` says", () => {
    const asWarning: Finding = { ...unknown, shown: "warning" };
    expect(formatPretty(result([asWarning]), options)).toContain(
      "warning[demo/rule]: could not decide",
    );
    const off: Finding = { ...unknown, shown: "off" };
    const output = formatPretty(result([problem, off]), options);
    expect(output).not.toContain("could not decide");
    expect(output).toContain(
      '1 error, 1 place not checked (1 not listed: `unknowns: "off"`) in 14 files',
    );
  });

  it("falls back to the offset when the file cannot be read", () => {
    const output = formatPretty(result([problem]), { ...options, readText: () => undefined });
    expect(output).toContain(`--> src/a.ts (offset ${String(problem.location.start)})`);
    expect(output).toContain("= note: src/a.ts: declared here");
    expect(output).not.toContain("^");
  });

  it("--max shows the most severe findings first, keeps file order, and counts the rest", () => {
    const info: Finding = { ...problem, severity: "info", message: "an info" };
    const warning: Finding = { ...problem, severity: "warning", message: "a warning" };
    const error: Finding = { ...problem, message: "an error" };
    const output = formatPretty(result([info, warning, unknown, error]), { ...options, max: 2 });
    expect(output).toContain("warning[demo/rule]: a warning");
    expect(output).toContain("error[demo/rule]: an error");
    expect(output).not.toContain("an info");
    expect(output).not.toContain("could not decide");
    expect(output.indexOf("a warning")).toBeLessThan(output.indexOf("an error"));
    expect(output).toContain(
      "\u2026 and 1 more finding not shown (the most severe come first); run without --max to see them all\n\n1 place not checked (demo/rule 1); list them with `--verbose` or `stateward coverage`\n1 error, 1 warning, 1 info in 14 files",
    );
    expect(formatPretty(result([error]), { ...options, max: 5 })).not.toContain("not shown");
  });

  it("labels warnings and infos with their severity", () => {
    const warning: Finding = { ...problem, severity: "warning" };
    const info: Finding = { ...problem, severity: "info" };
    const output = formatPretty(result([warning, info]), options);
    expect(output).toContain("warning[demo/rule]: bad call");
    expect(output).toContain("info[demo/rule]: bad call");
    expect(output).toContain("1 warning, 1 info in 14 files");
  });

  it("adds colour only when asked", () => {
    const plain = formatPretty(result([problem]), options);
    const coloured = formatPretty(result([problem]), { ...options, color: true });
    expect(plain).not.toContain("\u001b[");
    expect(coloured).toContain("\u001b[1;31merror[demo/rule]");
  });
});

describe("formatJson", () => {
  it("prints findings with their hint, hidden counts and stats", () => {
    const hidden = [{ file, ruleId: "demo/rule", count: 2 }];
    expect(JSON.parse(formatJson(result([unknown], 14, hidden)))).toEqual({
      findings: [unknown],
      hidden,
      stats: { files: 14, durationMs: 1234 },
    });
  });
});

describe("formatPretty: what the run could not check as a whole", () => {
  it("says once which packs could not run and why, and which projects lack strictNullChecks", () => {
    const out = formatPretty(
      {
        ...result([]),
        notes: {
          missingTypes: [
            {
              library: "React",
              reason: "React's types are not installed (install the app's dependencies)",
              rules: [
                "errors/render-throw-without-boundary",
                "react/effect-loops",
                "react/state-copies-prop",
              ],
            },
          ],
          looseNulls: [path.join(cwd, "tsconfig.json")],
        },
      },
      options,
    );
    const lines = out.split("\n");
    expect(lines).toContain(
      "not checked: 3 rules of the errors and react packs: React's types are not installed (install the app's dependencies)",
    );
    expect(lines).toContain(
      "`strictNullChecks` is off in `tsconfig.json`, so TypeScript does not check `null` and `undefined` and some fixes prove less: set `strict: true` or `strictNullChecks: true` in tsconfig.json",
    );
    expect(out.match(/not checked: /g)).toHaveLength(1);
  });
});
