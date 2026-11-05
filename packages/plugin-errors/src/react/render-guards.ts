import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";
import { scanRunning, stripParentheses } from "../syntax.js";

/**
 * The throws while rendering that `errors/render-throw-without-boundary` leaves out (they were
 * `errors/throw-in-hook`'s skips in earlier releases): the usual check in a context hook
 * (`if (!ctx) throw new Error("useAuth must be used within AuthProvider")`), and a check on what
 * the caller passed (`if (!render && !children) throw …`). Both name a programming mistake of the
 * caller; an error boundary is not what handles them.
 */

type RenderFunction = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** A component or hook: its function and its body. */
type Render = { fn: RenderFunction; body: ts.ConciseBody };

/** Which guards to leave out. */
export type GuardSkips = { readonly contextGuards: boolean; readonly inputGuards: boolean };

/** Both left out: the default. */
export const ALL_GUARDS: GuardSkips = { contextGuards: true, inputGuards: true };

/** `useContext(X)` or `React.useContext(X)`. */
function isUseContextCall(expression: ts.Expression): boolean {
  const node = stripParentheses(expression);
  if (!ts.isCallExpression(node)) return false;
  const callee = stripParentheses(node.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  return ts.isIdentifier(name) && name.text === "useContext";
}

/**
 * Whether an expression is the value a context gives: a `useContext(X)` call, or a local `const`
 * initialized with one. A property of it (`ctx.user`) is the app's state, not the Provider.
 */
function isContextValue(expression: ts.Expression, ctx: FileContext): boolean {
  const node = stripParentheses(expression);
  if (isUseContextCall(node)) return true;
  if (!ts.isIdentifier(node)) return false;
  const symbol = ctx.types.symbolAt(node);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
  const list = declaration.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined &&
    isUseContextCall(declaration.initializer)
  );
}

function isNullish(expression: ts.Expression): boolean {
  const node = stripParentheses(expression);
  return (
    node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === "undefined")
  );
}

/**
 * Whether a condition holds when a context value is missing: `!ctx`, `ctx == null`,
 * `ctx === undefined` (either side), or an `||` of such checks.
 */
function checksMissingContext(condition: ts.Expression, ctx: FileContext): boolean {
  const node = stripParentheses(condition);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return isContextValue(node.operand, ctx);
  }
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.BarBarToken) {
    return checksMissingContext(node.left, ctx) && checksMissingContext(node.right, ctx);
  }
  if (
    operator !== ts.SyntaxKind.EqualsEqualsToken &&
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return false;
  }
  return (
    (isMissingMarker(node.right, ctx) && isContextValue(node.left, ctx)) ||
    (isMissingMarker(node.left, ctx) && isContextValue(node.right, ctx))
  );
}

/**
 * What a context gives when its Provider is missing: `null`, `undefined`, or a sentinel, a
 * `const` declared at the top of the file (`const missing = {}` as the context's default).
 */
function isMissingMarker(expression: ts.Expression, ctx: FileContext): boolean {
  if (isNullish(expression)) return true;
  const node = stripParentheses(expression);
  if (!ts.isIdentifier(node)) return false;
  const symbol = ctx.types.symbolAt(node);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
  const list = declaration.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isVariableStatement(list.parent) &&
    ts.isSourceFile(list.parent.parent)
  );
}

/** Whether a declaration is a parameter of `fn`, or a name bound by destructuring one. */
function isParameterOf(declaration: ts.Node, fn: RenderFunction): boolean {
  for (let node: ts.Node = declaration; node !== fn; node = node.parent) {
    if (ts.isParameter(node)) return node.parent === fn;
    if (
      !ts.isBindingElement(node) &&
      !ts.isObjectBindingPattern(node) &&
      !ts.isArrayBindingPattern(node)
    ) {
      return false;
    }
  }
  return false;
}

/**
 * A hook that hands over a context: named `use…Context`, or one whose body is `useContext(X)`
 * (`const usePreferencesEditor = () => useContext(EditorContext)`).
 */
function isContextHook(callee: ts.Expression, ctx: FileContext): boolean {
  const node = stripParentheses(callee);
  if (!ts.isIdentifier(node)) return false;
  if (/^use\w*Context$/.test(node.text)) return true;
  const symbol = ctx.types.symbolAt(node);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (declaration === undefined) return false;
  const fn =
    ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
      ? stripParentheses(declaration.initializer)
      : declaration;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn) && !ts.isFunctionDeclaration(fn)) {
    return false;
  }
  const body = fn.body;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return isUseContextCall(body);
  // A wrapper that reads a context, maybe guards it, and returns it (`usePreferencesEditor`).
  let reads = false;
  scanRunning(body, (node) => {
    if (ts.isCallExpression(node) && isUseContextCall(node)) reads = true;
  });
  return reads;
}

/**
 * A name destructured from a parameter in the body: `const { children, render } = props;`.
 */
function isDestructuredParameter(declaration: ts.Node, render: Render, ctx: FileContext): boolean {
  if (!ts.isBindingElement(declaration)) return false;
  let pattern: ts.Node = declaration.parent;
  while (ts.isBindingElement(pattern.parent)) pattern = pattern.parent.parent;
  const variable = pattern.parent;
  if (!ts.isVariableDeclaration(variable) || variable.initializer === undefined) return false;
  const source = stripParentheses(variable.initializer);
  return ts.isIdentifier(source) && isParameterName(source, render, ctx);
}

/**
 * Who answers for an input: `parameter` for a parameter (or a prop destructured from one, or
 * `props.x`), `context` for a value read through a context hook; undefined for anything else.
 */
