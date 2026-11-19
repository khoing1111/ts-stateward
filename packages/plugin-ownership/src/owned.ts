/**
 * Values stated owned: a declaration whose type states the `owned` guarantee
 * (`type Owned<T> = T & { readonly "__guarantee:owned"?: true }`). Only the declaring module may change
 * one, and stateward proves it: every change from another module is reported, and every place it
 * cannot follow is reported too, with why. Read per file, so the summary is JSON.
 */
import ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { shorten } from "./text.js";
import {
  assignmentExample,
  call,
  isObjectAssign,
  isWrapper,
  isWriteTarget,
  methodExample,
  unwrapped,
} from "./syntax.js";

/** The guarantee name `Owned<T>` states (`TypeQueries.guaranteesOf`). */
export const OWNED = "owned";

/** How many hops (aliases, returns, elements) are followed from a change to its declaration. */
const MAX_HOPS = 8;

/** A place in a file. */
export type Place = { file: string; start: number; end: number };

/** A hop from a change to the declaration it reaches, shown as a note. */
export type Hop = Place & { message: string };

/**
 * What this file does to a value stated owned. `write`: changes it. `pass`: hands it to a function
 * of the project (`callee`, argument `index`), a change when that function changes its parameter.
 * `unknown`: a place stateward cannot follow, with `reason` (what makes it provable).
 */
export type OwnedChange = Place & {
  kind: "write" | "pass" | "unknown";
  /** The declaration's qualified id, or null when stateward cannot tell which one it is. */
  id: string | null;
  /** The declaration's name, or the expression's text when it cannot tell. */
  name: string;
  decl: Place | null;
  callee: string | null;
  index: number;
  /** For `unknown`: the code shown in the headline, and the fix line. */
  place: string;
  reason: string;
  /**
   * For `unknown`: what the place does that cannot be followed, said after its code ("stores
   * `settings` in `list`, where it cannot be followed"); empty for the older forms.
   */
  what: string;
  /**
   * The property path the change reaches below the owned value (`meta.n` in `settings.meta.n = 3`),
   * or null when it is none or not known: it, with `shape`, picks the owner's function.
   */
  path: string | null;
  /** What is done there and with what value (`=null`, `=lit:"x"`, `op:++`, `call:push`). */
  shape: string;
  /** The properties an `Object.assign(settings, { … })` sets, when its literal says. */
  sets: string[];
  /** The owner's call that would make the change, when the owner has none. */
  example: string;
  hops: Hop[];
  /** This file's path as its ids give it: the writer named in a headline with no declaration. */
  writer: string | null;
  /**
   * For a value whose declaration is not found: its type as the checker writes it, when known. The
   * declarations it may be are the ones of that type (`OwnedDeclaration.type`).
   */
  valueType?: string;
};

/** One change an owner's function makes: its property path and shape, as `OwnedChange` has them. */
export type OwnerWriteShape = { path: string; shape: string };

/** A function of the owner that changes its owned value: offered to the other modules. */
export type OwnerFunction = { id: string; fn: string; writes: OwnerWriteShape[] };

/** A declaration this file states owned (`stateward guarantees`, hover, code lens). */
export type OwnedDeclaration = Place & {
  id: string;
  name: string;
  /** The declaration's type as written (`Owned<Settings>`), or `Owned` when long or inferred. */
  marker: string;
  /** Its type as the checker writes it: what a value of the same type may be. */
  type: string;
};

/** A change the owner makes to its own value: `fn` is the exported function it sits in, if any. */
export type OwnerWrite = Place & { id: string; fn: string | null };

export type OwnedSummary = {
  owned: OwnedChange[];
  ownerFns: OwnerFunction[];
  declared: OwnedDeclaration[];
  ownerWrites: OwnerWrite[];
};

/** A marker's type text longer than this is listed as `Owned`. */
const MARKER_TEXT_MAX = 60;

/** Where a value stated owned comes from. */
/** A function the summary of its parameters covers: a declaration or method with a name, or a function held by a variable. */
function isNamedFunction(fn: ts.Node): boolean {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) {
    return fn.name !== undefined && ts.isIdentifier(fn.name);
  }
  return (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(fn.parent) &&
    fn.parent.initializer === fn &&
    ts.isIdentifier(fn.parent.name)
  );
}

type Source =
  | {
      kind: "owned";
      id: string;
      name: string;
      decl: Place;
      hops: Hop[];
      /** The property path of this expression below the owned value; null when not known. */
      path: readonly string[] | null;
      shallow?: true;
      /** Reached by a computed key: whatever is done with it is not checked. */
      unclear?: { what: string; reason: string };
    }
  | {
      kind: "unknown";
      name: string;
      reason: string;
      hops: Hop[];
      shallow?: true;
      what?: string;
      /** The type of the value as the checker writes it: the declarations it may be are of that type. */
      type?: string;
    };

/**
 * A `shallow` source is a new container (`[settings]`, `{ ...settings }`, `Object.values(settings)`,
 * `new Map([[k, settings]])`) that holds the owned value, or its nested values: changing the
 * container itself changes nothing owned, but whatever is read out of it is owned.
 */
function member(source: Source): Source {
  if (source.shallow !== true) return source;
  const rest = { ...source };
  delete rest.shallow;
  return rest.kind === "owned" ? { ...rest, path: null } : rest;
}

function shared(source: Source, at: ts.Node, message: string): Source {
  return { ...withHop(member(source), at, message), shallow: true };
}

function placeOf(node: ts.Node): Place {
  const sourceFile = node.getSourceFile();
  return { file: sourceFile.fileName, start: node.getStart(sourceFile), end: node.end };
}

function textOf(node: ts.Node, max = 40): string {
  return shorten(node.getText(node.getSourceFile()), max);
}

function withHop(source: Source, at: ts.Node, message: string): Source {
  return { ...source, hops: [{ ...placeOf(at), message }, ...source.hops] };
}

function isModuleLevel(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return (
    ts.isVariableDeclarationList(list) &&
    ts.isVariableStatement(list.parent) &&
    ts.isSourceFile(list.parent.parent)
  );
}

function isStatic(node: ts.PropertyDeclaration): boolean {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
}

/** TypeScript's own library (`lib.*.d.ts`): `Array.prototype.push`, `Object.keys`, `JSON`. */
export function isDefaultLibrary(file: string, types: TypeQueries): boolean {
  return types.packageOf(file) === "typescript" && /(?:^|[\\/])lib\.[^\\/]*\.d\.ts$/.test(file);
}

