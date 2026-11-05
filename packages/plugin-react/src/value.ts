import ts from "@stateward/core/typescript";
import { matchesName, type TypeQueries } from "@stateward/core";
import { packageHookValue } from "./packages.js";
import { STABLE_HOOKS, calleeName, reactName, unwrapped } from "./react.js";
import { shorten } from "./text.js";

/** What kind of value is created anew on each render. */
export type Fresh = "function" | "object" | "array" | "instance";

/** A place in a file, with its 1-based line for messages that name it. */
export type Site = { start: number; end: number; line: number };

/**
 * A call to a function of the project, as written where it is made: what a fix that wraps the
 * call in `useMemo` needs.
 */
export type CallSite = {
  at: Site;
  /** The variable the call initialises (`columns` in `const columns = getColumns(prefix)`). */
  name: string | null;
  /** The call on one line: `getColumns(prefix)`. */
  text: string;
  /** The arguments that are not literals, as written: the dependencies of the `useMemo`. */
  args: string[];
  /** The arguments that are themselves new values every render. */
  freshArgs: string[];
};

/** Moving a closure that captures nothing out of its function, as three text edits' worth of data. */
export type Move = {
  /** The whole lines of its declaration, to remove. */
  remove: { start: number; end: number };
  /** The declaration as it reads at module level (dedented, with a blank line after). */
  text: string;
  /** Where it goes: the start of the top-level declaration that holds the function. */
  anchor: number;
};

/** What a closure reads from the function that creates it. */
export type Closure = {
  /** Names it reads that the creating function declares, in order of first use (`this` counts). */
  captures: string[];
  /** Every one of them is a parameter of the creating function. */
  params: boolean;
  /** It calls a hook, so it cannot be moved out of a render. */
  hooks: boolean;
  /** Set when it captures nothing and its declaration can be moved mechanically. */
  move: Move | null;
};

/** Members of an object spread into another (`{ ...cart, total }`): all but `except`. */
type Spread = { value: Value; except: readonly string[] };

/**
 * What a value in a render is, as far as its own function tells:
 *
 * - `stable`: the same value each render (module level, a setter, a ref, a memoized value, a
 *   primitive: compared by value);
 * - `external`: comes from outside what stateward follows (a parameter, a package's function):
 *   the rules say nothing about it;
 * - `fresh`: created anew each render (an inline function, an object or array literal, `new`);
 * - `from`: what another function of the project returns, at `path` (`useCart()` then `.onSave`);
 * - `unknown`: own code stateward cannot follow (`hook`: a hook it cannot read).
 */
export type Value =
  | { kind: "stable" }
  | { kind: "external" }
  | {
      kind: "fresh";
      what: Fresh;
      at: Site;
      /** The name it is created under (`onSave`), when it has one. */
      label: string | null;
      members: ReadonlyMap<string, Value>;
      spreads: readonly Spread[];
      /** A function: what it captures. Null for any other value. */
      closure: Closure | null;
      /**
       * A data value built only from the state of the function that creates it (`hsva`): these
       * names. Empty when it reads anything else, or is a function.
       */
      derived: readonly string[];
    }
  | {
      kind: "from";
      fn: string;
      path: readonly string[];
      except: readonly string[];
      /** The call it comes from, as written: `useCart()`. */
      source: string;
      call: CallSite;
    }
  | { kind: "unknown"; hook: boolean; text: string; at: Site };

/** Stands for a declaration outside the function being read. */
const MODULE_LEVEL: ts.Node = ts.factory.createEmptyStatement();

export type FreshValue = Extract<Value, { kind: "fresh" }>;

export const STABLE: Value = { kind: "stable" };
export const EXTERNAL: Value = { kind: "external" };

/** How many module-level names a package's hook is followed through (`api` then `baseApi`). */
const MAX_ALIASES = 4;

/** How deep a property path is followed: `cart.totals.byTax` and no further. */
export const MAX_PATH = 3;

export type RenderFunction =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

