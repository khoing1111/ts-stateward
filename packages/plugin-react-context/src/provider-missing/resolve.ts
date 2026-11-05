import ts from "@stateward/core/typescript";
import type { SymbolRef, TypeQueries } from "@stateward/core";
import type { Origin } from "./summary.js";
import {
  calleeName,
  containsJsxOrHookCall,
  defaultKeywordOf,
  enclosingFunction,
  isFunctionLike,
  isHookName,
  locOf,
  shortText,
  skipWrappers,
  startsUpperCase,
  type FunctionLike,
} from "./syntax.js";

const REACT_FILE = /[\\/]node_modules[\\/](?:@types[\\/])?react[\\/]/;
const REACT_DOM_FILE = /[\\/]node_modules[\\/](?:@types[\\/])?react-dom[\\/]/;
const ROUTER_PACKAGES: ReadonlySet<string> = new Set(["react-router", "react-router-dom"]);

/** What a JSX tag is, decided by the declaration it resolves to (never by its text alone). */
export type Tag =
  | { kind: "intrinsic" }
  | { kind: "library" }
  | { kind: "provider"; context: string }
  | { kind: "prop"; name: string }
  | { kind: "component"; id: string }
  /** An own class component: stateward does not look inside it. */
  | { kind: "class" }
  /** React Router's `Route`, `Outlet` and `RouterProvider`, by declaration. */
  | { kind: "route" }
  | { kind: "outlet" }
  | { kind: "router-provider" }
  /**
   * A tag stateward cannot resolve. `candidate`: its variable has a shape the dynamic-components
   * add-on aims at (a map access, a condition, a `lazy` call) but this use is outside what it follows.
   * `lazyFunction`: its variable is a call of that function with an import, and the function is
   * not known to wrap `lazy`.
   */
  | { kind: "computed"; candidate: boolean; lazyFunction?: string }
  /** A tag the dynamic-components add-on follows: the components it can be, each with why. */
  | { kind: "dynamic"; targets: Target[] };

/** A component a dynamic tag can render, and what makes it one (a map entry, a branch). */
export type Target = { id: string; origin: Origin | null };

type Dynamic =
  | { kind: "targets"; targets: Target[] }
  | { kind: "none"; candidate: boolean; lazyFunction?: string };

/** An own component an expression can be, and where it is written. */
type Leaf = { id: string; loc: Origin["loc"] };

/**
 * A component is a function, a wrapper (`memo(Inner)`) of another component, or a lazy one:
 * `lazy(() => import("./Page"))` is the default export of that module, and
 * `lazy(() => import("./Page").then((m) => ({ default: m.Page })))` its export `Page` (`name`).
 */
export type Shape =
  | { kind: "function"; fn: FunctionLike }
  | { kind: "wrapper"; target: ts.Expression }
  | { kind: "lazy"; module: ts.StringLiteral; name: string | undefined };

/** The kind of router call: `createBrowserRouter(routes)` makes a router, `useRoutes(routes)` renders. */
export type RouterCall = "create" | "use";

const CREATE_ROUTER_CALLS: ReadonlySet<string> = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
]);

type Resolved = { symbol: SymbolRef; file: string; node: ts.Node };

/** A checked read: of a context of the project, or of one declared outside the checked files. */
export type ContextRead =
  { kind: "own"; id: string } | { kind: "external"; id: string; name: string };

/**
 * The declaration behind a name or `a.b` expression (the checker resolves aliases and imports).
 * `lazyFunctions`: names of the project's own wrappers of React's `lazy` (the rule's option).
 */
