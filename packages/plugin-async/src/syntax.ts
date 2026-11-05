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

export function functionOfDeclaration(node: ts.Node): DeclaredFunction | undefined {
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

function declarationName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    if (node.name !== undefined) return node.name.text;
    return node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) === true
      ? "default"
      : undefined;
  }
  if (ts.isExportAssignment(node)) return "default";
  if (ts.isModuleDeclaration(node)) return ts.isIdentifier(node.name) ? node.name.text : undefined;
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isInterfaceDeclaration(node)
  ) {
    return ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  return undefined;
}

/** The declaration's path in the package's types: `["Client", "get"]`. */
export function pathOf(node: ts.Node): string[] {
  const names: string[] = [];
  for (let at: ts.Node = node; !ts.isSourceFile(at); at = at.parent) {
    const name = declarationName(at);
    if (name !== undefined) names.unshift(name);
  }
  return names;
}
