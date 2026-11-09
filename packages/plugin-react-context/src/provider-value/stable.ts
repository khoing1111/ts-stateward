/**
 * Whether a Provider's value never changes, for a context stated `Stable`: what the value is
 * built from must keep its identity for the life of the component. A setter or `dispatch`, a ref,
 * a module constant, state whose setter is never read, and `useMemo`/`useCallback` whose
 * dependencies are all of those qualify; other state, props and new objects do not. Anything stateward cannot follow is not proven.
 */
import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import { packageHookValue } from "./packages.js";
import { calleeName, reactName, unwrapped } from "./react.js";
import type { RenderFunction } from "./value.js";

/** The guarantee a context states when its type has `Stable`. */
export const STABLE = "stable";

/** Why a value is not proven stable, and the node that shows it. */
export type Unstable =
  | { kind: "fresh"; what: "object" | "array" | "function" | "instance"; node: ts.Node }
  | { kind: "changes"; name: string; why: Why; node: ts.Node }
  | { kind: "no-dependencies"; hook: string; node: ts.Node }
  | { kind: "unknown"; text: string; node: ts.Node };

/** What a name the value depends on is, when it can change. */
export type Why = "state" | "prop" | "let" | "ref" | "context" | "value";

/** Hooks whose tuple has a stable member at this index: the setter or `dispatch`. */
const STABLE_MEMBER: ReadonlyMap<string, number> = new Map([
  ["useState", 1],
  ["useReducer", 1],
  ["useActionState", 1],
  ["useTransition", 1],
  ["useOptimistic", 1],
]);

/**
 * Hooks whose state changes only through the member at `STABLE_MEMBER`: with that member never
 * taken, the state keeps its first value. Not `useOptimistic` (it follows its first argument) or
 * `useActionState` and `useTransition` (React sets them while an action runs).
 */
const SET_ONLY_BY_MEMBER: ReadonlySet<string> = new Set(["useState", "useReducer"]);

/** Hooks whose whole result keeps its identity. */
const STABLE_RESULT: ReadonlySet<string> = new Set(["useRef", "useId"]);

const MAX_DEPTH = 8;

/**
 * Reads one render function's values. `compiled`: the React Compiler memoizes a literal by what
 * it reads, so a literal is stable when everything it reads is.
 */
export class StableScope {
  constructor(
    private readonly types: TypeQueries,
    private readonly fn: RenderFunction,
    private readonly compiled: boolean,
  ) {}