function createResolver(types: TypeQueries, lazyFunctions: readonly string[] = []) {
  function resolve(expression: ts.Expression): Resolved | undefined {
    const inner = skipWrappers(expression);
    const name = ts.isPropertyAccessExpression(inner) ? inner.name : inner;
    if (!ts.isIdentifier(name)) return undefined;
    const symbol = types.symbolAt(name);
    const declaration = symbol && types.declarationOf(symbol);
    return symbol && declaration && { symbol, file: declaration.file, node: declaration.node };
  }

  function isFrom(expression: ts.Expression, packagePattern: RegExp, names: ReadonlySet<string>) {
    const found = resolve(expression);
    return found !== undefined && packagePattern.test(found.file) && names.has(found.symbol.name);
  }

  /** Declared in React Router (`react-router` or `react-router-dom`) under one of `names`. */
  function isRouterApi(expression: ts.Expression, names: ReadonlySet<string>): boolean {
    const found = resolve(expression);
    if (found === undefined || !names.has(found.symbol.name)) return false;
    const packageName = types.packageOf(found.file);
    return packageName !== undefined && ROUTER_PACKAGES.has(packageName);
  }

  const ROUTES_FROM_ELEMENTS: ReadonlySet<string> = new Set(["createRoutesFromElements"]);
  const isRoutesFromElementsCall = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) && isRouterApi(node.expression, ROUTES_FROM_ELEMENTS);

  const USE_ROUTES: ReadonlySet<string> = new Set(["useRoutes"]);
  function routerCall(call: ts.CallExpression): RouterCall | undefined {
    if (isRouterApi(call.expression, CREATE_ROUTER_CALLS)) return "create";
    return isRouterApi(call.expression, USE_ROUTES) ? "use" : undefined;
  }

  const CREATE_CONTEXT: ReadonlySet<string> = new Set(["createContext"]);
  const USE_CONTEXT: ReadonlySet<string> = new Set(["useContext"]);

  /**
   * React's `createContext(undefined)` or `createContext(null)` (no argument too): a context with
   * no default, whose readers have to check for one. A cast (`null!`, `{} as T`) is a fake
   * default instead, and `react-context/fake-default-value` points at it.
   */
  const isMissingDefaultContextCall = (node: ts.Node): node is ts.CallExpression => {
    if (!ts.isCallExpression(node) || !isFrom(node.expression, REACT_FILE, CREATE_CONTEXT)) {
      return false;
    }
    let argument = node.arguments[0];
    if (argument === undefined) return true;
    while (ts.isParenthesizedExpression(argument)) argument = argument.expression;
    return (
      argument.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(argument) && argument.text === "undefined") ||
      ts.isVoidExpression(argument)
    );
  };

  const WRAPPERS: ReadonlySet<string> = new Set(["memo", "forwardRef"]);
  const LAZY: ReadonlySet<string> = new Set(["lazy"]);
  const LAZY_OPTION: ReadonlySet<string> = new Set(lazyFunctions);
  const lazyWrappers = new Map<ts.Node, boolean>();

  /**
   * React's `lazy` (also as `React.lazy`), or a wrapper of it: one named in the `lazyFunctions`
   * option, or an own function that hands its first parameter to `lazy` (`lazy(load)` or
   * `lazy(() => load())`). Its first argument is then the import thunk.
   */
  function isLazyCall(call: ts.CallExpression): boolean {
    if (isFrom(call.expression, REACT_FILE, LAZY)) return true;
    const name = calleeName(call);
    if (name !== undefined && LAZY_OPTION.has(name)) return true;
    const found = resolve(call.expression);
    if (found === undefined || !types.isOwnFile(found.file)) return false;
    const known = lazyWrappers.get(found.node);
    if (known !== undefined) return known;
    const wraps = wrapsLazy(found.node);
    lazyWrappers.set(found.node, wraps);
    return wraps;
  }

  function wrapsLazy(declaration: ts.Node): boolean {
    const value =
      ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
        ? skipWrappers(declaration.initializer)
        : declaration;
    if (!isFunctionLike(value) || value.body === undefined) return false;
    const parameter = value.parameters[0];
    if (parameter === undefined || !ts.isIdentifier(parameter.name)) return false;
    const loader = types.symbolAt(parameter.name)?.id;
    if (loader === undefined) return false;
    const isLoader = (node: ts.Expression): boolean => {
      const inner = skipWrappers(node);
      return ts.isIdentifier(inner) && types.symbolAt(inner)?.id === loader;
    };
    const handsOver = (argument: ts.Expression | undefined): boolean => {
      if (argument === undefined) return false;
      if (isLoader(argument)) return true;
      const body = factoryBody(argument);
      return body !== undefined && ts.isCallExpression(body) && isLoader(body.expression);
    };
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(node) &&
        isFrom(node.expression, REACT_FILE, LAZY) &&
        handsOver(node.arguments[0])
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(value.body, visit);
    return found;
  }

  /** The module and export a lazy call loads, when its thunk is one stateward reads. */
  function lazyShape(call: ts.CallExpression): Extract<Shape, { kind: "lazy" }> | undefined {
    const factory = call.arguments[0];
    const target = lazyTargetOf(factory);
    return target && { kind: "lazy", module: target.module, name: target.name };
  }

  /** The own component a lazy shape loads: the module's default export, or its export `name`. */
  function lazyComponent(shape: Extract<Shape, { kind: "lazy" }>): string | undefined {
    return shape.name === undefined
      ? defaultExportOf(shape.module)
      : namedExportOf(shape.module, shape.name);
  }
  const isWrapperCall = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) && isFrom(node.expression, REACT_FILE, WRAPPERS);

  const CHILDREN_CALLS: ReadonlySet<string> = new Set([
    "cloneElement",
    "map",
    "forEach",
    "toArray",
    "only",
  ]);
  /** `cloneElement(children)` and `Children.map(children, …)` render their argument in place. */
  const isChildrenCall = (node: ts.CallExpression): boolean =>
    isFrom(node.expression, REACT_FILE, CHILDREN_CALLS);

  /**
   * A context that may need a Provider: a variable initialised by React's `createContext` with no
   * default (`isMissingDefaultContextCall`). It needs one once a reader checks its value.
   */
  function contextIdOf(expression: ts.Expression): string | undefined {
    const found = resolve(expression);
    if (found === undefined || !ts.isVariableDeclaration(found.node)) return undefined;
    const initializer = found.node.initializer && skipWrappers(found.node.initializer);
    return initializer !== undefined && isMissingDefaultContextCall(initializer)
      ? found.symbol.id
      : undefined;
  }

  /**
   * The context a checked read names: one of the project's with no default (`createContext(undefined)`),
   * or one declared outside the checked files, whose Providers stateward cannot see.
   */
  function readContext(expression: ts.Expression): ContextRead | undefined {
    const found = resolve(expression);
    if (found === undefined) return undefined;
    if (!types.isOwnFile(found.file)) {
      return { kind: "external", id: found.symbol.id, name: found.symbol.name };
    }
    const id = contextIdOf(expression);
    return id === undefined ? undefined : { kind: "own", id };
  }

  /**
   * Whether the value of a `useContext(…)` call is held in a variable that the function then
   * checks for a missing Provider (`if (!value) throw …`, `if (value === undefined) return null`).
   */
  function isCheckedRead(call: ts.CallExpression): boolean {
    let holder: ts.Node = call.parent;
    while (ts.isParenthesizedExpression(holder)) holder = holder.parent;
    if (!ts.isVariableDeclaration(holder) || !ts.isIdentifier(holder.name)) return false;
    const variable = types.symbolAt(holder.name);
    const fn = enclosingFunction(holder);
    if (variable === undefined || !isFunctionLike(fn) || fn.body === undefined) return false;
    const isValue = (node: ts.Expression): boolean => {
      const inner = skipWrappers(node);
      return ts.isIdentifier(inner) && types.symbolAt(inner)?.id === variable.id;
    };
    return checksMissingIn(fn.body, isValue);
  }

  /**
   * The parameter of an own helper (`useRequired(context)`) that it reads with `useContext` and
   * checks: a call of the helper is a checked read of the context it is given.
   */
  function helperParameter(call: ts.CallExpression): number | undefined {
    // A helper that calls `useContext` is a hook, so only a hook's name is looked into.
    const name = calleeName(call);
    if (name === undefined || !isHookName(name) || name === "useContext") return undefined;
    const found = resolve(call.expression);
    if (found === undefined || !types.isOwnFile(found.file)) return undefined;
    const value =
      ts.isVariableDeclaration(found.node) && found.node.initializer !== undefined
        ? skipWrappers(found.node.initializer)
        : found.node;
    if (!isFunctionLike(value) || value.body === undefined) return undefined;
    const parameters = value.parameters.map((parameter) =>
      ts.isIdentifier(parameter.name) ? types.symbolAt(parameter.name)?.id : undefined,
    );
    let index: number | undefined;
    const visit = (node: ts.Node): void => {
      if (index !== undefined || isFunctionLike(node)) return;
      const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
      if (
        ts.isCallExpression(node) &&
        argument !== undefined &&
        ts.isIdentifier(argument) &&
        isFrom(node.expression, REACT_FILE, USE_CONTEXT) &&
        isCheckedRead(node)
      ) {
        const id = types.symbolAt(argument)?.id;
        const at = id === undefined ? -1 : parameters.indexOf(id);
        if (at >= 0) index = at;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(value.body, visit);
    return index;
  }

  /**
   * A read of a context with no default whose value the code then checks: `useContext(X)` held in
   * a variable the function checks, or a call of an own helper that does that with the context it
   * is given (`useRequired(X)`). The code says the Provider must be there. The context's id;
   * undefined for any other call, or an unchecked read.
   */
  function checkedContextRead(call: ts.CallExpression): ContextRead | undefined {
    if (isFrom(call.expression, REACT_FILE, USE_CONTEXT)) {
      const argument = call.arguments[0];
      const context = argument === undefined ? undefined : readContext(argument);
      return context !== undefined && isCheckedRead(call) ? context : undefined;
    }
    const index = helperParameter(call);
    const argument = index === undefined ? undefined : call.arguments[index];
    return argument === undefined ? undefined : readContext(argument);
  }

  /** A `never` call (`fail("…")`, `invariant(…)` typed so): it does not come back. */
  function exitsIn(statement: ts.Statement): boolean {
    let exits = false;
    const visit = (node: ts.Node): void => {
      if (exits || isFunctionLike(node)) return;
      if (ts.isThrowStatement(node) || ts.isReturnStatement(node)) exits = true;
      else if (ts.isCallExpression(node) && types.typeTextOf(node) === "never") exits = true;
      else ts.forEachChild(node, visit);
    };
    visit(statement);
    return exits;
  }

  /** An `if` in the body (not in a nested function) that checks the value is missing, then leaves. */
  function checksMissingIn(body: ts.Node, isValue: (node: ts.Expression) => boolean): boolean {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found || isFunctionLike(node)) return;
      if (
        ts.isIfStatement(node) &&
        checksMissing(node.expression, isValue) &&
        exitsIn(node.thenStatement)
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  }

  const ROOT_CALLS: ReadonlySet<string> = new Set(["createRoot"]);
  const HYDRATE_CALLS: ReadonlySet<string> = new Set(["hydrateRoot"]);

  function isRootHandle(expression: ts.Expression): boolean {
    const inner = skipWrappers(expression);
    if (ts.isCallExpression(inner)) return isFrom(inner.expression, REACT_DOM_FILE, ROOT_CALLS);
    const found = ts.isIdentifier(inner) ? resolve(inner) : undefined;
    const initializer =
      found && ts.isVariableDeclaration(found.node) ? found.node.initializer : undefined;
    return initializer !== undefined && isRootHandle(initializer);
  }

  /** The element an entry call renders: `createRoot(el).render(<X/>)` or `hydrateRoot(el, <X/>)`. */
  function entryArgument(call: ts.CallExpression): ts.Expression | undefined {
    const callee = skipWrappers(call.expression);
    if (isFrom(callee, REACT_DOM_FILE, HYDRATE_CALLS)) return call.arguments[1];
    const renders = ts.isPropertyAccessExpression(callee) && callee.name.text === "render";
    return renders && isRootHandle(callee.expression) ? call.arguments[0] : undefined;
  }

  /** The literal of `import("./Page")`. */
  function importLiteral(expression: ts.Expression): ts.StringLiteral | undefined {
    const call = skipWrappers(expression);
    const isImport =
      ts.isCallExpression(call) && call.expression.kind === ts.SyntaxKind.ImportKeyword;
    const specifier = isImport ? call.arguments[0] : undefined;
    return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier : undefined;
  }

  /** The expression a `lazy` factory `() => expression` returns. */
  function factoryBody(factory: ts.Expression | undefined): ts.Expression | undefined {
    const inner = factory && skipWrappers(factory);
    if (inner === undefined || !ts.isArrowFunction(inner) || ts.isBlock(inner.body)) {
      return undefined;
    }
    return skipWrappers(inner.body);
  }

  /** The literals of `import("./a")`, or of `Promise.all([import("./a"), import("./b")])`. */
  function importsOf(expression: ts.Expression): readonly ts.StringLiteral[] | undefined {
    const inner = skipWrappers(expression);
    const single = importLiteral(inner);
    if (single !== undefined) return [single];
    if (!ts.isCallExpression(inner) || inner.arguments.length !== 1) return undefined;
    const callee = skipWrappers(inner.expression);
    const isAll =
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "all" &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "Promise";
    const list = skipWrappers(inner.arguments[0] ?? inner);
    if (!isAll || !ts.isArrayLiteralExpression(list)) return undefined;
    const modules = list.elements.map((element) => importLiteral(skipWrappers(element)));
    const literals = modules.filter((module): module is ts.StringLiteral => module !== undefined);
    return literals.length > 0 && literals.length === modules.length ? literals : undefined;
  }

  /** What a name bound by a `.then` callback holds: a whole module, or one of its exports. */
  type Binding = { module: number; exportName: string | undefined };

  /** The names a `.then` parameter binds: `m`, `{ X }`, `{ X: Y }`, or (after `Promise.all`) `[a, b]`. */
  function bindingsOf(
    parameter: ts.BindingName,
    count: number,
    all: boolean,
  ): ReadonlyMap<string, Binding> | undefined {
    const bound = new Map<string, Binding>();
    const bindOne = (name: ts.BindingName, module: number): boolean => {
      if (ts.isIdentifier(name)) {
        bound.set(name.text, { module, exportName: undefined });
        return true;
      }
      if (!ts.isObjectBindingPattern(name)) return false;
      for (const element of name.elements) {
        const exported = element.propertyName ?? element.name;
        const key =
          ts.isIdentifier(exported) || ts.isStringLiteral(exported) ? exported.text : undefined;
        if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) return false;
        if (key === undefined) return false;
        bound.set(element.name.text, { module, exportName: key });
      }
      return true;
    };
    if (!all) return count === 1 && bindOne(parameter, 0) ? bound : undefined;
    if (!ts.isArrayBindingPattern(parameter)) return undefined;
    for (const [at, element] of parameter.elements.entries()) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.dotDotDotToken !== undefined || !bindOne(element.name, at)) return undefined;
    }
    return bound;
  }

  /**
   * The module and export a `lazy` thunk ends up loading as the component. `() => import("./a")`
   * is the default export; `.then` picks one: `(m) => m.default`, `(m) => m.X`,
   * `(m) => ({ default: m.X })`, `({ X }) => ({ default: X })`, and over
   * `Promise.all([import("./a"), import("./b")])` the same with `([a, b]) => …`. Anything else
   * (a block, a second argument, a computed export) is not decided.
   */
  function lazyTargetOf(
    factory: ts.Expression | undefined,
  ): { module: ts.StringLiteral; name: string | undefined } | undefined {
    const body = factoryBody(factory);
    if (body === undefined) return undefined;
    const direct = importLiteral(body);
    if (direct !== undefined) return { module: direct, name: undefined };
    if (!ts.isCallExpression(body)) return undefined;
    const callee = skipWrappers(body.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "then") return undefined;
    const modules = importsOf(callee.expression);
    const mapper = body.arguments.length === 1 ? body.arguments[0] : undefined;
    const arrow = mapper && skipWrappers(mapper);
    if (modules === undefined || arrow === undefined || !ts.isArrowFunction(arrow))
      return undefined;
    const parameter = arrow.parameters.length === 1 ? arrow.parameters[0] : undefined;
    if (parameter === undefined || ts.isBlock(arrow.body)) return undefined;
    const all = importLiteral(skipWrappers(callee.expression)) === undefined;
    const bound = bindingsOf(parameter.name, modules.length, all);
    if (bound === undefined) return undefined;
    const pick = (module: number, name: string): ReturnType<typeof lazyTargetOf> => {
      const literal = modules[module];
      return literal && { module: literal, name: name === "default" ? undefined : name };
    };
    /** `m.X` on a whole module, or `X` bound to an export. */
    const exportOf = (value: ts.Expression): ReturnType<typeof lazyTargetOf> => {
      const inner = skipWrappers(value);
      if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression)) {
        const held = bound.get(inner.expression.text);
        return held?.exportName === undefined && held !== undefined
          ? pick(held.module, inner.name.text)
          : undefined;
      }
      if (!ts.isIdentifier(inner)) return undefined;
      const held = bound.get(inner.text);
      return held?.exportName === undefined ? undefined : pick(held.module, held.exportName);
    };
    const result = skipWrappers(arrow.body);
    if (ts.isObjectLiteralExpression(result)) {
      const member = result.properties.length === 1 ? result.properties[0] : undefined;
      const isDefault =
        member !== undefined &&
        ts.isPropertyAssignment(member) &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
        member.name.text === "default";
      return isDefault ? exportOf(member.initializer) : undefined;
    }
    if (ts.isIdentifier(result)) {
      // `([a]) => a`: the whole module is what `lazy` reads `default` from.
      const held = bound.get(result.text);
      return held?.exportName === undefined && held !== undefined
        ? pick(held.module, "default")
        : undefined;
    }
    return exportOf(result);
  }

  function shapeOfExpression(expression: ts.Expression): Shape | undefined {
    const inner = skipWrappers(expression);
    if (isFunctionLike(inner)) return { kind: "function", fn: inner };
    if (ts.isCallExpression(inner) && isLazyCall(inner)) return lazyShape(inner);
    if (!isWrapperCall(inner)) return undefined;
    const argument = inner.arguments[0];
    if (argument === undefined) return undefined;
    const wrapped = skipWrappers(argument);
    if (isFunctionLike(wrapped)) return { kind: "function", fn: wrapped };
    if (isWrapperCall(wrapped)) return shapeOfExpression(wrapped);
    return ts.isIdentifier(wrapped) || ts.isPropertyAccessExpression(wrapped)
      ? { kind: "wrapper", target: wrapped }
      : undefined;
  }

  /** The shape of a value that is a component: a bare function must render or call a hook. */
  function shapeOfValue(expression: ts.Expression): Shape | undefined {
    const shape = shapeOfExpression(expression);
    if (shape?.kind !== "function") return shape;
    // A wrapped function is a component as written; a bare one must render or call a hook.
    return isWrapperCall(skipWrappers(expression)) || containsJsxOrHookCall(shape.fn)
      ? shape
      : undefined;
  }

  /** The component a declaration makes, if it makes one. */
  function componentShape(declaration: ts.Node): Shape | undefined {
    if (ts.isFunctionDeclaration(declaration)) {
      // `export default function () {}` has no name and is still a component.
      const named = declaration.name === undefined || startsUpperCase(declaration.name.text);
      return named && containsJsxOrHookCall(declaration)
        ? { kind: "function", fn: declaration }
        : undefined;
    }
    if (ts.isExportAssignment(declaration)) {
      return declaration.isExportEquals ? undefined : shapeOfValue(declaration.expression);
    }
    if (!ts.isVariableDeclaration(declaration)) return undefined;
    if (!ts.isIdentifier(declaration.name) || !startsUpperCase(declaration.name.text)) {
      return undefined;
    }
    return declaration.initializer && shapeOfValue(declaration.initializer);
  }

  /** The function of a hook declaration: `function useX() {}` or `const useX = () => {}`. */
  function hookFunction(declaration: ts.Node): FunctionLike | undefined {
    if (ts.isFunctionDeclaration(declaration)) {
      return declaration.name && isHookName(declaration.name.text) ? declaration : undefined;
    }
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
      return undefined;
    }
    const initializer = declaration.initializer && skipWrappers(declaration.initializer);
    return initializer && isFunctionLike(initializer) && isHookName(declaration.name.text)
      ? initializer
      : undefined;
  }

  /** The prop of `fn`'s first parameter that `expression` reads (`children`, `props.render`). */
  function propName(expression: ts.Expression, fn: FunctionLike): string | undefined {
    const parameter = fn.parameters[0];
    if (parameter === undefined) return undefined;
    const declarationOf = (identifier: ts.Identifier): ts.Node | undefined => {
      const symbol = types.symbolAt(identifier);
      return symbol && types.declarationOf(symbol)?.node;
    };
    if (ts.isPropertyAccessExpression(expression)) {
      const owner = expression.expression;
      return ts.isIdentifier(owner) && declarationOf(owner) === parameter
        ? expression.name.text
        : undefined;
    }
    if (!ts.isIdentifier(expression)) return undefined;
    const binding = declarationOf(expression);
    if (binding === undefined || !ts.isBindingElement(binding)) return undefined;
    const key = binding.propertyName ?? binding.name;
    if (!ts.isIdentifier(key)) return undefined;
    const pattern = binding.parent;
    if (pattern === parameter.name) return key.text;
    const holder = pattern.parent;
    const source =
      ts.isVariableDeclaration(holder) && holder.initializer && ts.isIdentifier(holder.initializer)
        ? declarationOf(holder.initializer)
        : undefined;
    return source === parameter ? key.text : undefined;
  }

  function resolveTag(tag: ts.JsxTagNameExpression, fn: FunctionLike | undefined): Tag {
    if (ts.isPropertyAccessExpression(tag) && tag.name.text === "Provider") {
      const context = contextIdOf(tag.expression);
      if (context !== undefined) return { kind: "provider", context };
    }
    if (ts.isJsxNamespacedName(tag)) return { kind: "intrinsic" };
    if (ts.isIdentifier(tag) && !startsUpperCase(tag.text)) return { kind: "intrinsic" };
    if (!ts.isIdentifier(tag) && !ts.isPropertyAccessExpression(tag)) {
      return { kind: "computed", candidate: false };
    }
    const prop = fn && propName(tag, fn);
    if (prop !== undefined) return { kind: "prop", name: prop };
    const found = resolve(tag);
    if (found === undefined) return { kind: "computed", candidate: false };
    const alias = providerAliasContext(found.node);
    if (alias !== undefined) return { kind: "provider", context: alias };
    // React 19 renders a context itself as its Provider: `<ThemeContext value={…}>`.
    const itself = contextIdOf(tag);
    if (itself !== undefined) return { kind: "provider", context: itself };
    if (!types.isOwnFile(found.file)) return routerTag(tag) ?? { kind: "library" };
    if (isClass(found.node)) return { kind: "class" };
    if (componentShape(found.node) !== undefined) return { kind: "component", id: found.symbol.id };
    const dynamic = dynamicOf(found.node);
    return dynamic.kind === "targets"
      ? { kind: "dynamic", targets: dynamic.targets }
      : dynamic.lazyFunction === undefined
        ? { kind: "computed", candidate: dynamic.candidate }
        : { kind: "computed", candidate: dynamic.candidate, lazyFunction: dynamic.lazyFunction };
  }

  const dynamicCache = new Map<ts.Node, Dynamic>();

  /**
   * The components a variable can hold, for the dynamic-components add-on: an element of a `const`
   * object literal of components, picked by a key of a finite type; a `lazy` import; a condition
   * between components. Anything else is `none`, which stays an unknown.
   */
  function dynamicOf(declaration: ts.Node): Dynamic {
    const cached = dynamicCache.get(declaration);
    if (cached !== undefined) return cached;
    const computed = computeDynamic(declaration);
    dynamicCache.set(declaration, computed);
    return computed;
  }

  const NONE: Dynamic = { kind: "none", candidate: false };
  const CANDIDATE: Dynamic = { kind: "none", candidate: true };

  function isConst(declaration: ts.VariableDeclaration): boolean {
    return (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0;
  }

  function computeDynamic(declaration: ts.Node): Dynamic {
    if (!ts.isVariableDeclaration(declaration) || !isConst(declaration)) return NONE;
    if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return NONE;
    const initializer = skipWrappers(declaration.initializer);
    const name = declaration.name.text;
    if (ts.isConditionalExpression(initializer)) {
      const leaves = leavesOf(initializer);
      if (leaves === undefined) return CANDIDATE;
      return targetsOf(
        leaves.map((leaf) => ({
          id: leaf.id,
          origin: { kind: "branch", label: name, loc: leaf.loc },
        })),
      );
    }
    if (ts.isElementAccessExpression(initializer)) return mapTargets(initializer);
    if (ts.isCallExpression(initializer) && isLazyCall(initializer)) {
      const id = lazyTarget(initializer);
      return id === undefined ? CANDIDATE : targetsOf([{ id, origin: null }]);
    }
    // `withRetry(() => import("./Page"))`: a function stateward does not know loads a page.
    const loader = ts.isCallExpression(initializer) ? calleeName(initializer) : undefined;
    if (loader !== undefined && ts.isCallExpression(initializer) && lazyShape(initializer)) {
      return { kind: "none", candidate: false, lazyFunction: loader };
    }
    return NONE;
  }

  /** Each component once, in the order given: an empty list is no target at all. */
  function targetsOf(targets: readonly Target[]): Dynamic {
    const seen = new Set<string>();
    const unique = targets.filter((target) => !seen.has(target.id) && seen.add(target.id));
    return unique.length === 0 ? CANDIDATE : { kind: "targets", targets: unique };
  }

  /** `panels[tab]`: the entries of the `const` object `panels` that the type of `tab` can select. */
  function mapTargets(access: ts.ElementAccessExpression): Dynamic {
    if (access.questionDotToken !== undefined) return CANDIDATE;
    const map = resolve(access.expression);
    const declaration = map?.node;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return CANDIDATE;
    const literal = declaration.initializer && skipWrappers(declaration.initializer);
    if (!isConst(declaration) || literal === undefined || !ts.isObjectLiteralExpression(literal)) {
      return CANDIDATE;
    }
    const entries = new Map<string, { leaves: Leaf[]; loc: Origin["loc"] }>();
    for (const property of literal.properties) {
      if (!ts.isPropertyAssignment(property)) return CANDIDATE;
      const key = propertyKey(property.name);
      const leaves = leavesOf(property.initializer);
      if (key === undefined || leaves === undefined) return CANDIDATE;
      entries.set(key, { leaves, loc: locOf(property) });
    }
    const keys = types.literalsOf(access.argumentExpression);
    if (keys === "not-finite" || keys.length === 0) return CANDIDATE;
    const mapName = shortText(access.expression);
    const targets: Target[] = [];
    for (const key of keys) {
      if (typeof key.value !== "string" && typeof key.value !== "number") return CANDIDATE;
      const entry = entries.get(String(key.value));
      if (entry === undefined) return CANDIDATE;
      const label = `${mapName}[${typeof key.value === "string" ? JSON.stringify(key.value) : String(key.value)}]`;
      for (const leaf of entry.leaves) {
        targets.push({ id: leaf.id, origin: { kind: "entry", label, loc: entry.loc } });
      }
    }
    return targetsOf(targets);
  }

  function propertyKey(name: ts.PropertyName): string | undefined {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
      ? name.text
      : undefined;
  }

  /**
   * The own components an expression can be: a reference to one, a `lazy` import, or a condition
   * between such. A library component adds nothing (it cannot read our contexts). Anything else
   * is undefined.
   */
  function leavesOf(expression: ts.Expression): Leaf[] | undefined {
    const inner = skipWrappers(expression);
    if (ts.isConditionalExpression(inner)) {
      const whenTrue = leavesOf(inner.whenTrue);
      const whenFalse = leavesOf(inner.whenFalse);
      return whenTrue && whenFalse && [...whenTrue, ...whenFalse];
    }
    if (ts.isCallExpression(inner)) {
      const id = isLazyCall(inner) ? lazyTarget(inner) : undefined;
      return id === undefined ? undefined : [{ id, loc: locOf(inner) }];
    }
    if (!ts.isIdentifier(inner) && !ts.isPropertyAccessExpression(inner)) return undefined;
    const found = resolve(inner);
    if (found === undefined) return undefined;
    if (!types.isOwnFile(found.file)) return [];
    const id = componentIdOfReference(inner);
    return id === undefined ? undefined : [{ id, loc: locOf(inner) }];
  }

  /** The component a `lazy` call loads: the default export, or the one `.then` picks by name. */
  function lazyTarget(call: ts.CallExpression): string | undefined {
    const shape = lazyShape(call);
    return shape && lazyComponent(shape);
  }

  /** The id of the own component exported as `name` by the module that `import("…")` names. */
  function namedExportOf(module: ts.StringLiteral, name: string): string | undefined {
    const moduleSymbol = types.symbolAt(module);
    const target = moduleSymbol && types.declarationOf(moduleSymbol);
    if (target === undefined || !ts.isSourceFile(target.node) || !types.isOwnFile(target.file)) {
      return undefined;
    }
    for (const statement of target.node.statements) {
      const symbol = namedExportSymbol(statement, name);
      if (symbol === undefined) continue;
      const declaration = types.declarationOf(symbol);
      return declaration !== undefined && componentShape(declaration.node) !== undefined
        ? symbol.id
        : undefined;
    }
    return undefined;
  }

  function namedExportSymbol(statement: ts.Statement, name: string): SymbolRef | undefined {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (statement.moduleSpecifier !== undefined || !clause || !ts.isNamedExports(clause)) {
        return undefined;
      }
      const element = clause.elements.find((candidate) => candidate.name.text === name);
      return element && types.symbolAt(element.propertyName ?? element.name);
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    const exported = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (!exported || isDefault) return undefined;
    if (ts.isFunctionDeclaration(statement)) {
      return statement.name?.text === name ? types.symbolAt(statement.name) : undefined;
    }
    if (!ts.isVariableStatement(statement)) return undefined;
    const declaration = statement.declarationList.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    );
    return declaration && types.symbolAt(declaration.name);
  }

  const ROUTE: ReadonlySet<string> = new Set(["Route"]);
  const OUTLET: ReadonlySet<string> = new Set(["Outlet"]);
  const ROUTER_PROVIDER: ReadonlySet<string> = new Set(["RouterProvider"]);

  function routerTag(tag: ts.JsxTagNameExpression): Tag | undefined {
    if (!ts.isIdentifier(tag) && !ts.isPropertyAccessExpression(tag)) return undefined;
    if (isRouterApi(tag, ROUTE)) return { kind: "route" };
    if (isRouterApi(tag, OUTLET)) return { kind: "outlet" };
    return isRouterApi(tag, ROUTER_PROVIDER) ? { kind: "router-provider" } : undefined;
  }

  /** `class X extends Component` or `const X = class extends Component`. */
  function isClass(declaration: ts.Node): boolean {
    if (ts.isClassLike(declaration)) return true;
    const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
    return initializer !== undefined && ts.isClassExpression(skipWrappers(initializer));
  }

  const ROUTES: ReadonlySet<string> = new Set(["Routes"]);
  const isRoutesTag = (tag: ts.JsxTagNameExpression): boolean =>
    (ts.isIdentifier(tag) || ts.isPropertyAccessExpression(tag)) && isRouterApi(tag, ROUTES);

  /** `as={Profile}`: the own component a reference to a component names. */
  function componentIdOfReference(expression: ts.Expression): string | undefined {
    const found = resolve(expression);
    const own = found !== undefined && types.isOwnFile(found.file);
    return own && componentShape(found.node) !== undefined ? found.symbol.id : undefined;
  }

  /** The name a declaration gives, not the symbol's (that is `default` for a default export). */
  function declaredName(declaration: ts.Node, fallback: string): string {
    if (ts.isFunctionDeclaration(declaration) && declaration.name) return declaration.name.text;
    if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
      return declaration.name.text;
    }
    return fallback;
  }

  /** A call of an own hook: the hook's id. */
  function ownHookId(call: ts.CallExpression): string | undefined {
    const found = resolve(call.expression);
    const own = found !== undefined && types.isOwnFile(found.file);
    return own && isHookName(declaredName(found.node, found.symbol.name))
      ? found.symbol.id
      : undefined;
  }

  /** The Provider a declaration aliases: `const P = Ctx.Provider` or `const { Provider } = Ctx`. */
  function providerAliasContext(declaration: ts.Node): string | undefined {
    if (ts.isVariableDeclaration(declaration)) {
      const value = declaration.initializer && skipWrappers(declaration.initializer);
      return value && ts.isPropertyAccessExpression(value) && value.name.text === "Provider"
        ? contextIdOf(value.expression)
        : undefined;
    }
    if (!ts.isBindingElement(declaration)) return undefined;
    const key = declaration.propertyName ?? declaration.name;
    const holder = declaration.parent.parent;
    const source = ts.isVariableDeclaration(holder) ? holder.initializer : undefined;
    const isProvider = ts.isIdentifier(key) && key.text === "Provider";
    return isProvider && source !== undefined ? contextIdOf(source) : undefined;
  }

  /** The id of an own component's default export, found from the literal of `import("./Page")`. */
  function defaultExportOf(module: ts.StringLiteral): string | undefined {
    const moduleSymbol = types.symbolAt(module);
    const target = moduleSymbol && types.declarationOf(moduleSymbol);
    if (target === undefined || !ts.isSourceFile(target.node) || !types.isOwnFile(target.file)) {
      return undefined;
    }
    for (const statement of target.node.statements) {
      const symbol = defaultExportSymbol(statement);
      if (symbol !== undefined) return symbol;
    }
    return undefined;
  }

  function defaultExportSymbol(statement: ts.Statement): string | undefined {
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) return undefined;
      const value = skipWrappers(statement.expression);
      return types.symbolAt(ts.isIdentifier(value) ? value : defaultKeywordOf(statement))?.id;
    }
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      const element =
        clause && ts.isNamedExports(clause)
          ? clause.elements.find((candidate) => candidate.name.text === "default")
          : undefined;
      return element && types.symbolAt(element.propertyName ?? element.name)?.id;
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    const isDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    const isDeclaration = ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement);
    if (!isDefault || !isDeclaration) return undefined;
    const marker = modifiers.find((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    return types.symbolAt(statement.name ?? marker ?? statement)?.id;
  }

  /** The `if` test holds when the value is missing: `!v`, `v === undefined`, `v == null`, `a || b`. */
  function checksMissing(test: ts.Expression, isValue: (node: ts.Expression) => boolean): boolean {
    let node = test;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      return isValue(node.operand);
    }
    if (!ts.isBinaryExpression(node)) return false;
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.BarBarToken) {
      return checksMissing(node.left, isValue) || checksMissing(node.right, isValue);
    }
    if (
      operator !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
      operator !== ts.SyntaxKind.EqualsEqualsToken
    ) {
      return false;
    }
    const nothing = (side: ts.Expression): boolean =>
      side.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(side) && side.text === "undefined");
    return (
      (isValue(node.left) && nothing(node.right)) || (isValue(node.right) && nothing(node.left))
    );
  }

  return {
    resolve,
    isMissingDefaultContextCall,
    checkedContextRead,
    isChildrenCall,
    contextIdOf,
    entryArgument,
    componentShape,
    lazyComponent,
    isRoutesFromElementsCall,
    isRoutesTag,
    routerCall,
    hookFunction,
    propName,
    resolveTag,
    componentIdOfReference,
    ownHookId,
  };
}

export { createResolver };
export type Resolver = ReturnType<typeof createResolver>;
