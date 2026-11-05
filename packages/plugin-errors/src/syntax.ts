import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";

export function stripParentheses(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

/** A function, method or accessor: code in it runs when it is called, not where it is written. */
export function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

/**
 * Visits `root` and what runs with it, in source order, without entering a nested function or
 * class. `guarded` is true inside the `try` block of a `try` that has a `catch`: an error there is
 * caught. The `catch` and `finally` blocks of that `try` are not guarded by it.
 */
export function scanRunning(root: ts.Node, visit: (node: ts.Node, guarded: boolean) => void): void {
  const walk = (node: ts.Node, guarded: boolean): void => {
    if (isFunctionBoundary(node)) return;
    visit(node, guarded);
    if (ts.isTryStatement(node)) {
      walk(node.tryBlock, guarded || node.catchClause !== undefined);
      if (node.catchClause !== undefined) walk(node.catchClause, guarded);
      if (node.finallyBlock !== undefined) walk(node.finallyBlock, guarded);
      return;
    }
    ts.forEachChild(node, (child) => {
      walk(child, guarded);
    });
  };
  walk(root, false);
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind) === true;
}

/** A function that is declared here with a body: a declaration, a method, or one bound to a name. */
export type DeclaredFunction =
  ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function functionOfDeclaration(node: ts.Node): DeclaredFunction | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.body === undefined ? undefined : node;
  }
  if (
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node)
  ) {
    const initializer =
      node.initializer === undefined ? undefined : stripParentheses(node.initializer);
    if (
      initializer !== undefined &&
      (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ) {
      return initializer;
    }
  }
  return undefined;
}

/**
 * The function that `callee` (`save`, `this.save`, `service.save`) names, when it is declared in
 * this file and has a body. Resolved by declaration, so a shadowing name or an import is not
 * mistaken for it.
 */
export function sameFileFunction(
  callee: ts.Expression,
  ctx: FileContext,
): DeclaredFunction | undefined {
  const target = stripParentheses(callee);
  const name = ts.isIdentifier(target)
    ? target
    : ts.isPropertyAccessExpression(target)
      ? target.name
      : undefined;
  if (name === undefined || ts.isPrivateIdentifier(name)) return undefined;
  const symbol = ctx.types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declaration?.node.getSourceFile() !== ctx.sourceFile) return undefined;
  return functionOfDeclaration(declaration.node);
}

/**
 * Whether `name` is the language's own global (`JSON`, `URL`, `fetch`): it resolves to a
 * declaration outside the project, so a local variable of the same name is not taken for it.
 */
export function isBuiltinGlobal(name: ts.Identifier, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declaration !== undefined && !ctx.types.isOwnFile(declaration.file);
}

/** Whether the function has a `throw` that no `try` / `catch` of its own catches. */
export function throwsUncaught(fn: DeclaredFunction): boolean {
  let thrown = false;
  scanRunning(fn.body ?? fn, (node, guarded) => {
    if (ts.isThrowStatement(node) && !guarded) thrown = true;
  });
  return thrown;
}

/**
 * Whether a `catch` tests what it caught before handling it: `e instanceof X`, `e.name === …`,
 * `"status" in e`, or a type guard `isApiError(e)`, in an `if`, a `switch` or a `?:`. Such a catch
 * says which errors it expects; `errors/catch-hides-unexpected` checks what it does with the rest.
 */
export function testsCaught(clause: ts.CatchClause): boolean {
  const declaration = clause.variableDeclaration;
  if (declaration === undefined || !ts.isIdentifier(declaration.name)) return false;
  const variable = declaration.name.text;
  const isVariable = (node: ts.Expression): boolean => {
    const inner = stripParentheses(node);
    return ts.isIdentifier(inner) && inner.text === variable;
  };
  const tests = (condition: ts.Node): boolean => {
    if (ts.isBinaryExpression(condition)) {
      const operator = condition.operatorToken.kind;
      if (operator === ts.SyntaxKind.InstanceOfKeyword && isVariable(condition.left)) return true;
      if (operator === ts.SyntaxKind.InKeyword && isVariable(condition.right)) return true;
    }
    if (ts.isPropertyAccessExpression(condition) && isVariable(condition.expression)) return true;
    if (ts.isCallExpression(condition) && condition.arguments.some(isVariable)) return true;
    return ts.forEachChild(condition, (child) => (tests(child) ? true : undefined)) === true;
  };
  let found = false;
  const walk = (node: ts.Node): void => {
    if (found || isFunctionBoundary(node)) return;
    if (ts.isIfStatement(node) && tests(node.expression)) found = true;
    if (ts.isConditionalExpression(node) && tests(node.condition)) found = true;
    if (ts.isSwitchStatement(node)) {
      found ||=
        tests(node.expression) ||
        node.caseBlock.clauses.some((one) => ts.isCaseClause(one) && tests(one.expression));
    }
    ts.forEachChild(node, walk);
  };
  walk(clause.block);
  return found;
}

/** A parameter of a function around `node` with this name: `reject`, `next`, `onError`. */
function isParameterOfEnclosing(name: string, node: ts.Node): boolean {
  for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (
      ts.isFunctionLike(parent) &&
      parent.parameters.some(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `call`, in `clause`, hands the caught error to a callback the function around it was
 * given (`reject(e)`, `next(e)`, `onError(e)`): the caller gets it, as with a rethrow.
 */
export function handsOnCaught(call: ts.CallExpression, clause: ts.CatchClause): boolean {
  const declaration = clause.variableDeclaration;
  if (declaration === undefined || !ts.isIdentifier(declaration.name)) return false;
  const variable = declaration.name.text;
  const callee = stripParentheses(call.expression);
  return (
    ts.isIdentifier(callee) &&
    isParameterOfEnclosing(callee.text, clause) &&
    call.arguments.some((argument) => {
      const inner = stripParentheses(argument);
      return ts.isIdentifier(inner) && inner.text === variable;
    })
  );
}

/** Whether `test` holds for `root` or a node under it, without entering nested functions or classes. */
export function someRunning(root: ts.Node, test: (node: ts.Node) => boolean): boolean {
  const walk = (node: ts.Node): boolean =>
    (node === root || !isFunctionBoundary(node)) &&
    (test(node) || ts.forEachChild(node, (child) => (walk(child) ? true : undefined)) === true);
  return walk(root);
}
