import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "@stateward/core/typescript";
import { typeErrors } from "@stateward/core/testing";
import type { Finding } from "@stateward/core";
import { checkOnly, exampleBlocks, fixture, inCopy, says, shown } from "./helpers.js";
import type { Replacement } from "./helpers.js";

const RULE = "result-unchecked";
const EXITS = fixture(`${RULE}/exits`);

/** Fills the `…` of a stop (`{ … }`) with a return the function can make: they all return a string. */
function filled(line: string, hint: string): string {
  // In a `try` the stop is a throw; elsewhere a function that returns a string returns one.
  return line.replace(
    "{ … }",
    hint.includes("throw its error") ? '{ throw new Error("x"); }' : '{ return "x"; }',
  );
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
}

function ifAt(finding: Finding): { source: ts.SourceFile; node: ts.IfStatement } {
  const source = parse(finding.location.file);
  const node = ts.findAncestor(
    findAt(source, finding.location.start),
    (one): one is ts.IfStatement => ts.isIfStatement(one),
  );
  if (node === undefined) throw new Error("no `if` at the finding");
  return { source, node };
}

function findAt(source: ts.SourceFile, position: number): ts.Node {
  let found: ts.Node = source;
  const visit = (node: ts.Node): void => {
    if (node.getStart(source) <= position && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  return found;
}

/** The statement of a finding that is not on an `if`: the declaration that reads the data. */
function statementAt(finding: Finding): { source: ts.SourceFile; node: ts.Statement } {
  const source = parse(finding.location.file);
  const node = ts.findAncestor(findAt(source, finding.location.start), (one): one is ts.Statement =>
    ts.isStatement(one),
  );
  if (node === undefined) throw new Error("no statement at the finding");
  return { source, node };
}

/** What the project looks like after each way the hint offers, as replacements of the finding's file. */
function ways(finding: Finding): readonly (readonly Replacement[])[] {
  const file = finding.location.file;
  const blocks = exampleBlocks(finding.hint);
  if (finding.message.includes("after the `if`")) {
    const { source, node } = ifAt(finding);
    const [stops, either] = blocks;
    if (stops === undefined || either === undefined) throw new Error("the two readings are shown");
    const branch = ts.isBlock(node.thenStatement)
      ? node.thenStatement.statements.map((one) => one.getText(source)).join("\n")
      : node.thenStatement.getText(source);
    const stopped = stops
      .map((line) =>
        line.includes("// …")
          ? // Where the hint says in words what to return, the function's own value is written.
            `${branch}\n${
              stops.some((one) => /\b(?:return|throw)\b/.test(one))
                ? ""
                : finding.hint.includes("throwing its error")
                  ? 'throw new Error("x");'
                  : 'return "x";'
            }`
          : line,
      )
      .join("\n");
    const block = node.parent;
    const later = ts.isBlock(block)
      ? block.statements.slice(block.statements.indexOf(node) + 1)
      : [];
    // A closing `return value;` stays after the `if`: the success path is what moves into the `else`.
    const closing = later.at(-1);
    const moved =
      closing !== undefined && ts.isReturnStatement(closing) ? later.slice(0, -1) : later;
    const either1 = (either[0] ?? "").replace(
      "{ … } else { … }",
      `{\n${branch}\n} else {\n${moved.map((one) => one.getText(source)).join("\n")}\n}`,
    );
    return [
      [{ file, start: node.getStart(source), end: node.getEnd(), text: stopped }],
      [
        {
          file,
          start: node.getStart(source),
          end: (moved.at(-1) ?? node).getEnd(),
          text: either1,
        },
      ],
    ];
  }
  const { source, node } = statementAt(finding);
  const [lines] = blocks;
  if (lines === undefined || blocks.length !== 1) throw new Error("one example is shown");
  const text = lines.map((line) => filled(line, finding.hint)).join("\n");
  // Three lines keep the whole result and replace the destructuring; one line is a check put right after the declaration.
  return [
    lines.length === 3
      ? [{ file, start: node.getStart(source), end: node.getEnd(), text }]
      : [{ file, start: node.getEnd(), end: node.getEnd(), text: `\n${text}` }],
  ];
}

const all = checkOnly(EXITS, RULE);
const found = all.filter((one) => one.kind === "problem");

describe(`errors/${RULE}: the stop fits the function and the \`try\` (value)`, () => {
  const hints = (needle: string): string[] =>
    found.filter((one) => one.message.includes(needle)).map((one) => one.hint);

  it("says what to write in words where `return;` would not compile or would skip the `catch`", () => {
    expect(shown(found).map((one) => one.hint.split("\n")[0])).toEqual([
      "one of",
      "one of",
      "keep the whole result and check it before reading `data`, and stop when it failed (return what the function returns, or throw):",
      "one of",
      "check that it worked before reading `data`, and stop when it failed (return what the function returns, or throw):",
      "check that it worked before reading `result.data`, and throw its error when it failed, so the `catch` runs:",
      "one of",
    ]);
    // A function that returns a string is not told to `return;` (TS2322), and a `try` with a
    // rollback is not told to `return` (it would skip the `catch`).
    const [valued, quiet, whole, guarded, loaded, lateGuarded, refreshed] = found;
    expect(valued?.hint).not.toContain("return;");
    expect(valued?.hint).toContain("with a `return` of what the function returns, or a `throw`");
    expect(quiet?.hint).toContain("      return;");
    expect(whole?.hint).not.toContain("return;");
    expect(guarded?.hint).not.toContain("return;");
    expect(guarded?.hint).toContain("      throw result.error;");
    expect(loaded?.hint).not.toContain("return;");
    expect(lateGuarded?.hint).toContain('if ("error" in result) throw result.error;');
    expect(lateGuarded?.hint).not.toContain("return;");
    expect(refreshed?.hint).not.toContain("return;");
    expect(hints("after the call")).toHaveLength(3);
  });

  it("keeps the whole result when only `data` was taken out, and names no `result` that is not there", () => {
    expect(shown(found)[2]).toEqual(
      says(
        "value.ts",
        "code after the call runs even when `deletePlan(…)` failed",
        [
          "keep the whole result and check it before reading `data`, and stop when it failed (return what the function returns, or throw):",
          "    const result = await deletePlan(id);",
          '    if ("error" in result) { … }',
          "    const { data } = result;",
        ].join("\n"),
      ),
    );
  });

  it("offers an `else` for the success path, as one of the readings", () => {
    for (const finding of found.filter((one) => one.message.includes("after the `if`"))) {
      expect(finding.hint).toContain(
        "- or, if the lines after the `if` should run either way, say so with an `else` for the success path",
      );
    }
  });

  it("compiles every way the hint shows, in the developer's file, and silences the finding", () => {
    expect(found).toHaveLength(7);
    for (const finding of found) {
      const options = ways(finding);
      expect(options.length).toBeGreaterThan(0);
      for (const replacements of options) {
        inCopy(EXITS, replacements, (copy) => {
          expect(typeErrors(copy)).toBe("");
          const left = checkOnly(copy, RULE).map((one) => one.message);
          expect({ finding: finding.message, hint: finding.hint, left: left.length }).toEqual({
            finding: finding.message,
            hint: finding.hint,
            left: all.length - 1,
          });
        });
      }
    }
  });
});

describe(`errors/${RULE}: a check it cannot read`, () => {
  it("shows the check in the function's own shape: a value-returning function is not told to `return;`", () => {
    const unknown = all.filter((one) => one.kind === "unknown");
    expect(shown(unknown)).toEqual([
      says(
        "value.ts",
        "not checked: whether the `if` tests that `saveSettings(…)` failed: it does not test the result itself",
        'test the result itself, as in `if ("error" in result) { … }`, so the check can be followed',
      ),
    ]);
    expect(unknown[0]?.hint).not.toContain("return;");
  });
});
