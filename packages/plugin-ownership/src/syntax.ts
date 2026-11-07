/** Reading the syntax of a change: what is written, and the owner's call that would make it. */
import ts from "@stateward/core/typescript";
import { capitalized, shorten } from "./text.js";

export function isWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

export function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** `a = v`, `a += v`, `a++`, `delete a`, `[a] = list`, `({ k: a } = obj)`, `for (a of list)`. */
export function isWriteTarget(expression: ts.Expression): boolean {
  let current: ts.Node = expression;
  for (;;) {
    const parent: ts.Node = current.parent;
    const inPattern =
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current);
    if (!inPattern) break;
    current = parent;
  }
  const parent = current.parent;
  if (ts.isBinaryExpression(parent)) {
    const { kind } = parent.operatorToken;
    return (
      parent.left === current &&
      kind >= ts.SyntaxKind.FirstAssignment &&
      kind <= ts.SyntaxKind.LastAssignment
    );
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  if (ts.isDeleteExpression(parent)) return true;
  return (
    (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === current
  );
}

/** What a change is called in the example: the last name along the path, or the variable's own. */
export function baseName(expression: ts.Expression, fallback: string): string {
  const current = unwrapped(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const key = current.argumentExpression;
    if (ts.isStringLiteral(key) && /^[A-Za-z_$][\w$]*$/.test(key.text)) return key.text;
    return baseName(current.expression, fallback);
  }
  return fallback;
}

/** The key of `a[key]` when it is not a literal: the example passes it on. */
export function dynamicKey(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string | undefined {
  const current = unwrapped(expression);
  if (!ts.isElementAccessExpression(current)) return undefined;
  const key = current.argumentExpression;
  return ts.isStringLiteral(key) || ts.isNumericLiteral(key) ? undefined : key.getText(sourceFile);
}

export function call(name: string, args: readonly (string | undefined)[]): string {
  const given = args.filter((arg): arg is string => arg !== undefined);
  return `${name}(${shorten(given.join(", "), 30)})`;
}

const COMPOUND_VERBS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.EqualsToken, "set"],
  [ts.SyntaxKind.PlusEqualsToken, "add"],
  [ts.SyntaxKind.MinusEqualsToken, "subtract"],
]);

/** The owner's function that would make an assignment, increment or `delete` of `target`. */
export function assignmentExample(
  target: ts.Expression,
  root: string,
  sourceFile: ts.SourceFile,
): string {
  const prop = capitalized(baseName(target, root));
  const key = dynamicKey(target, sourceFile);
  const parent = target.parent;
  if (ts.isBinaryExpression(parent) && parent.left === target) {
    const verb = COMPOUND_VERBS.get(parent.operatorToken.kind) ?? "update";
    return call(`${verb}${prop}`, [key, parent.right.getText(sourceFile)]);
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    const verb = parent.operator === ts.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
    return call(`${verb}${prop}`, [key]);
  }
  if (ts.isDeleteExpression(parent)) {
    return key === undefined ? call(`clear${prop}`, []) : call(`remove${prop}`, [key]);
  }
  return call(`update${prop}`, ["value"]);
}

const METHOD_VERBS = new Map<string, string>([
  ["push", "add"],
  ["unshift", "add"],
  ["pop", "removeLast"],
  ["shift", "removeFirst"],
  ["splice", "remove"],
  ["set", "set"],
  ["add", "add"],
  ["delete", "remove"],
  ["clear", "clear"],
]);

export function methodExample(
  receiver: ts.Expression,
  method: string,
  args: readonly ts.Expression[],
  root: string,
  sourceFile: ts.SourceFile,
): string {
  const verb = METHOD_VERBS.get(method) ?? method;
  const prop = capitalized(baseName(receiver, root));
  const lastWord = ["pop", "shift", "clear"].includes(method);
  return call(`${verb}${prop}`, lastWord ? [] : args.map((arg) => arg.getText(sourceFile)));
}
