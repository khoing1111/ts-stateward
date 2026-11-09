// A copy of the parts of @stateward/plugin-react's react.ts that this rule uses: a pack depends on
// core only (SW3), so the two packs do not share code.
import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";

/** The packages React's own functions are declared in: the runtime, or its types. */
const REACT_PACKAGES: ReadonlySet<string> = new Set(["react", "@types/react"]);

/**
 * The packages that turn the React Compiler on: it memoizes components and hooks, so a value
 * written inline keeps its identity between renders and the render-stability rules stay silent.
 */
const COMPILER_PACKAGES: readonly string[] = [
  "babel-plugin-react-compiler",
  "react-compiler-runtime",
];

/** Whether the project a file belongs to uses the React Compiler (its nearest package.json). */
export function usesCompiler(types: TypeQueries, file: string): boolean {
  const dependencies = types.dependenciesOf(file);
  return COMPILER_PACKAGES.some((name) => dependencies.includes(name));
}

/** The hooks whose result keeps its identity between renders (a setter, a ref, a memoized value). */
export const STABLE_HOOKS: ReadonlySet<string> = new Set([
  "useCallback",
  "useMemo",
  "useRef",
  "useState",
  "useReducer",
  "useContext",
  "useId",
  "useTransition",
  "useDeferredValue",
  "useSyncExternalStore",
  "useActionState",
  "useOptimistic",
  "useEffectEvent",
]);

/** The name a node is declared with in React (`useEffect`, `memo`, `Provider`), or undefined. */
export function reactName(types: TypeQueries, node: ts.Node): string | undefined {
  const symbol = types.symbolAt(node);
  if (symbol === undefined) return undefined;
  const declaration = types.declarationOf(symbol);
  if (declaration === undefined) return undefined;
  const owner = types.packageOf(declaration.file);
  return owner !== undefined && REACT_PACKAGES.has(owner) ? symbol.name : undefined;
}

/** The node that names what a call calls: `useEffect` in `useEffect(…)` and `React.useEffect(…)`. */
export function calleeName(expression: ts.Expression): ts.Node {
  const callee = unwrapped(expression);
  return ts.isPropertyAccessExpression(callee) ? callee.name : callee;
}

/** An expression without parentheses, `as`, `satisfies` and `!`. */
export function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Whether a call is React's `name` (`memo(…)`, `React.memo(…)`). */
export function isReactCall(types: TypeQueries, node: ts.Node, name: string): boolean {
  const inner = ts.isExpression(node) ? unwrapped(node) : node;
  return ts.isCallExpression(inner) && reactName(types, calleeName(inner.expression)) === name;
}