/** The methods of TypeScript's library types that change the value they are called on. */
export const MUTATORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "Array",
    new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]),
  ],
  ["Map", new Set(["set", "delete", "clear"])],
  ["Set", new Set(["add", "delete", "clear"])],
  ["WeakMap", new Set(["set", "delete"])],
  ["WeakSet", new Set(["add", "delete"])],
  [
    "Date",
    new Set([
      "setDate",
      "setFullYear",
      "setHours",
      "setMilliseconds",
      "setMinutes",
      "setMonth",
      "setSeconds",
      "setTime",
      "setUTCDate",
      "setUTCFullYear",
      "setUTCHours",
      "setUTCMilliseconds",
      "setUTCMinutes",
      "setUTCMonth",
      "setUTCSeconds",
    ]),
  ],
]);

/** The library functions that change their first argument: `Object.assign(settings, …)`. */
export const CHANGES_FIRST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "Object",
    new Set([
      "assign",
      "defineProperty",
      "defineProperties",
      "setPrototypeOf",
      "freeze",
      "seal",
      "preventExtensions",
    ]),
  ],
  ["Reflect", new Set(["set", "deleteProperty", "defineProperty", "setPrototypeOf"])],
]);

/** The interface or class a library method is declared in (`Array` for `push`). */
export function ownerTypeName(node: ts.Node): string | undefined {
  const parent = node.parent;
  if (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent)) return parent.name?.text;
  return undefined;
}

/** Whether a library method keeps its arguments in the value it is called on (`push`, `set`, `add`). */
export function storesArguments(declared: ts.Node, method: string): boolean {
  return (
    method !== "delete" &&
    method !== "clear" &&
    (MUTATORS.get(ownerTypeName(declared) ?? "")?.has(method) ?? false)
  );
}

/** The name of a library value (`Object`, `Reflect`) a call is reached through. */
export function libraryObject(callee: ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const target = unwrapped(callee.expression);
  return ts.isIdentifier(target) ? target.text : undefined;
}

/** The returned expressions of a function body, not those of the functions inside it. */
function returnedExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  const found: ts.Expression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined) found.push(node.expression);
      return;
    }
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, walk);
  };
  const body = fn.body !== undefined && ts.isBlock(fn.body) ? fn.body : undefined;
  if (body !== undefined) ts.forEachChild(body, walk);
  return found;
}

/** The function a declaration declares: a function, a method, or `const f = () => …`. */
export function functionOf(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    return node;
  }
  if (
    (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
    node.initializer !== undefined
  ) {
    const initializer = unwrapped(node.initializer);
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      return initializer;
    }
  }
  return undefined;
}

/** The library methods that hand each element of the receiver to a function given to them. */
export const ELEMENT_METHODS: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "filter",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "reduce",
  "reduceRight",
  "sort",
  "toSorted",
]);

/** The argument of a callback that is an element of the receiver: `item` in `items.forEach(item => …)`. */
export function elementIndex(method: string): number {
  return method === "reduce" || method === "reduceRight" ? 1 : 0;
}

/**
 * The argument of a callback that is the receiver itself: `arr` in `items.forEach((item, i, arr)
 * => …)`; undefined for a method whose callback is not given it (`sort`).
 */
export function receiverIndex(method: string): number | undefined {
  if (method === "sort" || method === "toSorted") return undefined;
  return elementIndex(method) + 2;
}