export function isFunctionLike(node: ts.Node): node is RenderFunction {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/**
 * The render function a node is in: the outermost function around it, so a value passed in JSX
 * inside `items.map((item) => …)` is read in the component, where it is created.
 */
export function renderFunctionOf(node: ts.Node): RenderFunction | undefined {
  let found: RenderFunction | undefined;
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (isFunctionLike(current)) found = current;
    current = current.parent;
  }
  return found;
}

export function siteOf(node: ts.Node, sourceFile: ts.SourceFile): Site {
  const start = node.getStart(sourceFile);
  return { start, end: node.end, line: sourceFile.getLineAndCharacterOfPosition(start).line + 1 };
}

/**
 * The id of a top-level function of an own file that stateward summarises: `function useCart()`
 * or `const useCart = () => …` at module level. Undefined for anything else (a method, a hook
 * made by a factory, a nested function).
 */
export function summarisedFunction(
  node: ts.Node,
):
  | { fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction; name: ts.Identifier }
  | undefined {
  if (ts.isFunctionDeclaration(node)) {
    if (node.body === undefined || node.name === undefined) return undefined;
    return ts.isSourceFile(node.parent) ? { fn: node, name: node.name } : undefined;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent)
  ) {
    const init = unwrapped(node.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return { fn: init, name: node.name };
    }
  }
  return undefined;
}

const ARRAY_METHODS: ReadonlySet<string> = new Set([
  "map",
  "filter",
  "slice",
  "concat",
  "flat",
  "flatMap",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
]);

/** Built-in functions that return a new object or array each call, by the interface declaring them. */
const FRESH_BUILTINS: Readonly<Record<string, ReadonlyMap<string, Fresh>>> = {
  Array: new Map([...ARRAY_METHODS].map((name) => [name, "array"])),
  ReadonlyArray: new Map([...ARRAY_METHODS].map((name) => [name, "array"])),
  ObjectConstructor: new Map<string, Fresh>([
    ["keys", "array"],
    ["values", "array"],
    ["entries", "array"],
    ["fromEntries", "object"],
  ]),
  ArrayConstructor: new Map<string, Fresh>([
    ["from", "array"],
    ["of", "array"],
  ]),
};

const LIB_FILE = /(?:^|\/)lib\.[\w.]*\.d\.ts$/;

/** What a built-in call creates (`items.filter(…)`, `Object.keys(…)`), or undefined. */
function freshBuiltin(types: TypeQueries, name: ts.Node): Fresh | undefined {
  const symbol = types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (declaration === undefined || !LIB_FILE.test(declaration.file.replaceAll("\\", "/"))) {
    return undefined;
  }
  const owner = declaration.node.parent;
  if (!ts.isInterfaceDeclaration(owner)) return undefined;
  return FRESH_BUILTINS[owner.name.text]?.get(symbol?.name ?? "");
}

/** Where a binding element sits under its variable: `const { a: { b } } = x` gives `["a", "b"]`. */
export function bindingPath(
  element: ts.BindingElement,
): { declaration: ts.VariableDeclaration | ts.ParameterDeclaration; path: string[] } | undefined {
  const path: string[] = [];
  let current: ts.Node = element;
  while (ts.isBindingElement(current)) {
    const pattern: ts.Node = current.parent;
    if (current.dotDotDotToken !== undefined) return undefined;
    if (ts.isObjectBindingPattern(pattern)) {
      const key = current.propertyName ?? current.name;
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) path.unshift(key.text);
      else return undefined;
    } else if (ts.isArrayBindingPattern(pattern)) {
      path.unshift(String(pattern.elements.indexOf(current)));
    } else {
      return undefined;
    }
    current = pattern.parent;
  }
  if (ts.isVariableDeclaration(current) || ts.isParameter(current)) {
    return { declaration: current, path };
  }
  return undefined;
}

