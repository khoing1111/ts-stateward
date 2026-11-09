import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { FileContext, TypeQueries } from "@stateward/core";
import { calleeName, reactName, unwrapped } from "./provider-value/react.js";

const EXPLAIN = `# react-context/value-changed-by-reader

Reports a component or hook that changes the value it reads from a context (assigns or deletes a property, or calls \`push\`, \`set\` or \`add\` on an array, Map or Set in it): React re-renders the readers only when the Provider passes a new value, so the change does not show.

\`\`\`tsx example-bad
import { createContext, useContext } from "react";

type Cart = { items: string[] };
const CartContext = createContext<Cart>({ items: [] });

export function AddButton({ item }: { item: string }) {
  const cart = useContext(CartContext);
  return <button onClick={() => cart.items.push(item)}>Add</button>;
}
\`\`\`

Put a function in the context that sets the Provider's state, and call it:

\`\`\`tsx example-good
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Cart = { items: readonly string[]; add: (item: string) => void };
const CartContext = createContext<Cart>({ items: [], add: () => {} });

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly string[]>([]);
  const cart = useMemo(
    () => ({ items, add: (item: string) => setItems((list) => [...list, item]) }),
    [items],
  );
  return <CartContext value={cart}>{children}</CartContext>;
}

export function AddButton({ item }: { item: string }) {
  const cart = useContext(CartContext);
  return <button onClick={() => cart.add(item)}>Add</button>;
}
\`\`\`

## Why it matters

The cart shows 0 items after a click: \`push\` changed the array, but the Provider's state did not change, so nothing re-renders. The next unrelated render shows the new count, which makes the bug hard to trace. Writing \`readonly\` in the context's type (\`readonly string[]\`, \`Readonly<Cart>\`) makes TypeScript reject the write too.

## What it does not catch

- A write through a function the value is passed to, or through a variable that is not a \`const\`.
- Writes to \`ref.current\` and to fields of class instances (a MobX store, for example): those are meant to change in place, and are not reported.
- A value read through a hook of the project is followed only when the hook returns the context's value itself.

## Getting the best from it

It is an add-on, off by default: its findings have not yet been measured on enough real projects to turn it on for everyone. Turn it on with the \`addons\` line below. A context that is meant to be changed in place (a mutable store object) can be listed in \`ignore\`.

## Turn it on or off

\`\`\`ts
addons: ["react-context/value-changed-by-reader"]
rules: { "react-context/value-changed-by-reader": ["error", { ignore: ["FormStoreContext"] }] }
\`\`\`
`;

/** The methods of TypeScript's library types that change the value they are called on. */
const MUTATORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "Array",
    new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]),
  ],
  ["Map", new Set(["set", "delete", "clear"])],
  ["Set", new Set(["add", "delete", "clear"])],
  ["WeakMap", new Set(["set", "delete"])],
  ["WeakSet", new Set(["add", "delete"])],
]);

const LIB_FILE = /(?:^|[\\/])lib\.[^\\/]*\.d\.ts$/;

/** A local name that holds the context value or a part of it: where it was read, and from what. */
type Tracked = { context: string; source: ts.Node; label: string };

function code(text: string): string {
  return `\`${text}\``;
}

function short(node: ts.Node): string {
  const text = node.getText().replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function isComponentOrHook(name: string): boolean {
  return /^[A-Z]/.test(name) || /^use[A-Z0-9]/.test(name);
}

/** The name a function is declared under: `function Cart`, `const Cart = () => …`. */
function functionName(fn: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text;
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  // `memo(function Cart() {…})`, `forwardRef((props, ref) => …)` assigned to a `const`.
  if (ts.isCallExpression(parent) && ts.isVariableDeclaration(parent.parent)) {
    const name = parent.parent.name;
    return ts.isIdentifier(name) ? name.text : undefined;
  }
  return ts.isFunctionExpression(fn) ? fn.name?.text : undefined;
}

function isFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
  );
}

/** The outermost component or hook a node is in, or undefined. */
function readerOf(node: ts.Node): { fn: ts.FunctionLikeDeclaration; name: string } | undefined {
  let found: { fn: ts.FunctionLikeDeclaration; name: string } | undefined;
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (!isFunction(current)) continue;
    const name = functionName(current);
    if (name !== undefined && isComponentOrHook(name)) found = { fn: current, name };
  }
  return found;
}

/** The interface a library method is declared in (`Array` for `push`), when it is TypeScript's. */
function libraryOwner(types: TypeQueries, name: ts.Node): string | undefined {
  const symbol = types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (declaration === undefined || !LIB_FILE.test(declaration.file)) return undefined;
  const owner = declaration.node.parent;
  return ts.isInterfaceDeclaration(owner) ? owner.name.text : undefined;
}

