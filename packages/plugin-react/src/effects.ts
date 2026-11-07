import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import { calleeName, isReactCall, reactName, unwrapped } from "./react.js";

/** The hooks that run a callback after rendering, with a dependency array. */
const EFFECT_HOOKS: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

export type EffectCallback = ts.ArrowFunction | ts.FunctionExpression;

/**
 * An effect as written: `useEffect(() => { … }, [a, b])`. `deps` is "none" when the call has no
 * dependency array (it runs after every render) and "unreadable" when the array is not written
 * in place (`useEffect(fn, deps)`).
 */
export type Effect = {
  readonly call: ts.CallExpression;
  readonly hook: string;
  readonly callback: EffectCallback;
  readonly deps: readonly ts.Expression[] | "none" | "unreadable";
  /** The component or hook the effect is declared in. */
  readonly owner: ts.SignatureDeclaration;
};

export function isFunctionNode(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** The nearest function around a node, or undefined at module level. */
export function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (isFunctionNode(current)) return current;
  }
  return undefined;
}

/**
 * The effects of the last file asked about, by the queries they were found with: seven rules ask
 * for the effects of the same file one after the other, and one walk serves them all. Only the last file is kept, so a run holds no more than one file's nodes here.
 */
const lastEffects = new WeakMap<
  TypeQueries,
  { readonly sourceFile: ts.SourceFile; readonly effects: readonly Effect[] }
>();

/** Every effect in a file, in source order. */
export function effectsIn(types: TypeQueries, sourceFile: ts.SourceFile): readonly Effect[] {
  const known = lastEffects.get(types);
  if (known?.sourceFile === sourceFile) return known.effects;
  const effects = findEffects(types, sourceFile);
  lastEffects.set(types, { sourceFile, effects });
  return effects;
}

function findEffects(types: TypeQueries, sourceFile: ts.SourceFile): readonly Effect[] {
  const found: Effect[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const hook = reactName(types, calleeName(node.expression));
      const first = node.arguments[0];
      const callback = first === undefined ? undefined : unwrapped(first);
      const owner = enclosingFunction(node);
      if (
        hook !== undefined &&
        EFFECT_HOOKS.has(hook) &&
        callback !== undefined &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        owner !== undefined
      ) {
        const second = node.arguments[1];
        const list = second === undefined ? undefined : unwrapped(second);
        const deps =
          list === undefined
            ? "none"
            : ts.isArrayLiteralExpression(list)
              ? [...list.elements]
              : "unreadable";
        found.push({ call: node, hook, callback, deps, owner });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Visits the code that runs when `fn` runs: its body without the functions declared in it,
 * since those run later, if at all.
 */
export function forEachOwn(fn: ts.SignatureDeclaration, visit: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    visit(node);
    if (!isFunctionNode(node)) ts.forEachChild(node, walk);
  };
  const body = ts.isFunctionLike(fn) && "body" in fn ? fn.body : undefined;
  if (body !== undefined) walk(body);
}

/** A `const [value, setValue] = useState(…)` as written. */
export type StateBinding = {
  state: string;
  setter: string;
  call: ts.CallExpression;
  /** The initial value, a lazy initializer's result included (`useState(() => props.name)`). */
  initial: ts.Expression | undefined;
};

/** The `useState` binding an identifier is declared by, and which of its two names it is. */
export function bindingOf(
  types: TypeQueries,
  identifier: ts.Node,
): { binding: StateBinding; part: "state" | "setter" } | undefined {
  const symbol = types.symbolAt(identifier);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol)?.node;
  if (declaration === undefined || !ts.isBindingElement(declaration)) return undefined;
  const pattern = declaration.parent;
  if (!ts.isArrayBindingPattern(pattern) || !ts.isVariableDeclaration(pattern.parent)) {
    return undefined;
  }
  const init = pattern.parent.initializer;
  const call = init === undefined ? undefined : unwrapped(init);
  if (call === undefined || !ts.isCallExpression(call) || !isReactCall(types, call, "useState")) {
    return undefined;
  }
  const [stateElement, setterElement] = pattern.elements;
  const nameOf = (element: ts.ArrayBindingElement | undefined): string | undefined =>
    element !== undefined && ts.isBindingElement(element) && ts.isIdentifier(element.name)
      ? element.name.text
      : undefined;
  const state = nameOf(stateElement);
  const setter = nameOf(setterElement);
  if (state === undefined || setter === undefined) return undefined;
  const index = pattern.elements.indexOf(declaration);
  const first = call.arguments[0];
  const argument = first === undefined ? undefined : unwrapped(first);
  const initial =
    argument !== undefined && ts.isArrowFunction(argument) && !ts.isBlock(argument.body)
      ? unwrapped(argument.body)
      : argument;
  return {
    binding: { state, setter, call, initial },
    part: index === 0 ? "state" : "setter",
  };
}

/** The `useState` binding a call sets: `setName(…)` gives the binding of `name`. */
export function setterCall(
  types: TypeQueries,
  node: ts.Node,
): { binding: StateBinding; call: ts.CallExpression } | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = unwrapped(node.expression);
  if (!ts.isIdentifier(callee)) return undefined;
  const found = bindingOf(types, callee);
  return found?.part === "setter" ? { binding: found.binding, call: node } : undefined;
}

/** Whether a declaration is one of `fn`'s parameters, or a name destructured from one. */
function parameterOf(declaration: ts.Node, fn: ts.SignatureDeclaration): boolean {
  let current: ts.Node = declaration;
  while (ts.isBindingElement(current)) current = current.parent.parent;
  return ts.isParameter(current) && current.parent === fn;
}

