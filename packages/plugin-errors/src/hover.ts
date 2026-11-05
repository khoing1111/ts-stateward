import ts from "@stateward/core/typescript";
import type { EditorContributions, Json } from "@stateward/core";
import { FACT_RULES } from "./inference/deps.js";
import { resultLines } from "./inference/format.js";
import { analyse } from "./inference/solve.js";
import { TREE_RULES, boundaryLines, modelOf, throwsOf } from "./react/boundaries.js";

type Hover = NonNullable<EditorContributions["hover"]>;

/** The identifier that covers `offset`, if any. */
function identifierAt(root: ts.Node, offset: number): ts.Identifier | undefined {
  if (offset < root.getStart() || offset >= root.getEnd()) return undefined;
  if (ts.isIdentifier(root)) return root;
  return ts.forEachChild(root, (child) => identifierAt(child, offset));
}

/** The name of a function's declaration, or the name a call or `new` calls. */
function isFunctionName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (
    ts.isFunctionDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent)
  ) {
    return parent.name === identifier;
  }
  const callee =
    ts.isPropertyAccessExpression(parent) && parent.name === identifier ? parent : identifier;
  const owner = callee.parent;
  return (ts.isCallExpression(owner) || ts.isNewExpression(owner)) && owner.expression === callee;
}

/**
 * `throws: ParseError | unknown (via api.get: no declaration)` on a function's name and on a
 * call of it, from the last full check's solve (no recomputation: the solve is kept per
 * summaries map). Nothing when the pack's inference rules did not run, or for a function that is
 * not the project's own. On an error boundary's tag, what it catches (`boundaryLines`).
 */
export const hover: Hover = (input) => {
  let trees: ReadonlyMap<string, Json> | undefined;
  for (const ruleId of TREE_RULES) trees ??= input.projectSummaries(ruleId);
  if (trees !== undefined) {
    const lines = boundaryLines(modelOf(trees), input.sourceFile.fileName, input.offset);
    if (lines !== undefined) return lines.join("\n\n");
  }
  let summaries: ReadonlyMap<string, Json> | undefined;
  for (const ruleId of FACT_RULES) summaries ??= input.projectSummaries(ruleId);
  summaries ??= trees === undefined ? undefined : throwsOf(trees);
  if (summaries === undefined) return undefined;
  const identifier = identifierAt(input.sourceFile, input.offset);
  if (identifier === undefined || !isFunctionName(identifier)) return undefined;
  const symbol = input.types.symbolAt(identifier);
  if (symbol === undefined) return undefined;
  const analysis = analyse(summaries);
  const result = analysis.results.get(symbol.id);
  if (result === undefined) return undefined;
  // A blank line between them: Markdown joins single-newline lines into one paragraph.
  return resultLines(result, analysis.classes).join("\n\n");
};