/** Follows expressions back to the declaration stated owned they reach. */
export function createResolver(types: TypeQueries) {
  const states = (target: ts.Node | { id: string; name: string }): boolean =>
    types.guaranteesOf(target).includes(OWNED);

  const memo = new Map<ts.Node, Source | undefined>();

  /** A value typed `Owned` that stateward cannot trace to its declaration. */
  const typedOnly = (node: ts.Expression): Source | undefined => {
    if (!states(node)) return undefined;
    const name = textOf(node);
    const reason = ts.isCallExpression(node)
      ? `import the value itself, or make the change in its owner: which declaration \`${name}\` returns is not known`
      : `import the value itself, or make the change in its owner: which declaration \`${name}\` holds is not known`;
    return { kind: "unknown", name, reason, hops: [], type: types.typeTextOf(node) };
  };

  const fromVariable = (
    declaration: ts.VariableDeclaration,
    symbol: { id: string; name: string },
    depth: number,
  ): Source | "copy" | undefined => {
    if (!ts.isIdentifier(declaration.name)) return undefined;
    const name = declaration.name.text;
    const statement = declaration.parent.parent;
    if (ts.isForOfStatement(statement)) {
      const inner = sourceOf(statement.expression, depth + 1);
      return inner === undefined
        ? undefined
        : withHop(
            member(inner),
            declaration.name,
            `\`${name}\` is an element of \`${textOf(statement.expression)}\``,
          );
    }
    const initializer = declaration.initializer;
    const inner = initializer === undefined ? undefined : sourceOf(initializer, depth + 1);
    // An unannotated local has the type of what it is given, which `inner` already read: only an
    // annotation or a module-level declaration can state the guarantee by itself.
    const stated =
      (declaration.type !== undefined || isModuleLevel(declaration) || initializer === undefined) &&
      states(symbol);
    if (inner !== undefined && initializer !== undefined && (inner.kind === "owned" || !stated)) {
      return withHop(inner, declaration.name, `\`${name}\` is \`${textOf(initializer)}\``);
    }
    if (!stated) return undefined;
    // A copy (`{ ...settings }`, `structuredClone(settings)`) keeps the type, not the value.
    if (!isModuleLevel(declaration) && initializer !== undefined && isFresh(initializer)) {
      return "copy";
    }
    if (isModuleLevel(declaration)) {
      return {
        kind: "owned",
        id: symbol.id,
        name,
        decl: placeOf(declaration.name),
        hops: [],
        path: [],
      };
    }
    return inner ?? typedOnlyNamed(name, declaration.name);
  };

  const typedOnlyNamed = (name: string, node: ts.Node): Source => ({
    kind: "unknown",
    name,
    reason: `import the value itself, or make the change in its owner: which declaration \`${name}\` holds is not known`,
    hops: [],
    type: types.typeTextOf(node),
  });

  /** `const { user } = settings`, `for (const [key, entry] of cache)`: a part of what it reads. */
  const fromBinding = (element: ts.BindingElement, depth: number): Source | undefined => {
    let current: ts.Node = element;
    while (ts.isBindingElement(current) || ts.isObjectBindingPattern(current)) {
      current = current.parent;
      if (ts.isArrayBindingPattern(current)) current = current.parent;
    }
    if (!ts.isVariableDeclaration(current)) return undefined;
    const statement = current.parent.parent;
    const from = ts.isForOfStatement(statement) ? statement.expression : current.initializer;
    if (from === undefined) return undefined;
    const inner = sourceOf(from, depth + 1);
    return inner === undefined
      ? undefined
      : withHop(
          member(inner),
          element.name,
          `\`${textOf(element.name)}\` is part of \`${textOf(from)}\``,
        );
  };

  /** `item` in `items.forEach((item) => …)`: an element of a library collection stated owned. */
  const fromCallback = (parameter: ts.ParameterDeclaration, depth: number): Source | undefined => {
    const fn = parameter.parent;
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
    const outer = fn.parent;
    if (!ts.isCallExpression(outer) || !outer.arguments.includes(fn)) return undefined;
    const callee = unwrapped(outer.expression);
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const position = fn.parameters.indexOf(parameter);
    const whole =
      ELEMENT_METHODS.has(callee.name.text) && position === receiverIndex(callee.name.text);
    if (position !== elementIndex(callee.name.text) && !whole) return undefined;
    const method = types.symbolAt(callee.name);
    const declared = method && types.declarationOf(method);
    if (declared === undefined || !isDefaultLibrary(declared.file, types)) return undefined;
    const inner = sourceOf(callee.expression, depth + 1);
    if (inner !== undefined && whole) {
      return withHop(
        inner,
        parameter.name,
        `\`${textOf(parameter.name)}\` is \`${textOf(callee.expression)}\` itself`,
      );
    }
    return inner === undefined
      ? undefined
      : withHop(
          member(inner),
          parameter.name,
          `\`${textOf(parameter.name)}\` is an element of \`${textOf(callee.expression)}\``,
        );
  };

  /** What the name at `at` (an identifier, or the name of `a.b`) declares, when it reaches one. */
  const fromName = (at: ts.Identifier, depth: number): Source | "copy" | undefined => {
    const symbol = types.symbolAt(at);
    const found = symbol && types.declarationOf(symbol);
    if (symbol === undefined || found === undefined) return undefined;
    const declaration = found.node;
    if (ts.isVariableDeclaration(declaration)) return fromVariable(declaration, symbol, depth);
    if (ts.isBindingElement(declaration)) {
      // Its type is a part of what it destructures, which `fromBinding` already read.
      return fromBinding(declaration, depth);
    }
    if (ts.isParameter(declaration)) {
      // `o: typeof settings` in a named function: the value is whatever each call gives it, read
      // at the call through the function's summary of its parameters (a helper nothing calls
      // changes nothing).
      if (
        declaration.type !== undefined &&
        ts.isTypeQueryNode(declaration.type) &&
        isNamedFunction(declaration.parent)
      ) {
        return fromCallback(declaration, depth);
      }
      return (
        fromCallback(declaration, depth) ??
        (declaration.type !== undefined && states(symbol) ? typedOnlyNamed(at.text, at) : undefined)
      );
    }
    if (ts.isPropertyDeclaration(declaration) && isStatic(declaration) && states(symbol)) {
      const owner = ts.isClassLike(declaration.parent) ? declaration.parent.name?.text : undefined;
      const name = owner === undefined ? symbol.name : `${owner}.${symbol.name}`;
      return {
        kind: "owned",
        id: symbol.id,
        name,
        decl: placeOf(declaration.name),
        hops: [],
        path: [],
      };
    }
    if (
      ((ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) &&
        declaration.type !== undefined) ||
      ts.isShorthandPropertyAssignment(declaration)
    ) {
      const parent = at.parent;
      const shown = ts.isPropertyAccessExpression(parent) && parent.name === at ? parent : at;
      return states(symbol) ? typedOnlyNamed(textOf(shown), shown) : undefined;
    }
    if (ts.isPropertyAssignment(declaration)) {
      const inner = sourceOf(declaration.initializer, depth + 1);
      return inner === undefined
        ? undefined
        : withHop(
            inner,
            declaration.name,
            `\`${symbol.name}\` is \`${textOf(declaration.initializer)}\``,
          );
    }
    return undefined;
  };

  /** A call's result: a part of an owned receiver, or what a function of the project returns. */
  const fromCall = (node: ts.CallExpression, depth: number): Source | undefined => {
    const callee = unwrapped(node.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      const method = types.symbolAt(callee.name);
      const declared = method && types.declarationOf(method);
      if (declared !== undefined && isDefaultLibrary(declared.file, types)) {
        if (types.isPrimitive(node)) return undefined;
        const inner = sourceOf(callee.expression, depth + 1);
        return inner === undefined
          ? undefined
          : withHop(
              member(inner),
              node,
              `\`${textOf(node)}\` is part of \`${textOf(callee.expression)}\``,
            );
      }
    }
    const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = types.symbolAt(named);
    const found = symbol && types.declarationOf(symbol);
    if (found === undefined || !types.isOwnFile(found.file)) return undefined;
    const fn = functionOf(found.node);
    if (fn === undefined) return undefined;
    for (const returned of returnedExpressions(fn)) {
      const inner = sourceOf(returned, depth + 1);
      if (inner?.kind === "owned") {
        return withHop(inner, returned, `\`${textOf(named)}\` returns \`${textOf(returned)}\``);
      }
    }
    return undefined;
  };

  /** A new value: a literal, `new X()`, or what a library function returns (not a method on it). */
  const isFresh = (expression: ts.Expression): boolean => {
    const node = unwrapped(expression);
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isNewExpression(node)
    ) {
      return true;
    }
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrapped(node.expression);
    const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = types.symbolAt(named);
    const declared = symbol && types.declarationOf(symbol);
    if (declared === undefined || !isDefaultLibrary(declared.file, types)) return false;
    return !ts.isPropertyAccessExpression(callee) || sourceOf(callee.expression) === undefined;
  };

  /** The first owned value, or the nested values of one, that a list of expressions holds. */
  const holdsAny = (
    expressions: readonly (ts.Expression | undefined)[],
    at: ts.Node,
    depth: number,
  ): Source | undefined => {
    for (const expression of expressions) {
      if (expression === undefined) continue;
      const inner = sourceOf(expression, depth + 1);
      if (inner !== undefined) {
        return shared(inner, at, `\`${textOf(at)}\` holds \`${textOf(expression)}\``);
      }
    }
    return undefined;
  };

  /** A new array or object that holds an owned value, or the members of one (spread). */
  const fromLiteral = (
    node: ts.ArrayLiteralExpression | ts.ObjectLiteralExpression,
    depth: number,
  ): Source | undefined =>
    holdsAny(
      ts.isArrayLiteralExpression(node)
        ? node.elements.map((element) =>
            ts.isSpreadElement(element) ? element.expression : element,
          )
        : node.properties.map((property) => {
            if (ts.isSpreadAssignment(property)) return property.expression;
            if (ts.isPropertyAssignment(property)) return property.initializer;
            if (ts.isShorthandPropertyAssignment(property)) return property.name;
            return undefined;
          }),
      node,
      depth,
    );

  /** `new Map([[key, settings]])`: a library collection built from an owned value holds it. */
  const fromNew = (node: ts.NewExpression, depth: number): Source | undefined => {
    const named = unwrapped(node.expression);
    const symbol = types.symbolAt(ts.isPropertyAccessExpression(named) ? named.name : named);
    const declared = symbol && types.declarationOf(symbol);
    if (declared === undefined || !isDefaultLibrary(declared.file, types)) return undefined;
    return holdsAny(node.arguments ?? [], node, depth);
  };

  /**
   * A library function given an owned value that returns a container of it or of its nested values
   * (`Object.values(settings)`, `Object.assign({}, settings)`, `Array.from(settings.tags)`).
   */
  const fromSharing = (node: ts.CallExpression, depth: number): Source | undefined => {
    const callee = unwrapped(node.expression);
    const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = types.symbolAt(named);
    const declared = symbol && types.declarationOf(symbol);
    if (declared === undefined || !isDefaultLibrary(declared.file, types)) return undefined;
    if (named.getText(named.getSourceFile()) === "structuredClone") return undefined;
    if (types.isPrimitive(node)) return undefined;
    return holdsAny(
      node.arguments.map((argument) =>
        ts.isSpreadElement(argument) ? argument.expression : argument,
      ),
      node,
      depth,
    );
  };

  const callsProject = (node: ts.CallExpression): boolean => {
    const callee = unwrapped(node.expression);
    const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    const symbol = types.symbolAt(named);
    const found = symbol && types.declarationOf(symbol);
    return found !== undefined && types.isOwnFile(found.file);
  };

  const resolve = (expression: ts.Expression, depth: number): Source | undefined => {
    if (depth > MAX_HOPS) return typedOnly(expression);
    const node = unwrapped(expression);
    if (ts.isIdentifier(node)) {
      const own = fromName(node, depth);
      // Its symbol's declared type was asked already: no question about this node's type.
      return own === "copy" ? undefined : own;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (ts.isIdentifier(node.name)) {
        const own = fromName(node.name, depth);
        if (own === "copy") return undefined;
        if (own !== undefined) return own;
        // A property of an object literal of this project is what its literal gives it, not a
        // member of whatever the literal holds.
        const symbol = types.symbolAt(node.name);
        const declared = symbol && types.declarationOf(symbol);
        if (declared !== undefined && ts.isPropertyAssignment(declared.node)) return undefined;
      }
      const base = sourceOf(node.expression, depth + 1);
      if (base === undefined) return undefined;
      const moved = member(base);
      return moved.kind === "owned" &&
        base.kind === "owned" &&
        base.shallow !== true &&
        base.path !== null
        ? { ...moved, path: [...base.path, node.name.text] }
        : moved;
    }
    if (ts.isElementAccessExpression(node)) {
      const base = sourceOf(node.expression, depth + 1);
      if (base === undefined) return undefined;
      const key = node.argumentExpression;
      if (base.shallow === true && !ts.isStringLiteralLike(key) && !ts.isNumericLiteral(key)) {
        const unclear = {
          what: `reads \`${textOf(node.expression)}\` by a computed key, so which value it picks is not known`,
          reason: `read it with a fixed key, or make the change in its owner: which of the values in \`${textOf(node.expression)}\` \`${textOf(key)}\` picks is not known`,
        };
        const moved = member(base);
        return moved.kind === "owned" ? { ...moved, unclear } : moved;
      }
      const moved = member(base);
      const named = ts.isStringLiteralLike(key) ? key.text : undefined;
      return moved.kind === "owned" &&
        base.kind === "owned" &&
        base.shallow !== true &&
        base.path !== null &&
        named !== undefined
        ? { ...moved, path: [...base.path, named] }
        : moved.kind === "owned"
          ? { ...moved, path: null }
          : moved;
    }
    if (ts.isAwaitExpression(node)) {
      const inner = sourceOf(node.expression, depth + 1);
      return inner === undefined ? undefined : member(inner);
    }
    if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) {
      return fromLiteral(node, depth);
    }
    if (ts.isNewExpression(node)) return fromNew(node, depth);
    if (ts.isCallExpression(node)) {
      // A call's own type is asked only for a function of the project: what a package or the
      // library returns is not a value of this project's modules.
      return (
        fromCall(node, depth) ??
        fromSharing(node, depth) ??
        (callsProject(node) ? typedOnly(node) : undefined)
      );
    }
    if (ts.isConditionalExpression(node)) {
      return sourceOf(node.whenTrue, depth + 1) ?? sourceOf(node.whenFalse, depth + 1);
    }
    if (ts.isBinaryExpression(node)) {
      const { kind } = node.operatorToken;
      const either =
        kind === ts.SyntaxKind.QuestionQuestionToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.AmpersandAmpersandToken;
      if (!either) return undefined;
      // `o ?? settings`: either side may be the value. A side whose declaration is known names it,
      // so the change is linked to that value rather than to one the rule cannot place.
      const left = sourceOf(node.left, depth + 1);
      const right = sourceOf(node.right, depth + 1);
      if (left === undefined || right === undefined) return left ?? right;
      return left.kind === "unknown" && right.kind === "owned" ? right : left;
    }
    // A literal, `new`, a function, `this`, `await`, arithmetic: a new value, or none of a module's.
    return undefined;
  };

  function sourceOf(expression: ts.Expression, depth = 0): Source | undefined {
    if (memo.has(expression)) return memo.get(expression);
    // A cycle (`let a = b; let b = a`) ends here: nothing reached yet.
    memo.set(expression, undefined);
    const found = resolve(expression, depth);
    memo.set(expression, found);
    return found;
  }

  /** The declaration stated owned that the target of `a.b = v` replaces itself: a static. */
  const ownTarget = (target: ts.Expression): Source | undefined => {
    if (!ts.isPropertyAccessExpression(target) || !ts.isIdentifier(target.name)) return undefined;
    const symbol = types.symbolAt(target.name);
    const found = symbol && types.declarationOf(symbol);
    if (symbol === undefined || found === undefined) return undefined;
    const declaration = found.node;
    const own =
      ts.isPropertyDeclaration(declaration) && isStatic(declaration)
        ? fromName(target.name, 0)
        : undefined;
    return own === "copy" ? undefined : own;
  };

  return { sourceOf, ownTarget };
}

