import ts from "@stateward/core/typescript";
import type { Loc } from "./summary.js";

export type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

export function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  );
}

export function locOf(node: ts.Node): Loc {
  return { file: node.getSourceFile().fileName, start: node.getStart(), end: node.getEnd() };
}

/** Parentheses, casts and `!` do not change which value an expression is. */
export function skipWrappers(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner) ||
    ts.isTypeAssertionExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

export function startsUpperCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

/** The name a call is made by: `useX(…)` and `ns.useX(…)` both give `useX`. */
export function calleeName(call: ts.CallExpression): string | undefined {
  const callee = skipWrappers(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

export function isJsx(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

/** A function is a component when it renders JSX or calls a hook. */
export function containsJsxOrHookCall(root: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (isJsx(node)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && isHookName(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

const MAX_LABEL_LENGTH = 40;

/** Source text on one line and at most 40 characters, for a message. */
export function shortText(node: ts.Node): string {
  const oneLine = node.getText().replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_LABEL_LENGTH ? `${oneLine.slice(0, MAX_LABEL_LENGTH - 1)}…` : oneLine;
}

/** The tag as the developer wrote it, without type arguments: `Dashboard`, `UI.Card`. */
export function tagText(tag: ts.JsxTagNameExpression): string {
  return tag.getText().replace(/\s+/g, "");
}

/** The first node above `node` that is a function (any kind), or the source file. */
export function enclosingFunction(node: ts.Node): ts.Node {
  let current = node.parent;
  while (!ts.isSourceFile(current) && !ts.isFunctionLike(current)) current = current.parent;
  return current;
}

/** The `default` keyword of `export default <expression>`: where the export's symbol lives. */
export function defaultKeywordOf(assignment: ts.ExportAssignment): ts.Node {
  return (
    assignment.getChildren().find((child) => child.kind === ts.SyntaxKind.DefaultKeyword) ??
    assignment
  );
}
