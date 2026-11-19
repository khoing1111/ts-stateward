import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding, TextEdit } from "@stateward/core";
import ts from "@stateward/core/typescript";
import { typeErrors } from "@stateward/core/testing";
import { checkOnly, exampleBlocks, fixture, inCopy, says, shown } from "./helpers.js";

const RULE = "narrow-try";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

/** `rest` says what to move (`it …` or `these lines …`) and how; the reason follows it. */
function bug(expected: string, rest: string, test: readonly string[]): string {
  const [lines, them] = rest.startsWith("these lines") ? ["the lines", "them"] : ["the line", "it"];
  const how = rest.replace(/^(?:it|these lines) /, "");
  const why = `so a bug in ${them} is not handled like a failed \`${expected}\``;
  const quick = " (quick fix)";
  const move = how.endsWith(quick)
    ? `move ${lines} ${how.slice(0, -quick.length)}, ${why}${quick}`
    : `move ${lines} ${how}, ${why}`;
  return ["one of", `- ${move}`, ...test].join("\n");
}

/** The second reading: the `catch` tests the error and rethrows the rest. */
function tests(variable: string, classes: readonly string[], note = ""): string[] {
  return [
    `- or test the error in the \`catch\` and rethrow the rest${note}:`,
    `    if (${classes.map((name) => `${variable} instanceof ${name}`).join(" || ")}) { … } else { throw ${variable}; }`,
  ];
}

const IMPORT_REQUEST =
  " (import `RequestError` if the file does not), leaving out `TypeError`, which a bug throws too";

/** Applies the edits to the text, last first so earlier offsets stay valid. */
function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

describe(`errors/${RULE}: lines after the expected call that can only fail as bugs`, () => {
  it("names the line and the call the try is for", () => {
    expect(shown(flagged())).toEqual([
      says(
        "access.ts",
        "the `try` for `throw new AccessError(…)` also catches errors from `onOpen()`",
        bug(
          "throw new AccessError(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
          tests("e", ["AccessError"], " (import `AccessError` if the file does not)"),
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `getPlan(…)` also catches errors from `setTitle(openEditor(plan))`",
        bug(
          "getPlan(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
          tests("e", ["RequestError"], IMPORT_REQUEST),
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `savePlan(…)` also catches errors from `setSaved(true)`",
        bug(
          "savePlan(…)",
          "these lines after the `try` (quick fix)",
          tests("e", ["RequestError"], IMPORT_REQUEST),
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `JSON.parse(…)` also catches errors from `onEvent(event)`",
        bug(
          "JSON.parse(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
          tests("error", ["SyntaxError"], ", binding it as `catch (error)`"),
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `savePlan(…)` also catches errors from `onSaved()`",
        bug(
          "savePlan(…)",
          "these lines after the `try` and return from the `catch` (declare what they use before the `try`)",
          tests("e", ["RequestError"], IMPORT_REQUEST),
        ),
      ),
      says(
        "session.ts",
        "the `try` for `createSession.mutateAsync(…)` also catches errors from `onCreated(session)`",
        bug(
          "createSession.mutateAsync(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
          [
            "- or test in the `catch` that the error is what `createSession.mutateAsync(…)` fails with, and rethrow the rest with `throw e;`, so a bug in it is not handled like a failed `createSession.mutateAsync(…)`",
          ],
        ),
      ),
    ]);
  });

  it("is a warning on the line, with a fix only where the move keeps every other outcome", () => {
    const findings = flagged();
    const fixable = findings.filter(
      (finding) => finding.kind === "problem" && finding.fixes.length > 0,
    );
    expect(fixable).toHaveLength(1);
    for (const finding of findings) {
      expect(finding).toMatchObject({
        kind: "problem",
        ruleId: `errors/${RULE}`,
        severity: "warning",
      });
    }
    const [first] = fixable;
    const edits = first?.kind === "problem" ? first.fixes.flatMap((fix) => fix.edits) : [];
    const file = first?.location.file ?? "";
    const fixed = applied(readFileSync(file, "utf8"), edits);
    expect(fixed).toContain(
      [
        "  try {",
        "    await savePlan(plan);",
        "  } catch (e) {",
        "    showError(e);",
        "    return;",
        "  }",
        "  closeEditor();",
        "  setSaved(true);",
        "}",
      ].join("\n"),
    );
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts a catch that tests or rethrows, a narrow try, lines that cannot fail, awaited calls, and reads, conditions, defaults, `break` and store dispatches (a large app)", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});

describe(`errors/${RULE}: the reading that tests the error in the \`catch\``, () => {
  it("compiles in the developer's file where the classes are known, and the finding goes", () => {
    const dir = fixture(`${RULE}/flagged`);
    const found = flagged();
    let tried = 0;
    for (const finding of found) {
      const line =
        exampleBlocks(finding.hint)
          .map((block) => block[0] ?? "")
          .find((first) => first.includes("instanceof")) ?? "";
      if (line === "") continue;
      tried += 1;
      const text = readFileSync(finding.location.file, "utf8");
      const source = ts.createSourceFile(finding.location.file, text, ts.ScriptTarget.ES2022, true);
      const tryStatement = ts.findAncestor(
        findAt(source, finding.location.start),
        (node): node is ts.TryStatement => ts.isTryStatement(node),
      );
      const clause = tryStatement?.catchClause;
      if (tryStatement === undefined || clause === undefined) throw new Error("no catch");
      const body = clause.block.statements.map((one) => one.getText(source)).join("\n");
      const variable = /\b(\w+) instanceof\b/.exec(line)?.[1] ?? "e";
      const imported = [...finding.hint.matchAll(/import `(\w+)` if the file does not/g)]
        .map((one) => one[1] ?? "")
        .filter((name) => !text.includes(`class ${name}`));
      const imports = imported.map((name) => `import { ${name} } from "./api";\n`).join("");
      const rewritten = `catch (${variable}) {\n${line.replace("{ … }", `{\n${body}\n}`)}\n}`;
      inCopy(
        dir,
        [
          { file: finding.location.file, start: 0, end: 0, text: imports },
          {
            file: finding.location.file,
            start: clause.getStart(source),
            end: clause.getEnd(),
            text: rewritten,
          },
        ],
        (copy) => {
          expect(typeErrors(copy)).toBe("");
          expect(checkOnly(copy, RULE)).toHaveLength(found.length - 1);
        },
      );
    }
    expect(tried).toBe(5);
  });
});

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