/**
 * The prop (or hook parameter) an expression reads, by its name: `first` for `first`
 * destructured from the props, and for `props.first`. Undefined for anything else.
 */
export function propOf(
  types: TypeQueries,
  expression: ts.Expression,
  owner: ts.SignatureDeclaration,
): string | undefined {
  const node = unwrapped(expression);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const declaration = declarationNode(types, node.expression);
    return declaration !== undefined &&
      ts.isParameter(declaration) &&
      declaration.parent === owner &&
      ts.isIdentifier(declaration.name)
      ? node.name.text
      : undefined;
  }
  if (!ts.isIdentifier(node)) return undefined;
  const declaration = declarationNode(types, node);
  if (declaration === undefined || !parameterOf(declaration, owner)) return undefined;
  if (ts.isBindingElement(declaration)) {
    const key = declaration.propertyName ?? declaration.name;
    return ts.isIdentifier(key) ? key.text : undefined;
  }
  return node.text;
}

export function declarationNode(types: TypeQueries, node: ts.Node): ts.Node | undefined {
  const symbol = types.symbolAt(node);
  return symbol === undefined ? undefined : types.declarationOf(symbol)?.node;
}

/** Whether a declaration is inside `container` (a function's body, an expression). */
export function within(declaration: ts.Node, container: ts.Node): boolean {
  return (
    declaration.getSourceFile() === container.getSourceFile() &&
    declaration.pos >= container.pos &&
    declaration.end <= container.end
  );
}

/** Whether an identifier is a name being read, not a property name or a declared name. */
export function isRead(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === identifier) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent)) &&
    parent.name === identifier
  ) {
    return false;
  }
  return true;
}

/** "`a`", "`a` and `b`", "`a`, `b` and `c`", "`a`, `b` and 2 more". */
export function nameList(names: readonly string[], cut: (text: string) => string): string {
  const quoted = names.map((name) => `\`${cut(name)}\``);
  if (quoted.length <= 1) return quoted.join("");
  if (quoted.length > 3) {
    return `${quoted.slice(0, 2).join(", ")} and ${String(quoted.length - 2)} more`;
  }
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1] ?? ""}`;
}

/**
 * The functions an effect returns as its cleanup: `return () => …`, `return cleanup` for a
 * function declared in the effect, or a call whose result is the cleanup (`return store.subscribe(…)`).
 */
export type Cleanups = {
  /** The cleanup functions written in the effect. */
  functions: ts.SignatureDeclaration[];
  /** Calls whose result the effect returns as its cleanup. */
  returnedCalls: ts.CallExpression[];
  /** Whether the effect returns something stateward cannot read as a function. */
  unreadable: boolean;
};

export function cleanupsOf(types: TypeQueries, effect: Effect): Cleanups {
  const cleanups: Cleanups = { functions: [], returnedCalls: [], unreadable: false };
  const { callback } = effect;
  const add = (expression: ts.Expression): void => {
    const value = unwrapped(expression);
    // `return undefined;` and `return void 0;` leave the effect without a cleanup on that path.
    if ((ts.isIdentifier(value) && value.text === "undefined") || ts.isVoidExpression(value)) {
      return;
    }
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      cleanups.functions.push(value);
      return;
    }
    if (ts.isCallExpression(value)) {
      cleanups.returnedCalls.push(value);
      return;
    }
    if (ts.isIdentifier(value)) {
      const declaration = declarationNode(types, value);
      if (declaration !== undefined && within(declaration, callback)) {
        if (ts.isFunctionDeclaration(declaration)) {
          cleanups.functions.push(declaration);
          return;
        }
        if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
          add(declaration.initializer);
          return;
        }
      }
    }
    cleanups.unreadable = true;
  };
  if (!ts.isBlock(callback.body)) {
    // `useEffect(() => store.subscribe(onChange), [])` returns the call's result.
    add(callback.body);
    return cleanups;
  }
  forEachOwn(callback, (node) => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) add(node.expression);
  });
  return cleanups;
}

/**
 * The calls a cleanup makes, following calls to functions declared in the effect one level deep
 * (`return () => stop()` with `function stop() { … }` in the effect).
 */
export function cleanupCalls(
  types: TypeQueries,
  effect: Effect,
  cleanups: Cleanups,
): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const seen = new Set<ts.Node>();
  const collect = (fn: ts.Node, depth: number): void => {
    if (seen.has(fn)) return;
    seen.add(fn);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        calls.push(node);
        const callee = unwrapped(node.expression);
        if (depth === 0 && ts.isIdentifier(callee)) {
          const declaration = declarationNode(types, callee);
          if (declaration !== undefined && within(declaration, effect.callback)) {
            const target =
              ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
                ? unwrapped(declaration.initializer)
                : declaration;
            if (isFunctionNode(target)) collect(target, depth + 1);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
  };
  for (const fn of cleanups.functions) collect(fn, 0);
  return calls;
}

/** The text of a node on one line. */
export function textOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

/** Whether the state starts as the same prop the effect copies: `react/state-copies-prop`. */
export function startsAsProp(
  types: TypeQueries,
  binding: StateBinding,
  value: ts.Expression,
  owner: ts.SignatureDeclaration,
): boolean {
  if (binding.initial === undefined) return false;
  const prop = propOf(types, value, owner);
  return prop !== undefined && propOf(types, binding.initial, owner) === prop;
}