/** The function a change sits in, as other modules call it: an exported function or static method. */
function enclosingExport(node: ts.Node): string | undefined {
  const exported = (statement: ts.Node): boolean =>
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
  let current: ts.Node = node;
  let method: string | undefined;
  while (!ts.isSourceFile(current.parent)) {
    if (
      (ts.isMethodDeclaration(current) || ts.isPropertyDeclaration(current)) &&
      ts.isIdentifier(current.name) &&
      ts.canHaveModifiers(current) &&
      (ts.getModifiers(current) ?? []).some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
    ) {
      method = current.name.text;
    }
    current = current.parent;
  }
  if (!exported(current)) return undefined;
  if (ts.isFunctionDeclaration(current)) return current.name?.text;
  if (ts.isClassDeclaration(current)) {
    return current.name === undefined || method === undefined
      ? undefined
      : `${current.name.text}.${method}`;
  }
  if (ts.isVariableStatement(current)) {
    const [declaration] = current.declarationList.declarations;
    if (declaration === undefined || !ts.isIdentifier(declaration.name)) return undefined;
    return functionOf(declaration) === undefined ? undefined : declaration.name.text;
  }
  return undefined;
}

/** Where a method of the project changes `this` (directly or through another method of it). */
function changesThis(declaration: ts.Node, types: TypeQueries, depth = 0): ts.Node | undefined {
  const fn = functionOf(declaration);
  if (fn?.body === undefined || depth > 3) return undefined;
  let found: ts.Node | undefined;
  const rootIsThis = (expression: ts.Expression): boolean => {
    let current = unwrapped(expression);
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapped(current.expression);
    }
    return current.kind === ts.SyntaxKind.ThisKeyword;
  };
  const walk = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return;
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isWriteTarget(node) &&
      rootIsThis(node.expression)
    ) {
      found = node;
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrapped(node.expression);
      if (ts.isPropertyAccessExpression(callee) && rootIsThis(callee.expression)) {
        const symbol = types.symbolAt(callee.name);
        const declared = symbol && types.declarationOf(symbol);
        if (declared !== undefined) {
          const isMutator =
            isDefaultLibrary(declared.file, types) &&
            (MUTATORS.get(ownerTypeName(declared.node) ?? "")?.has(callee.name.text) ?? false);
          if (isMutator) {
            found = callee;
            return;
          }
          if (types.isOwnFile(declared.file) && changesThis(declared.node, types, depth + 1)) {
            found = callee;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(fn.body);
  return found;
}

/** The path the ids give this file (`src/app.ts`): the first name declared in it tells. */
function idPathOf(ctx: FileContext): string | null {
  let found: string | null = null;
  const walk = (node: ts.Node): void => {
    if (found !== null) return;
    if (
      ts.isIdentifier(node) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isImportClause(node.parent)
    ) {
      const symbol = ctx.types.symbolAt(node);
      const declared = symbol && ctx.types.declarationOf(symbol);
      if (symbol !== undefined && declared?.file === ctx.file && symbol.id.includes("#")) {
        found = symbol.id.slice(0, symbol.id.indexOf("#"));
        return;
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(ctx.sourceFile);
  return found;
}

/** Only these can reach a value stated owned: a name, a member, an element, a call, a literal holding it. */
export function mayReach(expression: ts.Expression): boolean {
  const node = unwrapped(expression);
  return (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isObjectLiteralExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isAwaitExpression(node)
  );
}

/**
 * What this file does to values stated owned: each change from outside their owner, each place
 * stateward cannot follow, each value handed to a function; and the owner's own functions that
 * change its values, to offer to the other modules.
 */
export function scanOwned(ctx: FileContext): OwnedSummary {
  const { types, sourceFile } = ctx;
  const resolver = createResolver(types);
  const owned: OwnedChange[] = [];
  const ownerFns = new Map<string, OwnerFunction>();
  const ownerWrites: OwnerWrite[] = [];
  const declared = declaredOwned(ctx);
  /** The names this file states owned: an assignment to another name needs no type query. */
  const declaredNames = new Set(declared.map((declaration) => declaration.name));
  let writer: string | null | undefined;

  const add = (
    source: { kind: "owned" | "unknown"; type?: string } & Pick<OwnedChange, "name" | "hops">,
    change: Omit<OwnedChange, "id" | "name" | "decl" | "hops" | "writer"> & { node: ts.Node },
    sourceInfo: { id: string | null; decl: Place | null },
  ): void => {
    const { node, ...rest } = change;
    const mine = sourceInfo.decl !== null && sourceInfo.decl.file === ctx.file;
    if (mine && change.kind !== "pass") {
      if (change.kind === "write" && sourceInfo.id !== null) {
        const fn = enclosingExport(node);
        ownerWrites.push({
          id: sourceInfo.id,
          file: ctx.file,
          start: rest.start,
          end: rest.end,
          fn: fn ?? null,
        });
        if (fn !== undefined) {
          const key = `${sourceInfo.id}\u0000${fn}`;
          const entry = ownerFns.get(key) ?? { id: sourceInfo.id, fn, writes: [] };
          if (
            change.path !== null &&
            !entry.writes.some((w) => w.path === change.path && w.shape === change.shape)
          ) {
            entry.writes.push({ path: change.path, shape: change.shape });
          }
          ownerFns.set(key, entry);
        }
      }
      return;
    }
    if (sourceInfo.id === null) writer ??= idPathOf(ctx);
    owned.push({
      ...rest,
      id: sourceInfo.id,
      name: source.name,
      decl: sourceInfo.decl,
      hops: source.hops,
      writer: sourceInfo.id === null ? (writer ?? null) : null,
      ...(sourceInfo.id === null && source.type !== undefined ? { valueType: source.type } : {}),
    });
  };

  const record = (
    found: ReturnType<typeof resolver.sourceOf>,
    change: Omit<OwnedChange, "id" | "name" | "decl" | "hops" | "writer"> & { node: ts.Node },
  ): void => {
    if (found === undefined) return;
    // A change to a new container that holds the value changes nothing owned.
    if (found.shallow === true && change.kind === "write") return;
    if (found.kind === "owned") {
      const { unclear } = found;
      add(
        found,
        unclear === undefined
          ? change
          : { ...change, kind: "unknown", place: textOf(change.node), ...unclear },
        { id: found.id, decl: found.decl },
      );
      return;
    }
    // A value typed `Owned` whose declaration stateward cannot tell: whatever it does with it.
    add(
      found,
      {
        ...change,
        kind: "unknown",
        place: textOf(change.node),
        reason: found.reason,
        what: found.what ?? "",
      },
      { id: null, decl: null },
    );
  };

  const base = (node: ts.Node, kind: OwnedChange["kind"]) => ({
    node,
    kind,
    start: node.getStart(sourceFile),
    end: node.end,
    file: ctx.file,
    callee: null,
    index: 0,
    place: "",
    reason: "",
    what: "",
  });

  /** The property path of `expression`, plus the key `target` reads from it; null when unknown. */
  const pathOf = (
    expression: ts.Expression,
    target?: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  ): string | null => {
    const found = mayReach(expression) ? resolver.sourceOf(expression) : undefined;
    if (found?.kind !== "owned" || found.path === null || found.shallow === true) return null;
    if (target === undefined) return found.path.join(".");
    const key = ts.isPropertyAccessExpression(target)
      ? target.name.text
      : ts.isStringLiteralLike(target.argumentExpression)
        ? target.argumentExpression.text
        : undefined;
    return key === undefined ? null : [...found.path, key].join(".");
  };

  /** What kind of value an assignment gives: a literal, `null`, `undefined`, a parameter, or other. */
  const valueShape = (value: ts.Expression): string => {
    const node = unwrapped(value);
    if (node.kind === ts.SyntaxKind.NullKeyword) return "=null";
    if (ts.isIdentifier(node) && node.text === "undefined") return "=undefined";
    if (
      ts.isStringLiteralLike(node) ||
      ts.isNumericLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword
    ) {
      return `=lit:${node.getText(sourceFile)}`;
    }
    if (ts.isIdentifier(node)) {
      const declaration = types.declarationOf(types.symbolAt(node) ?? { id: "", name: "" })?.node;
      if (declaration !== undefined && ts.isParameter(declaration)) {
        return `=param:${types.typeTextOf(node)}`;
      }
    }
    return `=value:${types.typeTextOf(node)}`;
  };

  /** The value `[a.b] = [v]` or `({ k: a.b } = { k: v })` gives to its target, when it is written out. */
  const destructuredValue = (target: ts.Expression): ts.Expression | undefined => {
    const parent = target.parent;
    if (ts.isArrayLiteralExpression(parent)) {
      const outer = parent.parent;
      if (
        ts.isBinaryExpression(outer) &&
        outer.left === parent &&
        outer.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const right = unwrapped(outer.right);
        const element = ts.isArrayLiteralExpression(right)
          ? right.elements[parent.elements.indexOf(target)]
          : undefined;
        return element !== undefined && !ts.isSpreadElement(element) ? element : undefined;
      }
    }
    if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
      const outer = parent.parent.parent;
      if (
        ts.isBinaryExpression(outer) &&
        outer.left === parent.parent &&
        outer.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const right = unwrapped(outer.right);
        const key = parent.name.getText(sourceFile);
        const entry = ts.isObjectLiteralExpression(right)
          ? right.properties.find(
              (property) =>
                ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === key,
            )
          : undefined;
        return entry !== undefined && ts.isPropertyAssignment(entry)
          ? entry.initializer
          : undefined;
      }
    }
    return undefined;
  };

  /** What a write to `target` does, as a short key: two writes match only when the key does. */
  const shapeOfWrite = (target: ts.Expression): string => {
    let at: ts.Node = target;
    while (isWrapper(at.parent)) at = at.parent;
    const parent = at.parent;
    if (ts.isBinaryExpression(parent) && parent.left === at) {
      const { kind } = parent.operatorToken;
      return kind === ts.SyntaxKind.EqualsToken
        ? valueShape(parent.right)
        : `op:${parent.operatorToken.getText(sourceFile)}`;
    }
    if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
      return `op:${parent.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--"}`;
    }
    if (ts.isDeleteExpression(parent)) return "delete";
    const value = destructuredValue(target);
    return value === undefined ? "other" : valueShape(value);
  };

  /** The properties `Object.assign(settings, { a: 1, b })` sets, when the literal says. */
  const keysSet = (node: ts.CallExpression, index: number): string[] => {
    const callee = unwrapped(node.expression);
    const second = node.arguments[1];
    if (
      index !== 0 ||
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== "assign" ||
      libraryObject(callee) !== "Object" ||
      node.arguments.length !== 2 ||
      second === undefined
    ) {
      return [];
    }
    const literal = unwrapped(second);
    if (!ts.isObjectLiteralExpression(literal)) return [];
    const names = literal.properties.map((property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : undefined,
    );
    return names.every((name): name is string => name !== undefined) ? names : [];
  };

  const onWrite = (target: ts.PropertyAccessExpression | ts.ElementAccessExpression): void => {
    const found =
      resolver.ownTarget(target) ??
      (mayReach(target.expression) ? resolver.sourceOf(target.expression) : undefined);
    if (found === undefined) return;
    record(found, {
      ...base(target, "write"),
      path: pathOf(target.expression, target),
      shape: shapeOfWrite(target),
      sets: [],
      example: assignmentExample(target, found.name.split(".").at(-1) ?? found.name, sourceFile),
    });
  };

  const onMethod = (node: ts.CallExpression, callee: ts.PropertyAccessExpression): void => {
    const receiver = callee.expression;
    if (!mayReach(receiver)) return;
    const found = resolver.sourceOf(receiver);
    if (found === undefined) return;
    const method = callee.name.text;
    const root = found.name.split(".").at(-1) ?? found.name;
    const write = {
      ...base(callee, "write" as const),
      path: pathOf(receiver),
      shape: `call:${method}`,
      sets: [],
      example: methodExample(receiver, method, node.arguments, root, sourceFile),
    };
    const symbol = types.symbolAt(callee.name);
    const declared = symbol && types.declarationOf(symbol);
    if (declared === undefined) {
      if (types.isPrimitive(receiver)) return;
      record(found, {
        ...write,
        kind: "unknown",
        place: textOf(node),
        reason: `make the change in its owner: the type of \`${method}\` is not known, so neither is what it does to \`${found.name}\``,
      });
      return;
    }
    if (isDefaultLibrary(declared.file, types)) {
      if (MUTATORS.get(ownerTypeName(declared.node) ?? "")?.has(method) ?? false) {
        record(found, write);
      }
      return;
    }
    if (types.isOwnFile(declared.file)) {
      // A method a type declares (`reset(): void` in the `Owned<…>` type): its body is the
      // object's, which this does not reach, so what it changes is not known.
      if (functionOf(declared.node)?.body === undefined) {
        if (types.isPrimitive(receiver)) return;
        record(found, {
          ...write,
          kind: "unknown",
          place: textOf(node),
          reason: `make the change in its owner: \`${method}\` is declared by a type, so what its body changes in \`${found.name}\` is not known`,
        });
        return;
      }
      const at = changesThis(declared.node, types);
      if (at === undefined) return;
      record(
        found.kind === "owned" ? withHop(found, at, `\`${method}\` changes \`this\``) : found,
        write,
      );
      return;
    }
    if (types.isPrimitive(receiver)) return;
    record(found, {
      ...write,
      kind: "unknown",
      place: textOf(node),
      reason: `make the change in its owner: \`${method}\` is declared in a package, so whether it changes \`${found.name}\` is not known`,
    });
  };

  /** A value of this file that holds nothing owned yet: what a library collection is given. */
  const holder = (receiver: ts.Expression): boolean =>
    mayReach(receiver) && resolver.sourceOf(receiver) === undefined;

  const onArguments = (node: ts.CallExpression): void => {
    const callee = unwrapped(node.expression);
    for (const [index, given] of node.arguments.entries()) {
      const spread = ts.isSpreadElement(given);
      const argument = spread ? given.expression : given;
      if (!mayReach(argument)) continue;
      const found = resolver.sourceOf(argument);
      if (found === undefined || types.isPrimitive(argument)) continue;
      const root = found.name.split(".").at(-1) ?? found.name;
      const change = {
        ...base(argument, "write" as const),
        path: null,
        shape: `arg:${textOf(callee, 30)}`,
        sets: keysSet(node, index),
        example: call(`update${root.slice(0, 1).toUpperCase()}${root.slice(1)}`, []),
      };
      const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
      const symbol = types.symbolAt(named);
      const declared = symbol && types.declarationOf(symbol);
      if (spread && found.shallow !== true) {
        record(found, {
          ...change,
          kind: "unknown",
          place: `${textOf(named, 30)}(…)`,
          what: `spreads \`${textOf(argument)}\` into its arguments, so which parameter changes it is not known`,
          reason: "pass the value without a spread, or make the change in its owner",
        });
        continue;
      }
      if (declared !== undefined && isDefaultLibrary(declared.file, types)) {
        const object = libraryObject(callee);
        const changes =
          index === 0 &&
          ts.isPropertyAccessExpression(callee) &&
          object !== undefined &&
          (CHANGES_FIRST.get(object)?.has(callee.name.text) ?? false);
        if (changes) record(found, change);
        // A collection of this file that is given the value keeps it where it is not followed.
        const stores =
          ts.isPropertyAccessExpression(callee) &&
          (MUTATORS.get(ownerTypeName(declared.node) ?? "")?.has(callee.name.text) ?? false) &&
          callee.name.text !== "delete" &&
          callee.name.text !== "clear" &&
          holder(callee.expression);
        if (stores) {
          record(found, {
            ...change,
            kind: "unknown",
            place: textOf(node, 30),
            what: `stores \`${textOf(argument)}\` in \`${textOf(callee.expression)}\`, where it is not followed`,
            reason:
              "keep the value out of other collections, read from it where it is needed, or store a copy",
          });
        }
        continue;
      }
      if (types.parameterIsReadonly(node, index)) continue;
      if (
        symbol !== undefined &&
        declared !== undefined &&
        types.isOwnFile(declared.file) &&
        (functionOf(declared.node) !== undefined || ts.isFunctionDeclaration(declared.node))
      ) {
        record(found, { ...change, kind: "pass", callee: symbol.id, index });
        continue;
      }
      if (symbol !== undefined && declared !== undefined && types.isOwnFile(declared.file)) {
        const fnName = textOf(named, 30);
        record(found, {
          ...change,
          kind: "unknown",
          place: `${fnName}(…)`,
          reason: `pass a copy, or make the change in its owner: \`${fnName}\` is a parameter or a value, so what it does with \`${found.name}\` is not known`,
        });
        continue;
      }
      const fnName = textOf(named, 30);
      record(found, {
        ...change,
        kind: "unknown",
        place: `${fnName}(…)`,
        reason:
          declared === undefined
            ? `pass a copy, or make the change in its owner: \`${fnName}\` does not resolve to a function, so whether it changes \`${found.name}\` is not known`
            : `pass a copy, or take a \`Readonly\` parameter: \`${fnName}\` is declared in a package, so whether it changes \`${found.name}\` is not known`,
      });
    }
  };

  const noChange = (argument: ts.Expression) => ({
    ...base(argument, "unknown" as const),
    path: null,
    shape: "",
    sets: [],
    example: "",
  });

  /** `new Foo(settings)`: a class of the project or a package keeps the value where it is not followed. */
  const onNew = (node: ts.NewExpression): void => {
    const named = unwrapped(node.expression);
    const symbol = types.symbolAt(ts.isPropertyAccessExpression(named) ? named.name : named);
    const declared = symbol && types.declarationOf(symbol);
    if (declared !== undefined && isDefaultLibrary(declared.file, types)) return;
    for (const given of node.arguments ?? []) {
      const argument = ts.isSpreadElement(given) ? given.expression : given;
      if (!mayReach(argument) || types.isPrimitive(argument)) continue;
      record(resolver.sourceOf(argument), {
        ...noChange(argument),
        place: textOf(node, 30),
        what: `gives \`${textOf(argument)}\` to \`${textOf(named, 30)}\`, which keeps it where it is not followed`,
        reason: "pass a copy, or make the change in the owner",
      });
    }
  };

  /** `holder.value = settings`, `latest = settings`: the value is stored where it is not followed. */
  const onStore = (node: ts.BinaryExpression): void => {
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    const right = node.right;
    if (!mayReach(right) || types.isPrimitive(right)) return;
    const found = resolver.sourceOf(right);
    if (found === undefined) return;
    record(found, {
      ...noChange(right),
      place: textOf(node, 30),
      what: `stores \`${textOf(right)}\` in \`${textOf(node.left)}\`, where it is not followed`,
      reason: "read the value where it is needed, or store a copy",
    });
  };

  /**
   * Whether the component a JSX attribute belongs to may change what its props hold, or cannot be
   * found: it casts anywhere in its body (`as`, `<T>x`, other than `as const`), which could make a
   * readonly prop writable, or it hands a value that is not a primitive to `Object.assign` or to
   * a parameter of the project typed writable (TypeScript lets a readonly value go to both:
   * `bump(props.s.meta)`, a generic `each(props.s.items, …)`).
   */
  const componentMayChange = (attribute: ts.JsxAttribute): boolean => {
    const element = attribute.parent.parent;
    const tag = element.tagName;
    const named = ts.isPropertyAccessExpression(tag) ? tag.name : tag;
    const symbol = ts.isIdentifier(named) ? types.symbolAt(named) : undefined;
    const declared = symbol && types.declarationOf(symbol);
    const fn = declared === undefined ? undefined : functionOf(declared.node);
    if (fn?.body === undefined) return true;
    let found = false;
    const walk = (child: ts.Node): void => {
      if (found) return;
      if (
        (ts.isAsExpression(child) || ts.isTypeAssertionExpression(child)) &&
        !(ts.isTypeReferenceNode(child.type) && child.type.typeName.getText() === "const")
      ) {
        found = true;
        return;
      }
      if (ts.isCallExpression(child) && handsOnWritable(child)) {
        found = true;
        return;
      }
      ts.forEachChild(child, walk);
    };
    walk(fn.body);
    return found;
  };

  /** A call that is given an object it may change: `Object.assign(x, …)`, or a writable parameter of the project. */
  const handsOnWritable = (call: ts.CallExpression): boolean =>
    call.arguments.some((argument, index) => {
      if (ts.isSpreadElement(argument) || types.isPrimitive(argument)) return false;
      const value = unwrapped(argument);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return false;
      if (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value)) return false;
      if (index === 0 && isObjectAssign(call.expression, types)) return true;
      return types.callMayChange(call, index);
    });

  /** `<Panel session={session} />`: a component is a function this rule cannot see into. */
  const onJsx = (node: ts.JsxAttribute): void => {
    const value = node.initializer;
    if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) return;
    const expression = value.expression;
    if (!mayReach(expression) || types.isPrimitive(expression)) return;
    const found = resolver.sourceOf(expression);
    if (found === undefined) return;
    // A prop of the project's component that no code can change through, in a component that
    // casts nothing (a cast could take the `readonly` away): it reads the value only.
    if (types.propIsDeeplyReadonly(node) && !componentMayChange(node)) return;
    record(found, {
      ...noChange(expression),
      place: `<… ${node.name.getText(sourceFile)}={…} />`,
      what: `gives \`${textOf(expression)}\` to a component, which is not followed`,
      reason: "pass a copy, or read the value in the component's owner",
    });
  };

  /** `items.forEach(touch)`: each element goes to a function this rule is not shown. */
  const onElementCallback = (
    node: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
  ): void => {
    if (!ELEMENT_METHODS.has(callee.name.text) || !mayReach(callee.expression)) return;
    const found = resolver.sourceOf(callee.expression);
    if (found === undefined) return;
    const symbol = types.symbolAt(callee.name);
    const declared = symbol && types.declarationOf(symbol);
    if (declared === undefined || !isDefaultLibrary(declared.file, types)) return;
    for (const argument of node.arguments) {
      const fn = unwrapped(argument);
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) continue;
      if (!ts.isIdentifier(fn) && !ts.isPropertyAccessExpression(fn)) continue;
      if (types.isPrimitive(fn)) continue;
      record(found, {
        ...noChange(fn),
        place: textOf(node, 30),
        what: `hands each element of \`${textOf(callee.expression)}\` to \`${textOf(fn, 30)}\`, which is not followed`,
        reason: "give the method an arrow function, so what it does to the element is read",
      });
    }
  };

  /** `count += 1` in the module that states `count` owned: its owner replacing it. */
  const onReplace = (target: ts.Identifier): void => {
    if (!declaredNames.has(target.text)) return;
    const symbol = types.symbolAt(target);
    const own = declared.find((declaration) => declaration.id === symbol?.id);
    if (own === undefined) return;
    ownerWrites.push({
      id: own.id,
      file: ctx.file,
      start: target.getStart(sourceFile),
      end: target.end,
      fn: enclosingExport(target) ?? null,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node) && isWriteTarget(node)) onReplace(node);
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isWriteTarget(node)
    ) {
      onWrite(node);
    } else if (ts.isCallExpression(node)) {
      const callee = unwrapped(node.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        onMethod(node, callee);
        onElementCallback(node, callee);
      }
      onArguments(node);
    } else if (ts.isNewExpression(node)) {
      onNew(node);
    } else if (ts.isBinaryExpression(node)) {
      onStore(node);
    } else if (ts.isJsxAttribute(node)) {
      onJsx(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const byPlace = (a: Place, b: Place): number => a.start - b.start || a.end - b.end;
  owned.sort(byPlace);
  const fns = [...ownerFns.values()]
    .map((entry) => ({
      ...entry,
      writes: [...entry.writes].sort((a, b) =>
        a.path === b.path ? (a.shape < b.shape ? -1 : 1) : a.path < b.path ? -1 : 1,
      ),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.fn < b.fn ? -1 : a.fn > b.fn ? 1 : 0));
  ownerWrites.sort(byPlace);
  return { owned, ownerFns: fns, declared, ownerWrites };
}

/** Whether an expression reads a value that exists already: a name, or a member or element of one. */
function isCopy(expression: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isCopy(expression.expression);
  }
  if (ts.isIdentifier(expression) || expression.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return isCopy(expression.expression);
  }
  return false;
}

/**
 * The module-level variables and static fields this file states owned, changed or not: a marker
 * nothing changes is listed too. One type query per module-level name.
 */
function declaredOwned(ctx: FileContext): OwnedDeclaration[] {
  const { types, sourceFile } = ctx;
  const found: OwnedDeclaration[] = [];
  const add = (
    name: ts.Identifier | ts.PrivateIdentifier,
    shown: string,
    type: ts.TypeNode | undefined,
    initializer: ts.Expression | undefined,
  ): void => {
    // A copy of a value stated owned (`export const current = settings;`) is that value under
    // another name: only a declaration that writes the marker, or makes the value, states it.
    if (
      initializer !== undefined &&
      isCopy(initializer) &&
      (type === undefined || !types.guaranteesOf(type).includes(OWNED))
    ) {
      return;
    }
    const symbol = types.symbolAt(name);
    if (symbol === undefined || !types.guaranteesOf(symbol).includes(OWNED)) return;
    const text = type?.getText(sourceFile) ?? "";
    found.push({
      ...placeOf(name),
      id: symbol.id,
      name: shown,
      marker: text !== "" && text.length <= MARKER_TEXT_MAX ? text : "Owned",
      type: types.typeTextOf(name),
    });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name, declaration.name.text, declaration.type, declaration.initializer);
        }
      }
    } else if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (!ts.isPropertyDeclaration(member) || !isStatic(member)) continue;
        if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) continue;
        const owner = statement.name?.text;
        const shown = owner === undefined ? member.name.text : `${owner}.${member.name.text}`;
        add(member.name, shown, member.type, member.initializer);
      }
    }
  }
  return found;
}
