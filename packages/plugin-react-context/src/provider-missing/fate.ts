import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import { enclosingFunction, shortText, type FunctionLike } from "./syntax.js";

/**
 * What becomes of a JSX element: it is rendered at `sites` (the element itself, or each place a
 * variable holding it is used), or it escapes to something stateward does not follow.
 */
export type Fate =
  | { kind: "rendered"; sites: readonly ts.Node[] }
  | {
      kind: "escapes";
      detail: string;
      /** The function the value is given to, as written (`wrap` in `wrap(children)`). */
      call?: string;
      /** The value is only looked at (a condition, a comparison, `typeof`), not handed on. */
      inspected?: true;
    };

/**
 * What fate needs to know: the type queries, and which nodes are places that render what they
 * hold (the `element` of a React Router route object, the routes given to a router).
 */
export type FateEnv = { types: TypeQueries; rendersIn(node: ts.Node): boolean };

const IN_PLACE_METHODS: ReadonlySet<string> = new Set(["map", "flatMap"]);

function escapes(detail: string): Fate {
  return { kind: "escapes", detail };
}

const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** A use that only looks at the value: `children ? … : …`, `children === null`, `!children`. */
function inspects(node: ts.Node, child: ts.Node): boolean {
  if (ts.isConditionalExpression(node)) return node.condition === child;
  if (ts.isPrefixUnaryExpression(node)) return node.operator === ts.SyntaxKind.ExclamationToken;
  if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) return true;
  if (ts.isIfStatement(node) || ts.isWhileStatement(node)) return node.expression === child;
  if (ts.isBinaryExpression(node)) return COMPARISONS.has(node.operatorToken.kind);
  return false;
}

/** Wrappers of a value that leave it the same value: `(x)`, `x as T`, `a && x`, `[x]`. */
export function isValueWrapper(parent: ts.Node, child: ts.Node): boolean {
  if (ts.isConditionalExpression(parent)) return parent.condition !== child;
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    return (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    );
  }
  return (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isSpreadElement(parent)
  );
}

function isPassThrough(parent: ts.Node, child: ts.Node): boolean {
  return (
    isValueWrapper(parent, child) ||
    ts.isJsxElement(parent) ||
    ts.isJsxFragment(parent) ||
    ts.isJsxExpression(parent) ||
    ts.isJsxAttribute(parent) ||
    ts.isJsxAttributes(parent) ||
    ts.isJsxOpeningElement(parent) ||
    ts.isJsxSelfClosingElement(parent)
  );
}

function functionLabel(fn: ts.Node): string {
  if (ts.isFunctionDeclaration(fn) && fn.name) return `${fn.name.text}()`;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
    return `${parent.name.text}()`;
  if (ts.isCallExpression(parent)) return `${shortText(parent.expression)}()`;
  return "a function";
}

/**
 * Follows an element up through the JSX and expressions that carry it, to the place that decides
 * where it renders. `root` is the component function: a value returned from it is rendered there.
 * A function that returns JSX is followed when it is a render prop or an in-place `.map(…)`.
 */
export function fateOf(
  start: ts.Node,
  root: FunctionLike | undefined,
  env: FateEnv,
  seen: ReadonlySet<string> = new Set(),
): Fate {
  let current = start;
  for (;;) {
    if (env.rendersIn(current)) return { kind: "rendered", sites: [start] };
    const parent = current.parent;
    if (isPassThrough(parent, current)) {
      current = parent;
      continue;
    }
    if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === current)) {
      const fn = ts.isArrowFunction(parent) ? parent : enclosingFunction(parent);
      if (fn === root) return { kind: "rendered", sites: [start] };
      const next = followFunction(fn);
      if (next === undefined) return escapes(functionLabel(fn));
      current = next;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      return fateOfVariable(parent, start, root, env, seen);
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      return {
        kind: "escapes",
        detail: `${shortText(parent.expression)}()`,
        call: shortText(parent.expression),
      };
    }
    if (inspects(parent, current)) {
      return { kind: "escapes", detail: "this expression", inspected: true };
    }
    if (ts.isBinaryExpression(parent)) {
      // `slot.current = children` hands it on; `children + ""` only reads it.
      return ASSIGNMENTS.has(parent.operatorToken.kind)
        ? escapes(shortText(parent.left))
        : { kind: "escapes", detail: shortText(parent.left), inspected: true };
    }
    if (ts.isPropertyAssignment(parent)) return escapes(shortText(parent.name));
    // `children.length`, `children[0]`, `typeof children`: the value is read, not handed on.
    return { kind: "escapes", detail: "this expression", inspected: true };
  }
}

/** Where a function that returns JSX is itself carried: a render prop, or `.map(…)` in place. */
function followFunction(fn: ts.Node): ts.Node | undefined {
  const parent = fn.parent;
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return parent;
  if (!ts.isCallExpression(parent) || !parent.arguments.some((argument) => argument === fn)) {
    return undefined;
  }
  const callee = parent.expression;
  const inPlace = ts.isPropertyAccessExpression(callee) && IN_PLACE_METHODS.has(callee.name.text);
  return inPlace ? parent : undefined;
}

/** `const header = <Header/>`: rendered where `header` is used, if every use is in JSX. */
function fateOfVariable(
  declaration: ts.VariableDeclaration,
  start: ts.Node,
  root: FunctionLike | undefined,
  env: FateEnv,
  seen: ReadonlySet<string>,
): Fate {
  const name = declaration.name;
  if (!ts.isIdentifier(name)) return escapes(shortText(name));
  const symbol = env.types.symbolAt(name);
  if (symbol === undefined || seen.has(symbol.id)) return escapes(name.text);
  const container = enclosingFunction(declaration);
  const uses: Fate[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      if (env.types.symbolAt(node)?.id === symbol.id) {
        uses.push(fateOf(node, root, env, new Set([...seen, symbol.id])));
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(container);
  const sites = uses.flatMap((use) => (use.kind === "rendered" ? use.sites : []));
  const carried = uses.every((use) => use.kind === "rendered");
  if (carried) return { kind: "rendered", sites };
  // Used in JSX and otherwise only looked at (`c ? <div>{c}</div> : null`): rendered where it is.
  const looked = uses.every((use) => use.kind === "rendered" || use.inspected === true);
  if (looked) {
    return sites.length > 0
      ? { kind: "rendered", sites }
      : { kind: "escapes", detail: name.text, inspected: true };
  }
  return escapes(name.text);
}
