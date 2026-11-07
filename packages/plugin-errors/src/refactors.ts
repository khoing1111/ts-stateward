import ts from "@stateward/core/typescript";
import type { EditorAction, EditorContributions } from "@stateward/core";
import { catchesOf } from "./inference/catches.js";
import { catchName } from "./inference/format.js";
import { analyse } from "./inference/solve.js";
import { factSummaries } from "./inlay.js";

type CodeActions = NonNullable<EditorContributions["codeActions"]>;

/** The title of the refactoring that wraps a catch-all for the errors its `try` can throw. */
export const HANDLE_KNOWN_TITLE = "Handle the known errors, rethrow the rest";

/**
 * On a `catch (e)` with no `instanceof` branches, whose `try` can throw at least one error class
 * stateward can name and whose body does not already throw: wraps the body as
 * `if (e instanceof A || e instanceof B) { <old body> } else { throw e; }`. Two insertions, so the
 * old body stays as written. It keeps what the catch does for the known errors and stops hiding
 * the others, which is why it is a refactoring and not a "safe" fix. Core offers it only when the
 * result compiles (a class the file does not import gets no action).
 */
export const codeActions: CodeActions = (input) => {
  const summaries = factSummaries(input);
  if (summaries === undefined) return [];
  const { sourceFile } = input;
  const clauses: ts.CatchClause[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) {
      // The head: `catch (e) {`.
      const head = [node.getStart(sourceFile), node.block.getStart(sourceFile) + 1] as const;
      if (head[0] <= input.end && input.start <= head[1]) clauses.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (clauses.length === 0) return [];

  const analysis = analyse(summaries);
  const catches = new Map(
    catchesOf(analysis, sourceFile.fileName).map((seen) => [seen.handler.at[0], seen] as const),
  );
  const actions: EditorAction[] = [];
  for (const clause of clauses) {
    const seen = catches.get(clause.getStart(sourceFile));
    const variable = seen?.handler.variable;
    if (
      seen === undefined ||
      variable === null ||
      variable === undefined ||
      seen.handler.branches.length > 0 ||
      seen.handler.restThrows ||
      seen.handler.block[0] !== clause.block.getStart(sourceFile)
    ) {
      continue;
    }
    const names = [
      ...new Set([...seen.thrown.classes.keys()].map((id) => catchName(id, analysis.classes))),
    ].sort();
    if (names.length === 0) continue;
    const tests = names.map((name) => `${variable} instanceof ${name}`).join(" || ");
    const [open, close] = seen.handler.block;
    const at = (offset: number, newText: string): EditorAction["edits"][number] => ({
      location: { file: input.file, start: offset, end: offset },
      newText,
    });
    actions.push({
      title: HANDLE_KNOWN_TITLE,
      edits: [
        at(open + 1, `\nif (${tests}) {`),
        at(close - 1, `\n} else {\nthrow ${variable};\n}\n`),
      ],
    });
  }
  return actions;
};