/** Whether a property is a field of a class: a class instance changes its own fields by design. */
function isClassField(types: TypeQueries, name: ts.Node): boolean {
  const symbol = types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  const node = declaration?.node;
  return node !== undefined && ts.isClassElement(node);
}

/**
 * The context a read names: `useContext(CartContext)` and `use(CartContext)` give `CartContext`.
 * `use` also reads promises: only a context counts.
 */
function contextRead(types: TypeQueries, call: ts.CallExpression): ts.Expression | undefined {
  const hook = reactName(types, calleeName(call.expression));
  const argument = call.arguments[0];
  if (argument === undefined) return undefined;
  if (hook === "useContext") return argument;
  return hook === "use" && /\bContext</.test(types.typeTextOf(argument)) ? argument : undefined;
}

/** Reads one file: the readers' writes to context values, found once each. */
class Reader {
  /** Per hook declaration: the context it returns the value of, or null when it does not. */
  private readonly hooks = new Map<ts.Node, string | null>();

  constructor(private readonly types: TypeQueries) {}

  /**
   * The context whose value a call gives: a read of it, or a call to a hook of the project that
   * returns such a read (`useCart()` that returns `useContext(CartContext)` after a check).
   */
  contextOf(call: ts.CallExpression): string | undefined {
    const read = contextRead(this.types, call);
    if (read !== undefined) return read.getText();
    const symbol = this.types.symbolAt(calleeName(call.expression));
    const declaration = symbol === undefined ? undefined : this.types.declarationOf(symbol);
    if (declaration === undefined || !this.types.isOwnFile(declaration.file)) return undefined;
    const node = declaration.node;
    const fn =
      ts.isVariableDeclaration(node) && node.initializer !== undefined
        ? unwrapped(node.initializer)
        : node;
    if (!isFunction(fn) || !/^use[A-Z0-9]/.test(symbol?.name ?? "")) return undefined;
    const known = this.hooks.get(fn);
    if (known !== undefined) return known ?? undefined;
    this.hooks.set(fn, null);
    const found = this.returnedContext(fn);
    this.hooks.set(fn, found ?? null);
    return found;
  }

