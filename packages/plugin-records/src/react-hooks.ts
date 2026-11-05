import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";

/** Where React is declared: a built copy in node_modules or its types. */
const REACT_PACKAGE = /[\\/]node_modules[\\/](?:@types[\\/])?react[\\/]/;

export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || /^use[A-Z0-9]/.test(name);
}

/** The name a function is declared with, also through `memo(…)`, `forwardRef(…)` and casts. */
export function functionName(node: ts.FunctionLikeDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
    if (node.name !== undefined) return node.name.text;
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  let parent: ts.Node = node.parent;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isCallExpression(parent)
  ) {
    parent = parent.parent;
  }
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}

export function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

export function isComponentOrHook(node: ts.Node): node is ts.FunctionLikeDeclaration {
  if (!isFunctionLike(node) || node.body === undefined) return false;
  const name = functionName(node);
  return name !== undefined && isComponentName(name);
}

function calleeName(call: ts.CallExpression): ts.Node | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee;
  return ts.isPropertyAccessExpression(callee) ? callee.name : undefined;
}

/** Whether the call is React's `useState`, by where the callee is declared, not by its name. */
export function isReactUseState(call: ts.CallExpression, ctx: FileContext): boolean {
  const name = calleeName(call);
  if (name === undefined) return false;
  const symbol = ctx.types.symbolAt(name);
  if (symbol?.name !== "useState") return false;
  const declaration = ctx.types.declarationOf(symbol);
  return declaration !== undefined && REACT_PACKAGE.test(declaration.file);
}