/** The declarations a binding name or pattern introduces, by name. */
function bindingNames(
  name: ts.BindingName,
  into: Map<string, ts.Node>,
  declaration: ts.Node,
): void {
  if (ts.isIdentifier(name)) {
    if (!into.has(name.text)) into.set(name.text, declaration);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      bindingNames(element.name, into, ts.isIdentifier(element.name) ? element : declaration);
    }
  }
}

/** The names a block or a function's parameters declare, each to its declaration. */
function declaredIn(container: ts.Node): Map<string, ts.Node> {
  const names = new Map<string, ts.Node>();
  if (isFunctionLike(container)) {
    for (const parameter of container.parameters) bindingNames(parameter.name, names, parameter);
    return names;
  }
  const statements =
    ts.isBlock(container) ||
    ts.isSourceFile(container) ||
    ts.isCaseClause(container) ||
    ts.isDefaultClause(container)
      ? container.statements
      : undefined;
  for (const statement of statements ?? []) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name, names, declaration);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      names.set(statement.name.text, statement);
    }
  }
  return names;
}

/** The declaration of `name` seen from `from`, looking out to `fn` and no further. */
function localDeclaration(name: string, from: ts.Node, fn: ts.Node): ts.Node | undefined {
  let current: ts.Node = from.parent;
  for (;;) {
    const found = declaredIn(current).get(name);
    if (found !== undefined) return found;
    if (current === fn || ts.isSourceFile(current)) return undefined;
    current = current.parent;
  }
}

/**
 * Where a declaration starts counting the comments written right above it (a doc comment is not
 * a node when files are parsed without JSDoc), so nothing is inserted between a comment and what
 * it describes.
 */
function startWithComments(node: ts.Node, sourceFile: ts.SourceFile): number {
  const text = sourceFile.text;
  let start = node.getStart(sourceFile);
  const comments = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  for (const comment of comments.reverse()) {
    if (/\n[ \t]*\r?\n/.test(text.slice(comment.end, start))) break;
    start = comment.pos;
  }
  return start;
}

/** Whether an identifier reads a name (not a property name or a label of a declaration). */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name !== node;
  if (ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent)) return parent.name !== node;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false;
  return true;
}

/** A literal written in the code: never a dependency. */
function isLiteral(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  );
}

/** Merges two possible values: fresh wins (it is fresh on some renders), then from, unknown, external. */
function either(a: Value, b: Value): Value {
  const rank = (value: Value): number =>
    value.kind === "fresh"
      ? 4
      : value.kind === "from"
        ? 3
        : value.kind === "unknown"
          ? 2
          : value.kind === "external"
            ? 1
            : 0;
  return rank(b) > rank(a) ? b : a;
}

/** The value at `path` inside a value. */
export function memberOf(value: Value, path: readonly string[]): Value {
  let current = value;
  for (const [index, key] of path.entries()) {
    switch (current.kind) {
      case "stable":
      case "external":
      case "unknown":
        return current;
      case "from":
        return { ...current, path: [...current.path, ...path.slice(index)] };
      case "fresh": {
        const member = current.members.get(key);
        if (member !== undefined) {
          current = member;
          break;
        }
        const spread = current.spreads.find((candidate) => !candidate.except.includes(key));
        if (spread === undefined) return EXTERNAL;
        current = memberOf(spread.value, [key]);
        break;
      }
      default: {
        const unreachable: never = current;
        return unreachable;
      }
    }
  }
  return current;
}

/**
 * Reads the values of one function's render: what each expression in it holds, following local
 * declarations, destructuring and calls to the project's own functions.
 */
export class RenderScope {
  private readonly cache = new Map<ts.Node, Value>();
  private readonly visiting = new Set<ts.Node>();

  constructor(
    private readonly types: TypeQueries,
    private readonly sourceFile: ts.SourceFile,
    readonly fn: RenderFunction,
    /** The config's `stableHooks`: every value these hooks return is the same each render. */
    private readonly stableHooks: readonly string[] = [],
    /**
     * The config's `stableFunctions`: memoized functions of the project, which return the same
     * value for the same arguments (`bindRunHandlers(run)` with a WeakMap per run).
     */
    private readonly stableFunctions: readonly string[] = [],
  ) {}