function callerInput(
  expression: ts.Expression,
  render: Render,
  ctx: FileContext,
): "parameter" | "context" | undefined {
  const node = stripParentheses(expression);
  if (ts.isPropertyAccessExpression(node)) {
    const owner = stripParentheses(node.expression);
    // `props.title`; a property of a context value is the app's state (`ctx.user`), not a prop.
    return ts.isIdentifier(owner) && isParameterName(owner, render, ctx) ? "parameter" : undefined;
  }
  if (!ts.isIdentifier(node)) return undefined;
  const symbol = ctx.types.symbolAt(node);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (declaration === undefined) return undefined;
  if (isParameterOf(declaration, render.fn) || isDestructuredParameter(declaration, render, ctx)) {
    return "parameter";
  }
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
    return undefined;
  }
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) {
    return undefined;
  }
  const init = stripParentheses(declaration.initializer);
  return ts.isCallExpression(init) && isContextHook(init.expression, ctx) ? "context" : undefined;
}

/** The missing values a check tests for: `x === undefined`, `x === null`, or both (`!x`, `x == null`). */
type Missing = { readonly undefined: boolean; readonly null: boolean };

const EITHER: Missing = { undefined: true, null: true };

/**
 * Whether a check for a missing input names a caller's mistake. A parameter's check does only
 * when its type rules the value out: a prop typed `title?: string` can be left out by any caller,
 * so its check is a render failure. A context hook's value is missing only
 * when a Provider is, which is the caller's mistake.
 */
function isCallerMistake(
  expression: ts.Expression,
  missing: Missing,
  render: Render,
  ctx: FileContext,
): boolean {
  const input = callerInput(expression, render, ctx);
  if (input !== "parameter") return input === "context";
  const node = stripParentheses(expression);
  return (
    !(missing.undefined && ctx.types.canBeUndefined(node)) &&
    !(missing.null && ctx.types.canBeNull(node))
  );
}

function isParameterName(node: ts.Identifier, render: Render, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(node);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  return declaration !== undefined && isParameterOf(declaration, render.fn);
}

/** What a comparison with `undefined` or `null` tests for; undefined for any other operand. */
function missingTested(operand: ts.Expression, loose: boolean): Missing | undefined {
  const node = stripParentheses(operand);
  if (node.kind === ts.SyntaxKind.NullKeyword)
    return loose ? EITHER : { undefined: false, null: true };
  if (ts.isIdentifier(node) && node.text === "undefined") {
    return loose ? EITHER : { undefined: true, null: false };
  }
  return undefined;
}

/**
 * Whether a condition holds only when an input is missing through a caller's mistake: `!x`,
 * `x == null`, `x === undefined` (either side), and `&&` / `||` of such checks.
 */
function checksMissingInput(condition: ts.Expression, render: Render, ctx: FileContext): boolean {
  const node = stripParentheses(condition);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return isCallerMistake(node.operand, EITHER, render, ctx);
  }
  if (!ts.isBinaryExpression(node)) return false;
  const operator = node.operatorToken.kind;
  if (
    operator === ts.SyntaxKind.BarBarToken ||
    operator === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return (
      checksMissingInput(node.left, render, ctx) && checksMissingInput(node.right, render, ctx)
    );
  }
  if (
    operator !== ts.SyntaxKind.EqualsEqualsToken &&
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return false;
  }
  const loose = operator === ts.SyntaxKind.EqualsEqualsToken;
  const right = missingTested(node.right, loose);
  const left = missingTested(node.left, loose);
  return (
    (right !== undefined && isCallerMistake(node.left, right, render, ctx)) ||
    (left !== undefined && isCallerMistake(node.right, left, render, ctx))
  );
}

/** An invariant: `if (!render && !children) throw …`, a programming error of the caller. */
function guardsInput(statement: ts.ThrowStatement, render: Render, ctx: FileContext): boolean {
  for (const guard of enclosingIfs(statement, render.body)) {
    if (checksMissingInput(guard.expression, render, ctx)) return true;
  }
  return false;
}

/** The `if` whose `then` branch holds `node`, nearest first, up to the render body. */
function* enclosingIfs(node: ts.Node, body: ts.Node): Generator<ts.IfStatement> {
  let child = node;
  for (let parent = node.parent; child !== body; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && parent.thenStatement === child) yield parent;
  }
}

/** The guard of a context hook: `if (!ctx) throw new Error("useX must be used within XProvider")`. */
function guardsContext(statement: ts.ThrowStatement, body: ts.Node, ctx: FileContext): boolean {
  for (const guard of enclosingIfs(statement, body)) {
    if (checksMissingContext(guard.expression, ctx)) return true;
  }
  return false;
}

/**
 * The start of the thrown expression of every guard `throw` in the render function's own body
 * (not in a nested function), as the throws summary records it (`new Error(…)`).
 */
export function guardThrows(fn: RenderFunction, ctx: FileContext, skips: GuardSkips): number[] {
  const body = fn.body;
  if (body === undefined || (!skips.contextGuards && !skips.inputGuards)) return [];
  const render: Render = { fn, body };
  const found: number[] = [];
  scanRunning(body, (node) => {
    if (!ts.isThrowStatement(node)) return;
    const guard =
      (skips.contextGuards && guardsContext(node, body, ctx)) ||
      (skips.inputGuards && guardsInput(node, render, ctx));
    if (guard) found.push(stripParentheses(node.expression).getStart(ctx.sourceFile));
  });
  return found;
}
