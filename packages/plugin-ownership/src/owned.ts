/**
 * Values stated owned: a declaration whose type states the `owned` guarantee
 * (`type Owned<T> = T & { readonly __guarantee?: "owned" }`). Only the declaring module may change
 * one, and stateward proves it: every change from another module is reported, and every place it
 * cannot follow is reported too, with why. Read per file, so the summary is JSON.
 */
import ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { shorten } from "./text.js";
import { assignmentExample, call, isWriteTarget, methodExample, unwrapped } from "./syntax.js";

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
  /** The first property changed (`theme` in `settings.theme = …`): picks the owner's function. */
  prop: string | null;
  /** The owner's call that would make the change, when the owner has none. */
  example: string;
  hops: Hop[];
  /** This file's path as its ids give it: the writer named in a headline with no declaration. */
  writer: string | null;
};

/** A function of the owner that changes its owned value: offered to the other modules. */
export type OwnerFunction = { id: string; fn: string; props: string[] };

/** A declaration this file states owned (`stateward guarantees`, hover, code lens). */
export type OwnedDeclaration = Place & {
  id: string;
  name: string;
  /** The declaration's type as written (`Owned<Settings>`), or `Owned` when long or inferred. */
  marker: string;
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
type Source =
  | { kind: "owned"; id: string; name: string; decl: Place; hops: Hop[] }
  | { kind: "unknown"; name: string; reason: string; hops: Hop[] };

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
function isDefaultLibrary(file: string, types: TypeQueries): boolean {
  return types.packageOf(file) === "typescript" && /(?:^|[\\/])lib\.[^\\/]*\.d\.ts$/.test(file);
}

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
const CHANGES_FIRST: ReadonlyMap<string, ReadonlySet<string>> = new Map([
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
function ownerTypeName(node: ts.Node): string | undefined {
  const parent = node.parent;
  if (ts.isInterfaceDeclaration(parent) || ts.isClassDeclaration(parent)) return parent.name?.text;
  return undefined;
}

/** The name of a library value (`Object`, `Reflect`) a call is reached through. */
function libraryObject(callee: ts.Expression): string | undefined {
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
function functionOf(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
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

/** The argument of a callback that is an element of the receiver: `item` in `items.forEach(item => …)`. */
function elementIndex(method: string): number {
  return method === "reduce" || method === "reduceRight" ? 1 : 0;
}

/** Follows expressions back to the declaration stated owned they reach. */
function createResolver(types: TypeQueries) {
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
    return { kind: "unknown", name, reason, hops: [] };
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
            inner,
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
      return { kind: "owned", id: symbol.id, name, decl: placeOf(declaration.name), hops: [] };
    }
    return inner ?? typedOnlyNamed(name);
  };

  const typedOnlyNamed = (name: string): Source => ({
    kind: "unknown",
    name,
    reason: `import the value itself, or make the change in its owner: which declaration \`${name}\` holds is not known`,
    hops: [],
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
      : withHop(inner, element.name, `\`${textOf(element.name)}\` is part of \`${textOf(from)}\``);
  };

  /** `item` in `items.forEach((item) => …)`: an element of a library collection stated owned. */
  const fromCallback = (parameter: ts.ParameterDeclaration, depth: number): Source | undefined => {
    const fn = parameter.parent;
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
    const outer = fn.parent;
    if (!ts.isCallExpression(outer) || !outer.arguments.includes(fn)) return undefined;
    const callee = unwrapped(outer.expression);
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    if (fn.parameters.indexOf(parameter) !== elementIndex(callee.name.text)) return undefined;
    const method = types.symbolAt(callee.name);
    const declared = method && types.declarationOf(method);
    if (declared === undefined || !isDefaultLibrary(declared.file, types)) return undefined;
    const inner = sourceOf(callee.expression, depth + 1);
    return inner === undefined
      ? undefined
      : withHop(
          inner,
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
      return (
        fromCallback(declaration, depth) ??
        (declaration.type !== undefined && states(symbol) ? typedOnlyNamed(at.text) : undefined)
      );
    }
    if (ts.isPropertyDeclaration(declaration) && isStatic(declaration) && states(symbol)) {
      const owner = ts.isClassLike(declaration.parent) ? declaration.parent.name?.text : undefined;
      const name = owner === undefined ? symbol.name : `${owner}.${symbol.name}`;
      return { kind: "owned", id: symbol.id, name, decl: placeOf(declaration.name), hops: [] };
    }
    if (
      ((ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) &&
        declaration.type !== undefined) ||
      ts.isShorthandPropertyAssignment(declaration)
    ) {
      const parent = at.parent;
      const shown = ts.isPropertyAccessExpression(parent) && parent.name === at ? parent : at;
      return states(symbol) ? typedOnlyNamed(textOf(shown)) : undefined;
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
          : withHop(inner, node, `\`${textOf(node)}\` is part of \`${textOf(callee.expression)}\``);
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
      }
      return sourceOf(node.expression, depth + 1);
    }
    if (ts.isElementAccessExpression(node)) return sourceOf(node.expression, depth + 1);
    if (ts.isCallExpression(node)) {
      // A call's own type is asked only for a function of the project: what a package or the
      // library returns is not a value of this project's modules.
      return fromCall(node, depth) ?? (callsProject(node) ? typedOnly(node) : undefined);
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
      return either
        ? (sourceOf(node.left, depth + 1) ?? sourceOf(node.right, depth + 1))
        : undefined;
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

/** The first property a change reaches below its root: `theme` in `settings.theme.dark = …`. */
function firstProperty(target: ts.Expression): string | null {
  let current = unwrapped(target);
  let found: string | null = null;
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) found = current.name.text;
    else if (ts.isElementAccessExpression(current)) {
      const key = current.argumentExpression;
      found = ts.isStringLiteral(key) ? key.text : null;
    } else return found;
    current = unwrapped(current.expression);
  }
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

/** Only these can reach a value stated owned: a name, a member, an element, a call, a cast. */
function mayReach(expression: ts.Expression): boolean {
  const node = unwrapped(expression);
  return (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node)
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
    source: { kind: "owned" | "unknown" } & Pick<OwnedChange, "name" | "hops">,
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
          const entry = ownerFns.get(key) ?? { id: sourceInfo.id, fn, props: [] };
          if (change.prop !== null && !entry.props.includes(change.prop)) {
            entry.props.push(change.prop);
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
    });
  };

  const record = (
    found: ReturnType<typeof resolver.sourceOf>,
    change: Omit<OwnedChange, "id" | "name" | "decl" | "hops" | "writer"> & { node: ts.Node },
  ): void => {
    if (found === undefined) return;
    if (found.kind === "owned") {
      add(found, change, { id: found.id, decl: found.decl });
      return;
    }
    // A value typed `Owned` whose declaration stateward cannot tell: whatever it does with it.
    add(
      found,
      { ...change, kind: "unknown", place: textOf(change.node), reason: found.reason },
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
  });

  const onWrite = (target: ts.PropertyAccessExpression | ts.ElementAccessExpression): void => {
    const found =
      resolver.ownTarget(target) ??
      (mayReach(target.expression) ? resolver.sourceOf(target.expression) : undefined);
    if (found === undefined) return;
    record(found, {
      ...base(target, "write"),
      prop: firstProperty(target),
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
      prop: firstProperty(receiver),
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

  const onArguments = (node: ts.CallExpression): void => {
    const callee = unwrapped(node.expression);
    for (const [index, argument] of node.arguments.entries()) {
      if (ts.isSpreadElement(argument)) return;
      if (!mayReach(argument)) continue;
      const found = resolver.sourceOf(argument);
      if (found === undefined || types.isPrimitive(argument)) continue;
      const root = found.name.split(".").at(-1) ?? found.name;
      const change = {
        ...base(argument, "write" as const),
        prop: firstProperty(argument),
        example: call(`update${root.slice(0, 1).toUpperCase()}${root.slice(1)}`, []),
      };
      const named = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
      const symbol = types.symbolAt(named);
      const declared = symbol && types.declarationOf(symbol);
      if (declared !== undefined && isDefaultLibrary(declared.file, types)) {
        const object = libraryObject(callee);
        const changes =
          index === 0 &&
          ts.isPropertyAccessExpression(callee) &&
          object !== undefined &&
          (CHANGES_FIRST.get(object)?.has(callee.name.text) ?? false);
        if (changes) record(found, change);
        continue;
      }
      if (types.parameterIsReadonly(node, index)) continue;
      if (symbol !== undefined && declared !== undefined && types.isOwnFile(declared.file)) {
        record(found, { ...change, kind: "pass", callee: symbol.id, index });
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
      if (ts.isPropertyAccessExpression(callee)) onMethod(node, callee);
      onArguments(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const byPlace = (a: Place, b: Place): number => a.start - b.start || a.end - b.end;
  owned.sort(byPlace);
  const fns = [...ownerFns.values()]
    .map((entry) => ({ ...entry, props: [...entry.props].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.fn < b.fn ? -1 : a.fn > b.fn ? 1 : 0));
  ownerWrites.sort(byPlace);
  return { owned, ownerFns: fns, declared, ownerWrites };
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
  ): void => {
    const symbol = types.symbolAt(name);
    if (symbol === undefined || !types.guaranteesOf(symbol).includes(OWNED)) return;
    const text = type?.getText(sourceFile) ?? "";
    found.push({
      ...placeOf(name),
      id: symbol.id,
      name: shown,
      marker: text !== "" && text.length <= MARKER_TEXT_MAX ? text : "Owned",
    });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name, declaration.name.text, declaration.type);
        }
      }
    } else if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (!ts.isPropertyDeclaration(member) || !isStatic(member)) continue;
        if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) continue;
        const owner = statement.name?.text;
        const shown = owner === undefined ? member.name.text : `${owner}.${member.name.text}`;
        add(member.name, shown, member.type);
      }
    }
  }
  return found;
}