  /** The context a hook returns the whole value of, on every `return`. */
  private returnedContext(fn: ts.FunctionLikeDeclaration): string | undefined {
    const body = fn.body;
    if (body === undefined) return undefined;
    const returned: ts.Expression[] = [];
    if (!ts.isBlock(body)) returned.push(body);
    else {
      const visit = (node: ts.Node): void => {
        if (isFunction(node)) return;
        if (ts.isReturnStatement(node) && node.expression !== undefined) {
          returned.push(node.expression);
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    }
    const contexts = new Set<string>();
    for (const expression of returned) {
      const value = unwrapped(expression);
      const context = ts.isCallExpression(value)
        ? contextRead(this.types, value)?.getText()
        : ts.isIdentifier(value)
          ? this.heldContext(value)
          : undefined;
      if (context === undefined) return undefined;
      contexts.add(context);
    }
    const [only] = contexts;
    return contexts.size === 1 ? only : undefined;
  }

  /** `const cart = useContext(CartContext)`: the context `cart` holds the whole value of. */
  private heldContext(name: ts.Identifier): string | undefined {
    const symbol = this.types.symbolAt(name);
    const declaration = symbol === undefined ? undefined : this.types.declarationOf(symbol)?.node;
    if (
      declaration === undefined ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      declaration.initializer === undefined
    ) {
      return undefined;
    }
    const init = unwrapped(declaration.initializer);
    return ts.isCallExpression(init) ? contextRead(this.types, init)?.getText() : undefined;
  }
}

/** The tracked name at the root of an access chain, and the chain's property names. */
function rootOf(expression: ts.Expression): { root: ts.Expression; path: ts.Node[] } {
  const path: ts.Node[] = [];
  let current = unwrapped(expression);
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    path.unshift(
      ts.isPropertyAccessExpression(current) ? current.name : current.argumentExpression,
    );
    current = unwrapped(current.expression);
  }
  return { root: current, path };
}

export const valueChangedByReader = defineRule({
  kind: "file",
  meta: {
    description:
      "Reports a component or hook that changes the value it reads from a context (assigns or deletes a property, or calls `push`, `set` or `add` on an array, Map or Set in it): React re-renders the readers only when the Provider passes a new value, so the change does not show.",
    summary: "a write to the value read from a context, in a component or hook that reads it",
    defaultSeverity: "error",
    tier: "addon",
    addon: "value-changed-by-reader",
    group: "readers",
    needsTypes: { library: "React", modules: ["react"] },
    options: {
      ignore: option.strings({
        default: [],
        description:
          "Contexts (names or globs) whose value is meant to be changed in place, such as a mutable store object.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    checkFile(ctx);
  },
});

function checkFile(ctx: FileContext<{ readonly ignore: readonly string[] }>): void {
  const { types, sourceFile } = ctx;
  const reader = new Reader(types);
  const tracked = new Map<string, Tracked>();
  /** Symbol ids of the names that hold a context value or a part of it. */
  const track = (name: ts.Identifier, entry: Tracked): void => {
    const symbol = types.symbolAt(name);
    if (symbol !== undefined && !tracked.has(symbol.id)) tracked.set(symbol.id, entry);
  };

  // Reads, in order, then `const items = cart.items` aliases (each `const` once, in order).
  const declarations: ts.VariableDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) declarations.push(node);
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  for (const declaration of declarations) {
    const init = declaration.initializer && unwrapped(declaration.initializer);
    if (init === undefined) continue;
    const isConst = (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
    const fromRead = ts.isCallExpression(init) ? reader.contextOf(init) : undefined;
    const entry: Tracked | undefined =
      fromRead !== undefined && readerOf(declaration) !== undefined
        ? { context: fromRead, source: init, label: short(init) }
        : isConst
          ? trackedRoot(init, ts.isObjectBindingPattern(declaration.name))
          : undefined;
    if (entry === undefined || matchesName(entry.context, ctx.options.ignore)) continue;
    if (ts.isIdentifier(declaration.name)) track(declaration.name, entry);
    else if (ts.isObjectBindingPattern(declaration.name)) {
      for (const element of declaration.name.elements) {
        if (element.dotDotDotToken === undefined && ts.isIdentifier(element.name)) {
          track(element.name, entry);
        }
      }
    }
  }

  /** `cart.items`, or `cart` itself when it is destructured (`const { items } = cart`). */
  function trackedRoot(expression: ts.Expression, whole: boolean): Tracked | undefined {
    const { root, path } = rootOf(expression);
    if ((path.length === 0 && !whole) || !ts.isIdentifier(root)) return undefined;
    if (path.some((part) => ts.isIdentifier(part) && part.text === "current")) return undefined;
    const symbol = types.symbolAt(root);
    return symbol === undefined ? undefined : tracked.get(symbol.id);
  }

  /** The tracked value a write goes into, unless the place is a ref or a class field. */
  function written(target: ts.Expression, needsPath: boolean): Tracked | undefined {
    const { root, path } = rootOf(target);
    if (needsPath && path.length === 0) return undefined;
    if (path.some((part) => ts.isIdentifier(part) && part.text === "current")) return undefined;
    if (path.some((part) => ts.isIdentifier(part) && isClassField(types, part))) return undefined;
    if (ts.isCallExpression(root)) {
      const context = reader.contextOf(root);
      return context === undefined || matchesName(context, ctx.options.ignore)
        ? undefined
        : { context, source: root, label: short(root) };
    }
    if (!ts.isIdentifier(root)) return undefined;
    const symbol = types.symbolAt(root);
    return symbol === undefined ? undefined : tracked.get(symbol.id);
  }

  const report = (node: ts.Node, what: string, entry: Tracked): void => {
    if (readerOf(node) === undefined) return;
    ctx.report({
      message: `${code(what)} changes the ${code(entry.context)} value outside its Provider`,
      hint: `call a function the ${code(entry.context)} Provider passes in the value to set its state: readers re-render only when the Provider passes a new value`,
      node,
      related: [{ node: entry.source, message: `${code(entry.label)} reads the value` }],
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
      const entry = written(node.left, true);
      if (entry !== undefined)
        report(node, `${short(node.left)} ${node.operatorToken.getText()} …`, entry);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const entry = written(node.operand, true);
      if (entry !== undefined) report(node, short(node), entry);
    } else if (ts.isDeleteExpression(node)) {
      const entry = written(node.expression, true);
      if (entry !== undefined) report(node, short(node), entry);
    } else if (ts.isCallExpression(node)) {
      const callee = unwrapped(node.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const owner = libraryOwner(types, callee.name);
        const mutates = owner !== undefined && MUTATORS.get(owner)?.has(callee.name.text) === true;
        const assign =
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "Object" &&
          callee.name.text === "assign" &&
          owner === "ObjectConstructor";
        const target = mutates ? callee.expression : assign ? node.arguments[0] : undefined;
        const entry = target === undefined ? undefined : written(target, false);
        if (entry !== undefined) {
          report(
            node,
            assign && target !== undefined
              ? `Object.assign(${short(target)}, …)`
              : `${short(callee)}(…)`,
            entry,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}