  /** Undefined when the value never changes; otherwise the first reason it may. */
  check(expression: ts.Expression, depth = 0): Unstable | undefined {
    if (depth > MAX_DEPTH) return { kind: "unknown", text: short(expression), node: expression };
    const node = unwrapped(expression);
    if (isConstantLiteral(node)) return undefined;
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isNewExpression(node)
    ) {
      return this.compiled ? this.reads(node, depth) : { kind: "fresh", what: kindOf(node), node };
    }
    if (ts.isConditionalExpression(node)) {
      return (
        this.check(node.condition, depth + 1) ??
        this.check(node.whenTrue, depth + 1) ??
        this.check(node.whenFalse, depth + 1)
      );
    }
    if (ts.isBinaryExpression(node)) {
      return this.check(node.left, depth + 1) ?? this.check(node.right, depth + 1);
    }
    if (ts.isIdentifier(node)) return this.identifier(node, depth);
    if (ts.isPropertyAccessExpression(node)) {
      const base = this.check(node.expression, depth + 1);
      if (base !== undefined) return base;
      // `ref.current` is what the ref holds now, and it is meant to change.
      return node.name.text === "current" && this.isRef(node.expression)
        ? { kind: "changes", name: short(node), why: "ref", node }
        : undefined;
    }
    if (ts.isCallExpression(node)) return this.call(node, depth);
    return { kind: "unknown", text: short(node), node };
  }

  /** A literal under the React Compiler: stable when every name it reads from the function is. */
  private reads(node: ts.Node, depth: number): Unstable | undefined {
    let found: Unstable | undefined;
    const visit = (child: ts.Node): void => {
      if (found !== undefined) return;
      if (ts.isIdentifier(child) && isReference(child)) {
        const declaration = this.declarationOf(child);
        if (declaration !== undefined && this.isLocal(declaration) && !within(declaration, node)) {
          found = this.identifier(child, depth + 1);
          return;
        }
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, visit);
    return found;
  }

  private identifier(node: ts.Identifier, depth: number): Unstable | undefined {
    if (node.text === "undefined") return undefined;
    const declaration = this.declarationOf(node);
    if (declaration === undefined) return { kind: "unknown", text: node.text, node };
    if (!this.isLocal(declaration)) return undefined;
    if (ts.isParameter(declaration)) return { kind: "changes", name: node.text, why: "prop", node };
    if (ts.isBindingElement(declaration)) return this.binding(declaration, node, depth);
    if (ts.isFunctionDeclaration(declaration)) {
      return this.compiled
        ? this.reads(declaration, depth)
        : { kind: "fresh", what: "function", node: declaration };
    }
    if (ts.isVariableDeclaration(declaration)) {
      if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0) {
        return { kind: "changes", name: node.text, why: "let", node: declaration };
      }
      return declaration.initializer === undefined
        ? undefined
        : this.check(declaration.initializer, depth + 1);
    }
    return { kind: "unknown", text: node.text, node };
  }

  /** `const [state, setState] = useState(…)`, `const { a } = props`. */
  private binding(
    element: ts.BindingElement,
    node: ts.Identifier,
    depth: number,
  ): Unstable | undefined {
    const pattern = element.parent;
    const holder = pattern.parent;
    if (ts.isParameter(holder) || within(holder, this.fn.parameters)) {
      return { kind: "changes", name: node.text, why: "prop", node };
    }
    if (!ts.isVariableDeclaration(holder) || holder.initializer === undefined) {
      return { kind: "unknown", text: node.text, node };
    }
    const init = unwrapped(holder.initializer);
    if (ts.isCallExpression(init) && ts.isArrayBindingPattern(pattern)) {
      const hook = reactName(this.types, calleeName(init.expression));
      const stable = hook === undefined ? undefined : STABLE_MEMBER.get(hook);
      if (stable !== undefined) {
        const index = pattern.elements.indexOf(element);
        if (index === stable) return undefined;
        // State that nothing can set keeps its first value: `const [store] = useState(createStore)`.
        if (index === 0 && SET_ONLY_BY_MEMBER.has(hook ?? "") && !this.isTaken(pattern, stable)) {
          return undefined;
        }
        return { kind: "changes", name: node.text, why: "state", node: element };
      }
    }
    // `const { dispatch } = store`: a member of a value that never changes is the same member.
    return ts.isIdentifier(init) && ts.isObjectBindingPattern(pattern)
      ? this.check(init, depth + 1)
      : { kind: "changes", name: node.text, why: "value", node: element };
  }

  private call(node: ts.CallExpression, depth: number): Unstable | undefined {
    const callee = calleeName(node.expression);
    const hook = reactName(this.types, callee);
    if (hook === "useMemo" || hook === "useCallback") {
      const dependencies = node.arguments[1];
      if (dependencies === undefined) return { kind: "no-dependencies", hook, node };
      const list = unwrapped(dependencies);
      if (!ts.isArrayLiteralExpression(list)) {
        return { kind: "unknown", text: short(dependencies), node: dependencies };
      }
      for (const element of list.elements) {
        const found = this.check(element, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (hook !== undefined && STABLE_RESULT.has(hook)) return undefined;
    if (hook === "useContext" || hook === "use") {
      const context = node.arguments[0];
      return context !== undefined && this.types.guaranteesOf(context).includes(STABLE)
        ? undefined
        : { kind: "changes", name: short(node), why: "context", node };
    }
    if (hook === undefined) {
      const symbol = this.types.symbolAt(callee);
      const declaration = symbol === undefined ? undefined : this.types.declarationOf(symbol);
      const owner = declaration === undefined ? undefined : this.types.packageOf(declaration.file);
      if (
        symbol !== undefined &&
        owner !== undefined &&
        packageHookValue(owner, symbol.name) === "stable"
      ) {
        return undefined;
      }
    }
    return { kind: "unknown", text: short(node), node };
  }

  /**
   * Whether the tuple member at `index` is bound and read anywhere in the render function. A
   * read is any identifier with the binding's name, so a shadowing name counts as a read: the
   * state is then reported, never missed.
   */
  private isTaken(pattern: ts.ArrayBindingPattern, index: number): boolean {
    if (
      pattern.elements.some((element) => ts.isBindingElement(element) && element.dotDotDotToken)
    ) {
      return true;
    }
    const member = pattern.elements[index];
    if (member === undefined || ts.isOmittedExpression(member)) return false;
    if (!ts.isIdentifier(member.name)) return true;
    const name = member.name;
    let read = false;
    const visit = (child: ts.Node): void => {
      if (read) return;
      if (
        ts.isIdentifier(child) &&
        child !== name &&
        child.text === name.text &&
        isReference(child)
      ) {
        read = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(this.fn, visit);
    return read;
  }

  /** Whether an expression is a `useRef(…)` value of this function. */
  private isRef(expression: ts.Expression): boolean {
    const node = unwrapped(expression);
    if (!ts.isIdentifier(node)) return false;
    const declaration = this.declarationOf(node);
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
    const init = declaration.initializer && unwrapped(declaration.initializer);
    return (
      init !== undefined &&
      ts.isCallExpression(init) &&
      reactName(this.types, calleeName(init.expression)) === "useRef"
    );
  }

  private declarationOf(node: ts.Identifier): ts.Node | undefined {
    const symbol = this.types.symbolAt(node);
    return symbol === undefined ? undefined : this.types.declarationOf(symbol)?.node;
  }

  private isLocal(node: ts.Node): boolean {
    return (
      node.getSourceFile() === this.fn.getSourceFile() &&
      node.pos >= this.fn.pos &&
      node.end <= this.fn.end
    );
  }
}

function within(node: ts.Node, outer: ts.Node | ts.NodeArray<ts.Node>): boolean {
  return node.pos >= outer.pos && node.end <= outer.end;
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name !== node;
  if (ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)) return parent.name !== node;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false;
  if (ts.isParameter(parent) || ts.isBindingElement(parent)) return parent.name !== node;
  return true;
}

function isConstantLiteral(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

function kindOf(node: ts.Node): "object" | "array" | "function" | "instance" {
  if (ts.isObjectLiteralExpression(node)) return "object";
  if (ts.isArrayLiteralExpression(node)) return "array";
  return ts.isNewExpression(node) ? "instance" : "function";
}

function short(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}