  /** Whether a declaration is inside the function being read (the module-level stand-in is not). */
  isLocal(node: ts.Node): boolean {
    return (
      node !== MODULE_LEVEL &&
      node.getSourceFile() === this.sourceFile &&
      node.pos >= this.fn.pos &&
      node.end <= this.fn.end
    );
  }

  /** `source`: the node whose code is analysed, when `node` only stands for where it is. */
  private fresh(
    node: ts.Node,
    what: Fresh,
    label: string | null,
    source: ts.Node = node,
  ): FreshValue {
    return {
      kind: "fresh",
      what,
      at: siteOf(node, this.sourceFile),
      label,
      members: new Map(),
      spreads: [],
      closure: what === "function" ? this.closureOf(source) : null,
      derived: what === "function" ? [] : this.derivedOf(source),
    };
  }

  /** The names `node` reads that this function declares outside `node` itself. */
  private capturedBy(node: ts.Node): { names: string[]; declarations: ts.Node[]; hooks: boolean } {
    const names: string[] = [];
    const declarations: ts.Node[] = [];
    let hooks = false;
    const visit = (child: ts.Node): void => {
      if (child.kind === ts.SyntaxKind.ThisKeyword && !names.includes("this")) {
        names.push("this");
        declarations.push(this.fn);
      }
      if (ts.isCallExpression(child)) {
        const callee = calleeName(child.expression);
        if (ts.isIdentifier(callee) && /^use[A-Z0-9]/.test(callee.text)) hooks = true;
      }
      if (ts.isIdentifier(child) && isReference(child)) {
        const declaration = this.declarationOf(child);
        if (
          declaration !== undefined &&
          this.isLocal(declaration) &&
          !(declaration.pos >= node.pos && declaration.end <= node.end) &&
          !names.includes(child.text)
        ) {
          names.push(child.text);
          declarations.push(declaration);
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return { names, declarations, hooks };
  }

  private closureOf(node: ts.Node): Closure {
    const { names, declarations, hooks } = this.capturedBy(node);
    const params = declarations.every((declaration) => {
      if (declaration === this.fn) return false;
      const found = ts.isBindingElement(declaration) ? bindingPath(declaration) : undefined;
      return (
        ts.isParameter(declaration) || (found !== undefined && ts.isParameter(found.declaration))
      );
    });
    return {
      captures: names,
      params: names.length > 0 && params,
      hooks,
      move: names.length === 0 && !hooks ? this.moveOf(node) : null,
    };
  }

  /** A closure written as `const f = () => …` or `function f() {}` straight in the function's body. */
  private moveOf(node: ts.Node): Move | null {
    let statement: ts.Node | undefined;
    if (ts.isFunctionDeclaration(node)) statement = node;
    else if (
      ts.isVariableDeclaration(node.parent) &&
      node.parent.initializer === node &&
      ts.isIdentifier(node.parent.name) &&
      ts.isVariableDeclarationList(node.parent.parent) &&
      node.parent.parent.declarations.length === 1 &&
      ts.isVariableStatement(node.parent.parent.parent) &&
      node.parent.parent.parent.modifiers === undefined
    ) {
      statement = node.parent.parent.parent;
    }
    if (
      statement === undefined ||
      !ts.isBlock(statement.parent) ||
      statement.parent.parent !== this.fn
    ) {
      return null;
    }
    let top: ts.Node = this.fn;
    while (!ts.isSourceFile(top.parent)) top = top.parent;
    const text = this.sourceFile.text;
    const start = statement.getStart(this.sourceFile);
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const indent = text.slice(lineStart, start);
    if (indent.trim() !== "") return null;
    const after = /^[ \t]*\r?\n?/.exec(text.slice(statement.end));
    const lines = text
      .slice(start, statement.end)
      .split("\n")
      .map((line, index) =>
        index === 0 || !line.startsWith(indent) ? line : line.slice(indent.length),
      );
    return {
      remove: { start: lineStart, end: statement.end + (after?.[0].length ?? 0) },
      text: `${lines.join("\n")}\n\n`,
      anchor: startWithComments(top, this.sourceFile),
    };
  }

  /** The state of this function a data value is built from, when it reads nothing else of it. */
  private derivedOf(node: ts.Node): string[] {
    const { declarations, names } = this.capturedBy(node);
    if (names.length === 0 || !declarations.every((declaration) => this.isState(declaration))) {
      return [];
    }
    return names;
  }

  /** Whether a declaration is the value of `useState` or `useReducer`: `hsva` in `[hsva, setHsva]`. */
  private isState(declaration: ts.Node): boolean {
    if (!ts.isBindingElement(declaration)) return false;
    const found = bindingPath(declaration);
    const init = found?.declaration.initializer;
    if (found === undefined || init === undefined || !ts.isVariableDeclaration(found.declaration)) {
      return false;
    }
    const call = unwrapped(init);
    if (!ts.isCallExpression(call) || found.path.length !== 1 || found.path[0] !== "0")
      return false;
    const react = reactName(this.types, calleeName(call.expression));
    return react === "useState" || react === "useReducer";
  }

  /** The value of an expression; `label` names a literal created under a name. */
  valueOf(expression: ts.Expression, label: string | null = null): Value {
    const node = unwrapped(expression);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return this.fresh(node, "function", label);
    }
    if (ts.isObjectLiteralExpression(node)) return this.objectOf(node, label);
    if (ts.isArrayLiteralExpression(node)) return this.arrayOf(node, label);
    if (ts.isNewExpression(node)) return this.fresh(node, "instance", label);
    if (
      ts.isStringLiteralLike(node) ||
      ts.isNumericLiteral(node) ||
      ts.isTemplateExpression(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      node.kind === ts.SyntaxKind.NullKeyword
    ) {
      return STABLE;
    }
    if (ts.isConditionalExpression(node)) {
      return either(this.valueOf(node.whenTrue, label), this.valueOf(node.whenFalse, label));
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      return either(this.valueOf(node.left, label), this.valueOf(node.right, label));
    }
    if (
      ts.isIdentifier(node) ||
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node)
    ) {
      if (this.types.isPrimitive(node)) return STABLE;
      if (ts.isIdentifier(node)) return this.identifierOf(node);
      if (ts.isCallExpression(node)) return this.callOf(node);
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression) ||
            ts.isNumericLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (key === undefined) return EXTERNAL;
      return memberOf(this.valueOf(node.expression), [key]);
    }
    return EXTERNAL;
  }

  private objectOf(node: ts.ObjectLiteralExpression, label: string | null): Value {
    const members = new Map<string, Value>();
    const keys: string[] = [];
    for (const property of node.properties) {
      const name =
        property.name !== undefined &&
        (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
          ? property.name.text
          : undefined;
      if (name !== undefined) keys.push(name);
    }
    const spreads: Spread[] = [];
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        spreads.push({ value: this.valueOf(property.expression), except: keys });
        continue;
      }
      const name =
        ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
          ? property.name.text
          : undefined;
      if (name === undefined) continue;
      if (ts.isPropertyAssignment(property)) {
        members.set(name, this.valueOf(property.initializer, name));
      } else if (ts.isShorthandPropertyAssignment(property)) {
        members.set(name, this.valueOf(property.name, name));
      } else if (ts.isMethodDeclaration(property)) {
        members.set(name, this.fresh(property, "function", name));
      }
    }
    return { ...this.fresh(node, "object", label), members, spreads };
  }

