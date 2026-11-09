import ts from "@stateward/core/typescript";

export function skipParentheses(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

/** `a[k] = v`, `a[k]++`, `delete a[k]`, `[a[k]] = list`, `for (a[k] of list)`: not a read. */
export function isWriteTarget(access: ts.Node): boolean {
  let current = skipParentheses(access);
  for (;;) {
    const parent = current.parent;
    const inPattern =
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current);
    if (!inPattern) break;
    current = skipParentheses(parent);
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

export function stripParentheses(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParentheses(node.expression) : node;
}

/** The `[object, key]` a call such as `Object.hasOwn(o, k)` or `o.hasOwnProperty(k)` asks about. */
export function ownKeyTest(
  call: ts.CallExpression,
): readonly [ts.Expression, ts.Expression] | undefined {
  const callee = stripParentheses(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const [first, second] = call.arguments;
  const target = stripParentheses(callee.expression);
  if (callee.name.text === "hasOwn" && ts.isIdentifier(target) && target.text === "Object") {
    return first !== undefined && second !== undefined ? [first, second] : undefined;
  }
  if (callee.name.text === "hasOwnProperty") {
    return first !== undefined && second === undefined ? [target, first] : undefined;
  }
  // `Object.prototype.hasOwnProperty.call(o, k)` passes the object first.
  const viaCall =
    callee.name.text === "call" &&
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "hasOwnProperty";
  return viaCall && first !== undefined && second !== undefined ? [first, second] : undefined;
}