  private arrayOf(node: ts.ArrayLiteralExpression, label: string | null): Value {
    const members = new Map<string, Value>();
    for (const [index, element] of node.elements.entries()) {
      if (ts.isSpreadElement(element)) break;
      if (ts.isOmittedExpression(element)) continue;
      members.set(String(index), this.valueOf(element));
    }
    return { ...this.fresh(node, "array", label), members };
  }

  private callOf(node: ts.CallExpression): Value {
    const name = calleeName(node.expression);
    const react = reactName(this.types, name);
    if (react !== undefined) return STABLE_HOOKS.has(react) ? STABLE : EXTERNAL;
    const builtin = freshBuiltin(this.types, name);
    if (builtin !== undefined) return this.fresh(node, builtin, null);
    const symbol = this.types.symbolAt(name);
    const declaration = symbol === undefined ? undefined : this.types.declarationOf(symbol);
    if (symbol === undefined || declaration === undefined) return EXTERNAL;
    if (
      this.stableHooks.length > 0 &&
      (matchesName(symbol.name, this.stableHooks) ||
        (ts.isIdentifier(name) && matchesName(name.text, this.stableHooks)))
    ) {
      return STABLE;
    }
    if (
      this.stableFunctions.length > 0 &&
      (matchesName(symbol.name, this.stableFunctions) ||
        (ts.isIdentifier(name) && matchesName(name.text, this.stableFunctions))) &&
      node.arguments.every(
        (argument) =>
          this.valueOf(ts.isSpreadElement(argument) ? argument.expression : argument).kind !==
          "fresh",
      )
    ) {
      // The same arguments give the same value; a new argument still gives a new one.
      return STABLE;
    }
    if (!this.types.isOwnFile(declaration.file)) {
      return this.packageValue(declaration.file, symbol.name);
    }
    const source = `${shorten(unwrapped(node.expression).getText(this.sourceFile), 30)}(${
      node.arguments.length > 0 ? "…" : ""
    })`;
    if (summarisedFunction(declaration.node) !== undefined) {
      return {
        kind: "from",
        fn: symbol.id,
        path: [],
        except: [],
        source,
        call: this.callSite(node),
      };
    }
    // A hook a package makes at module level (`create<S>()(…)`, `useSelector.withTypes<S>()`,
    // `export const { useGetQuery } = api` from RTK Query's `createApi`), or one of its hooks
    // given another name (`const useAppDispatch: () => AppDispatch = useDispatch`), is the
    // package's, like the package's own hooks.
    const made = this.madeByPackage(declaration.node, MAX_ALIASES);
    if (made !== undefined) return this.packageValue(made.file, made.name);
    // A function handed in (a prop, a parameter) is the caller's: not followed.
    const callee = unwrapped(node.expression);
    const base = ts.isPropertyAccessExpression(callee) ? callee.expression : callee;
    if (this.valueOf(base).kind === "external") return EXTERNAL;
    return {
      kind: "unknown",
      hook: /^use[A-Z0-9]/.test(symbol.name),
      text: source,
      at: siteOf(node, this.sourceFile),
    };
  }

  /** What a package's function returns: the same value each render when the package says so. */
  private packageValue(file: string, name: string): Value {
    const owner = this.types.packageOf(file);
    return owner !== undefined && packageHookValue(owner, name) === "stable" ? STABLE : EXTERNAL;
  }

  /**
   * The package export a module-level declaration of the project is made from, through calls,
   * member access, destructuring and other module-level names: `useDispatch` for
   * `const useAppDispatch = useDispatch.withTypes<AppDispatch>()`, `createApi` for
   * `export const { useGetQuery } = api` with `const api = createApi(…)`. Undefined when the
   * chain does not start at a package (`depth` stops a long or circular chain).
   */
  private madeByPackage(node: ts.Node, depth: number): { file: string; name: string } | undefined {
    if (depth <= 0) return undefined;
    let declaration: ts.Node = node;
    if (ts.isBindingElement(node)) {
      const found = bindingPath(node);
      if (found === undefined) return undefined;
      declaration = found.declaration;
    }
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
      return undefined;
    }
    let root = unwrapped(declaration.initializer);
    for (;;) {
      if (ts.isCallExpression(root)) root = unwrapped(root.expression);
      else if (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))
        root = unwrapped(root.expression);
      else break;
    }
    if (!ts.isIdentifier(root)) return undefined;
    const symbol = this.types.symbolAt(root);
    const found = symbol === undefined ? undefined : this.types.declarationOf(symbol);
    if (symbol === undefined || found === undefined) return undefined;
    if (!this.types.isOwnFile(found.file)) return { file: found.file, name: symbol.name };
    return this.madeByPackage(found.node, depth - 1);
  }

  /** A call as a fix that wraps it in `useMemo` writes it. */
  private callSite(node: ts.CallExpression): CallSite {
    let parent = node.parent;
    while (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      parent = parent.parent;
    }
    const name =
      ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : null;
    const args: string[] = [];
    const freshArgs: string[] = [];
    for (const argument of node.arguments) {
      const expression = ts.isSpreadElement(argument) ? argument.expression : argument;
      if (this.valueOf(expression).kind === "stable" && isLiteral(unwrapped(expression))) continue;
      const text = shorten(expression.getText(this.sourceFile), 30);
      if (!args.includes(text)) args.push(text);
      if (this.valueOf(expression).kind === "fresh" && !freshArgs.includes(text))
        freshArgs.push(text);
    }
    return {
      at: siteOf(node, this.sourceFile),
      name,
      text: node.getText(this.sourceFile).replace(/\s+/g, " "),
      args,
      freshArgs,
    };
  }

  private identifierOf(node: ts.Identifier): Value {
    const target = this.declarationOf(node);
    if (target === undefined) return EXTERNAL;
    if (!this.isLocal(target)) return STABLE;
    const known = this.cache.get(target);
    if (known !== undefined) return known;
    if (this.visiting.has(target)) return EXTERNAL;
    this.visiting.add(target);
    const value = this.declarationValue(target);
    this.visiting.delete(target);
    this.cache.set(target, value);
    return value;
  }

  /**
   * Where a name is declared. The name of a shorthand property (`{ onSave }`) is the property's
   * own declaration for the type checker, so the variable it reads is found by scope instead.
   */
  declarationOf(node: ts.Identifier): ts.Node | undefined {
    if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
      // Not declared in this function: a module-level name, the same each render.
      return localDeclaration(node.text, node, this.fn) ?? MODULE_LEVEL;
    }
    const symbol = this.types.symbolAt(node);
    return symbol === undefined ? undefined : this.types.declarationOf(symbol)?.node;
  }

  private declarationValue(target: ts.Node): Value {
    if (ts.isParameter(target)) return EXTERNAL;
    if (ts.isFunctionDeclaration(target)) {
      return this.fresh(target.name ?? target, "function", target.name?.text ?? null, target);
    }
    if (ts.isBindingElement(target)) {
      const found = bindingPath(target);
      if (found === undefined || ts.isParameter(found.declaration)) return EXTERNAL;
      const init = found.declaration.initializer;
      if (init === undefined) return EXTERNAL;
      return memberOf(this.valueOf(init), found.path);
    }
    if (ts.isVariableDeclaration(target) && ts.isIdentifier(target.name)) {
      const name = target.name;
      let value =
        target.initializer === undefined ? STABLE : this.valueOf(target.initializer, name.text);
      if ((ts.getCombinedNodeFlags(target) & ts.NodeFlags.Const) === 0) {
        for (const assigned of this.assignmentsTo(name))
          value = either(value, this.valueOf(assigned, name.text));
      }
      return value;
    }
    return EXTERNAL;
  }

  /** The values assigned to a `let` or `var` in this function after its declaration. */
  private assignmentsTo(name: ts.Identifier): ts.Expression[] {
    const found: ts.Expression[] = [];
    const symbol = this.types.symbolAt(name);
    const visit = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === name.text &&
        this.types.symbolAt(node.left)?.id === symbol?.id
      ) {
        found.push(node.right);
      }
      ts.forEachChild(node, visit);
    };
    visit(this.fn);
    return found;
  }
}
