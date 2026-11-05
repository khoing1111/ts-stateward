import ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { isFunctionBoundary, scanRunning, stripParentheses } from "../syntax.js";
import { oneLine, shorten } from "../text.js";
import {
  ANY_REJECTS,
  ARRAY_LENGTH,
  BUILTIN_ERRORS,
  DEFERRED_CALLERS,
  FETCH_ABORT,
  FETCH_REJECTS,
  MAPPING_METHODS,
  SYNC_CALLBACKS,
  THROWING_CONSTRUCTORS,
  THROWING_GLOBALS,
  THROWING_MEMBERS,
  builtinId,
  isNonThrowingReactHook,
} from "./builtins.js";
import type {
  Branch,
  ClassFact,
  PackageFacts,
  Doc,
  DocEntry,
  Effect,
  FunctionFact,
  Handler,
  Leaf,
  Span,
  ThrowsSummary,
  Try,
} from "./summary.js";

/** Why something adds `unknown`, as the hover and the messages show it. */
export const REASON = {
  noDeclaration: "no declaration",
  noBody: "no body (interface or abstract method)",
  callback: "callback of unknown origin",
  dynamic: "dynamic call",
  thrownValue: "a thrown value of unknown class",
  madeError: "an error made by a call",
  promise: "a promise stateward cannot follow",
  heldPromise: "promise held in a variable",
} as const;

/** Why a callback handed to a call of the platform that is not in the tables adds `unknown`. */
export function mayRunReason(callee: string): string {
  return `callback passed to \`${callee}\` may run during the call`;
}

/** The id of a function without a name; the analysis names it by its file and offset. */
export const ANONYMOUS = "";

/** A called name's text is cut to this many characters in hovers and messages. */
const TEXT_MAX = 40;
/** A class's `extends` chain is followed this deep at most. */
const MAX_CLASS_DEPTH = 20;

/** What a name resolves to, for this analysis. */
type Resolved =
  /** The platform: TypeScript's lib files and global declarations (`owner` for an interface member). */
  | { kind: "platform"; owner: string | null; name: string }
  | { kind: "function"; id: string; async: boolean; generator: boolean }
  | { kind: "class"; id: string; node: ts.ClassLikeDeclaration }
  | { kind: "parameter"; node: ts.Node }
  | { kind: "no-body" }
  /** A package's declaration (`id`, `node` in `file`): its facts come from `PackageResolver`. */
  | { kind: "package"; name: string; id: string; node: ts.Node; file: string }
  | { kind: "other" };

const TS_LIB = /\/typescript\/lib\/lib\.[^/]*\.d\.ts$/;

/** A declaration of the platform: TypeScript's lib, or a global in a declaration file. */
function isPlatform(node: ts.Node, file: string): boolean {
  if (TS_LIB.test(file)) return true;
  const sourceFile = node.getSourceFile();
  if (!sourceFile.isDeclarationFile) return false;
  const module = ts.findAncestor(node.parent, ts.isModuleDeclaration);
  const enclosing = module === undefined ? undefined : outermostModule(module);
  // `declare module "x"` is a package; `declare global` is the platform; a namespace is what
  // its file is.
  if (enclosing !== undefined && ts.isStringLiteral(enclosing.name)) return false;
  if (enclosing?.name.text === "global") return true;
  return !ts.isExternalModule(sourceFile);
}

/** `axios`, `@tanstack/react-query`, `react` for `@types/react`. */
function packageName(file: string): string {
  const at = file.lastIndexOf("/node_modules/");
  const parts = (at < 0 ? file : file.slice(at + "/node_modules/".length)).split("/");
  const [first = "", second = ""] = parts;
  if (first === "@types") return second.includes("__") ? `@${second.replace("__", "/")}` : second;
  return first.startsWith("@") ? `${first}/${second}` : first;
}

/**
 * The package a declaration outside the project belongs to: by its node_modules folder, or, for a
 * package linked from elsewhere (a workspace package, whose real path has no node_modules), by
 * the name in its package.json.
 */
export function packageNameOf(types: TypeQueries, file: string): string {
  return file.includes("/node_modules/")
    ? packageName(file)
    : (types.packageOf(file) ?? packageName(file));
}

/** The outermost of nested module declarations (`declare global { namespace X { … } }`). */
function outermostModule(module: ts.ModuleDeclaration): ts.ModuleDeclaration {
  const outer = ts.findAncestor(module.parent, ts.isModuleDeclaration);
  return outer === undefined ? module : outermostModule(outer);
}

/** The name of the `declare module "x"` a declaration sits in. */
function ambientModuleName(node: ts.Node): string | undefined {
  const module = ts.findAncestor(node.parent, ts.isModuleDeclaration);
  if (module === undefined) return undefined;
  const outer = outermostModule(module);
  return ts.isStringLiteral(outer.name) ? outer.name.text : undefined;
}

/**
 * `exports.load = function () {…}` (CommonJS, as a package's JavaScript writes it): the function
 * the assignment's property names. Its declaration is the property access or the assignment.
 */
function assignedFunction(node: ts.Node): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const assignment = ts.isPropertyAccessExpression(node) ? node.parent : node;
  if (
    !ts.isBinaryExpression(assignment) ||
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isPropertyAccessExpression(assignment.left) ||
    (ts.isPropertyAccessExpression(node) && assignment.left !== node)
  ) {
    return undefined;
  }
  const value = stripParentheses(assignment.right);
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
}

function functionInitializer(node: ts.Node): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const assigned = assignedFunction(node);
  if (assigned !== undefined) return assigned;
  if (
    !ts.isVariableDeclaration(node) &&
    !ts.isPropertyAssignment(node) &&
    !ts.isPropertyDeclaration(node)
  ) {
    return undefined;
  }
  const initializer =
    node.initializer === undefined ? undefined : stripParentheses(node.initializer);
  return initializer !== undefined &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ? initializer
    : undefined;
}

function isAsync(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind) === true;
}

/** The implementation of an overloaded function or method: a sibling with the same name and a body. */
function implementationOf(
  node: ts.FunctionDeclaration | ts.MethodDeclaration,
): ts.FunctionDeclaration | ts.MethodDeclaration | undefined {
  if (node.body !== undefined) return node;
  const name = node.name?.getText();
  const siblings: readonly ts.Node[] = ts.isClassLike(node.parent)
    ? node.parent.members
    : ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent) || ts.isBlock(node.parent)
      ? node.parent.statements
      : [];
  return siblings.find(
    (sibling): sibling is ts.FunctionDeclaration | ts.MethodDeclaration =>
      (ts.isFunctionDeclaration(sibling) || ts.isMethodDeclaration(sibling)) &&
      sibling.body !== undefined &&
      sibling.name?.getText() === name,
  );
}

/**
 * The signatures of a function or method declared without a body: itself and its body-less
 * overloads (an `export declare function`, a `.d.ts` function). Empty when it has a body.
 */
function signaturesOf(node: ts.FunctionDeclaration | ts.MethodDeclaration): readonly ts.Node[] {
  if (node.body !== undefined) return [];
  const name = node.name?.getText();
  const siblings: readonly ts.Node[] = ts.isClassLike(node.parent)
    ? node.parent.members
    : ts.isSourceFile(node.parent) || ts.isModuleBlock(node.parent) || ts.isBlock(node.parent)
      ? node.parent.statements
      : [];
  return siblings.filter(
    (sibling) =>
      (ts.isFunctionDeclaration(sibling) || ts.isMethodDeclaration(sibling)) &&
      sibling.body === undefined &&
      sibling.name?.getText() === name,
  );
}

/** Whether a body-less declaration (or one of its overloads) says what it throws with `@throws`. */
function hasThrowsTag(node: ts.FunctionDeclaration | ts.MethodDeclaration): boolean {
  return signaturesOf(node).some((signature) =>
    ts.getJSDocTags(signature).some(ts.isJSDocThrowsTag),
  );
}

function isParameterBinding(node: ts.Node): boolean {
  let at: ts.Node = node;
  while (ts.isBindingElement(at) || ts.isObjectBindingPattern(at) || ts.isArrayBindingPattern(at)) {
    at = at.parent;
  }
  return ts.isParameter(at);
}

/** What an own declaration is to a call. */
function ownKind(node: ts.Node, id: string): Resolved {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) return { kind: "no-body" };
    const implementation = implementationOf(node);
    if (implementation === undefined || hasModifier(node, ts.SyntaxKind.DeclareKeyword)) {
      // No body to read: it throws what its `@throws` says (`find` makes its fact), else unknown.
      return hasThrowsTag(node)
        ? { kind: "function", id, async: false, generator: false }
        : { kind: "no-body" };
    }
    return {
      kind: "function",
      id,
      async: isAsync(implementation),
      generator: implementation.asteriskToken !== undefined,
    };
  }
  const initializer = functionInitializer(node);
  if (initializer !== undefined) {
    return {
      kind: "function",
      id,
      async: isAsync(initializer),
      generator: ts.isFunctionExpression(initializer) && initializer.asteriskToken !== undefined,
    };
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return { kind: "class", id, node };
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
    const value = stripParentheses(node.initializer);
    if (ts.isClassExpression(value)) return { kind: "class", id, node: value };
  }
  if (isParameterBinding(node)) return { kind: "parameter", node };
  if (
    ts.isMethodSignature(node) ||
    ts.isPropertySignature(node) ||
    ts.isGetAccessorDeclaration(node)
  ) {
    return { kind: "no-body" };
  }
  return { kind: "other" };
}

/** The name a call or `new` names: `save` in `save()`, `this.save()` and `api.save()`. */
function calledName(callee: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(callee)) return callee;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name;
  return undefined;
}

function textOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  return shorten(oneLine(node.getText(sourceFile)), TEXT_MAX);
}

/** Inside one function: what it returns, the `reject` of a `new Promise`. */
type Scope = {
  readonly async: boolean;
  readonly returns: Effect[];
  readonly rejectParameters: ReadonlySet<ts.Node>;
};

/** Where effects go: the sink of the current block, and whether they sit under a test. */
type Walk = { readonly scope: Scope; readonly sink: Effect[]; readonly conditional: boolean };

function newScope(async: boolean, rejectParameters: ReadonlySet<ts.Node> = new Set()): Scope {
  return { async, returns: [], rejectParameters };
}

/** A package's declaration that a call reaches, for its facts (packages.ts). */
export type PackageCall = {
  readonly name: string;
  readonly id: string;
  readonly node: ts.Node;
  readonly file: string;
};

/** Finds what a call into a package throws; its classes, when it read some. */
export type PackageResolver = (call: PackageCall) => {
  readonly facts: PackageFacts;
  readonly classes: readonly ClassFact[];
};

/** `package:zod#ZodError`: a package's class, by its package and name, the same from its types and its source. */
export function packageClassId(name: string, className: string): string {
  return `package:${name}#${className}`;
}

/**
 * The id a class named in code has in the summaries (`builtin:TypeError`, `package:zod#ZodError`,
 * or the qualified id of a class of the project), without its facts; undefined when the name
 * resolves to nothing.
 */
export function classIdOf(types: TypeQueries, name: ts.Node): string | undefined {
  const symbol = types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (symbol === undefined || declaration === undefined) return undefined;
  if (types.isOwnFile(declaration.file)) return symbol.id;
  if (isPlatform(declaration.node, declaration.file)) {
    return BUILTIN_ERRORS.has(symbol.name) ? builtinId(symbol.name) : undefined;
  }
  return packageClassId(
    ambientModuleName(declaration.node) ?? packageNameOf(types, declaration.file),
    symbol.name,
  );
}

/**
 * The throws facts of the file (see summary.ts). With `packages`, a call into a package carries
 * its facts; without (a package's own source), it is unknown.
 */
export function summarizeThrows(ctx: FileContext, packages?: PackageResolver): ThrowsSummary {
  const { sourceFile, types } = ctx;
  const classes = new Map<string, ClassFact>();
  const spanOf = (node: ts.Node): Span => [node.getStart(sourceFile), node.getEnd()];

  const resolve = (name: ts.Node): Resolved | undefined => resolveWith(types, name);
  /**
   * `const p = load()`: what `p` rejects with, by its declaration, for a later `await p`,
   * `return p`, `Promise.all([p])` or `p.then(…)`. A `const` is never reassigned, so its promise
   * is the one its initializer made, wherever it is used in the file.
   */
  const held = new Map<ts.Node, readonly Effect[]>();

  // ---- classes --------------------------------------------------------------------------------

  const classRef = (node: ts.Node, depth = 0): string | undefined => {
    const name = ts.isPropertyAccessExpression(node)
      ? node.name
      : ts.isQualifiedName(node)
        ? node.right
        : node;
    const symbol = types.symbolAt(name);
    const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
    if (symbol === undefined || declaration === undefined) return undefined;
    const own = types.isOwnFile(declaration.file);
    if (!own && isPlatform(declaration.node, declaration.file)) {
      return BUILTIN_ERRORS.has(symbol.name) ? builtinId(symbol.name) : undefined;
    }
    // A package's class is named by its package and name: its types, its source and the config
    // all name it so.
    const id = own
      ? symbol.id
      : packageClassId(
          ambientModuleName(declaration.node) ?? packageNameOf(types, declaration.file),
          symbol.name,
        );
    let classNode: ts.ClassLikeDeclaration | undefined;
    if (ts.isClassDeclaration(declaration.node) || ts.isClassExpression(declaration.node)) {
      classNode = declaration.node;
    } else if (
      ts.isVariableDeclaration(declaration.node) &&
      declaration.node.initializer !== undefined &&
      ts.isClassExpression(stripParentheses(declaration.node.initializer))
    ) {
      const value = stripParentheses(declaration.node.initializer);
      classNode = ts.isClassExpression(value) ? value : undefined;
    }
    if (classNode === undefined) return undefined;
    if (!classes.has(id)) {
      // Placeholder first: a class that (wrongly) extends itself stops here.
      classes.set(id, { id, name: symbol.name, parent: null, open: true });
      const base = classNode.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types.at(0)?.expression;
      const parent =
        base === undefined || depth >= MAX_CLASS_DEPTH ? undefined : classRef(base, depth + 1);
      classes.set(id, {
        id,
        name: symbol.name,
        parent: parent ?? null,
        open: base !== undefined && parent === undefined,
      });
    }
    return id;
  };

  // ---- leaves ---------------------------------------------------------------------------------

  const unknownLeaf = (reason: string, text: string, node: ts.Node): Leaf => ({
    k: "unknown",
    reason,
    text,
    at: spanOf(node),
  });
  const classLeaves = (ids: readonly string[], text: string | null, node: ts.Node): Leaf[] =>
    ids.map((id) => ({ k: "class", id, text, at: spanOf(node) }));

  /**
   * A call into a package, by its facts: what it throws where it is called (`sync`) and what its
   * promise rejects with. Undefined for one of React's hooks that throw nothing.
   */
  const packageLeaves = (
    resolved: Extract<Resolved, { kind: "package" }>,
    text: string,
    node: ts.Node,
  ): { sync: Leaf[]; promise: Leaf[] } | undefined => {
    if (isNonThrowingReactHook(resolved.name, text)) return undefined;
    // A declaration whose JSDoc was read (a project's own `.d.ts`): what its `@throws` says.
    const tagged = taggedLeaves(resolved.node, text, node);
    if (tagged !== undefined) return tagged;
    if (packages === undefined) {
      const leaf = unknownLeaf(`package ${resolved.name}`, text, node);
      return { sync: [leaf], promise: [leaf] };
    }
    const found = packages(resolved);
    for (const fact of found.classes) if (!classes.has(fact.id)) classes.set(fact.id, fact);
    const at = spanOf(node);
    const { facts } = found;
    const side = (part: "throws" | "rejects"): Leaf[] =>
      facts[part].classes.length > 0 || facts[part].unknown.length > 0
        ? [{ k: "package", facts, part, text, at }]
        : [];
    return { sync: side("throws"), promise: side("rejects") };
  };

  /**
   * What a declaration without a body says it throws with `@throws` (on any of its overloads), as
   * leaves at the call; undefined without a tag. On a function that returns a promise the tag
   * is what the promise rejects with.
   */
  const taggedLeaves = (
    declaration: ts.Node,
    text: string,
    at: ts.Node,
  ): { sync: Leaf[]; promise: Leaf[] } | undefined => {
    const signatures =
      ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)
        ? signaturesOf(declaration)
        : [];
    const doc = docOf(...(signatures.length > 0 ? signatures : [declaration]));
    if (doc === null) return undefined;
    const span = spanOf(at);
    const leaves: Leaf[] = [
      ...doc.entries.map((entry): Leaf =>
        entry.id === null
          ? {
              k: "unknown",
              reason: "`@throws` names no class stateward can find",
              text: entry.name,
              at: span,
            }
          : { k: "class", id: entry.id, text: `${text}(…)`, at: span },
      ),
      ...doc.untyped.map((): Leaf => ({
        k: "unknown",
        reason: "`@throws` without a type",
        text: "@throws",
        at: span,
      })),
    ];
    return ts.isFunctionLike(declaration) && types.returnsPromiseLike(declaration)
      ? { sync: [], promise: leaves }
      : { sync: leaves, promise: [] };
  };

  /** The leaf of a name that cannot be followed, by what it resolved to. */
  const unresolvedLeaf = (
    resolved: Resolved | undefined,
    text: string,
    node: ts.Node,
  ): Leaf | undefined => {
    switch (resolved?.kind) {
      case undefined:
        return unknownLeaf(REASON.noDeclaration, text, node);
      case "no-body":
        return unknownLeaf(REASON.noBody, text, node);
      case "parameter":
        return unknownLeaf(REASON.callback, text, node);
      case "package":
        // Handled by `packageLeaves` where a call can be one.
        return isNonThrowingReactHook(resolved.name, text)
          ? undefined
          : unknownLeaf(`package ${resolved.name}`, text, node);
      case "other":
        return unknownLeaf(REASON.dynamic, text, node);
      case "platform":
      case "function":
      case "class":
        return undefined;
      default: {
        const unreachable: never = resolved;
        return unreachable;
      }
    }
  };

  // ---- expressions: push what throws now into the sink, return what the promise rejects with --

  const visit = (node: ts.Node, walk: Walk): void => {
    if (isFunctionBoundary(node)) return;
    if (ts.isBlock(node) || ts.isStatement(node)) {
      statement(node, walk);
    } else if (ts.isExpression(node)) {
      expression(node, walk);
    } else {
      ts.forEachChild(node, (child) => {
        visit(child, walk);
      });
    }
  };

  const expression = (node: ts.Expression, walk: Walk): Effect[] => {
    const e = stripParentheses(node);
    if (
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    ) {
      return expression(e.expression, walk);
    }
    if (isFunctionBoundary(e)) return [];
    if (ts.isAwaitExpression(e)) {
      walk.sink.push(...awaited(e.expression, walk));
      return [];
    }
    if (ts.isCallExpression(e)) return call(e, walk, false);
    if (ts.isNewExpression(e)) return construct(e, walk);
    if (ts.isConditionalExpression(e)) {
      expression(e.condition, walk);
      const branch = { ...walk, conditional: true };
      return [...flowing(e.whenTrue, branch), ...flowing(e.whenFalse, branch)];
    }
    ts.forEachChild(e, (child) => {
      visit(child, walk);
    });
    return [];
  };

  /** What the `const` that `name` refers to holds, when it is one this file summarized. */
  const heldBy = (name: ts.Identifier): readonly Effect[] | undefined => {
    const symbol = types.symbolAt(name);
    const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
    return declaration === undefined ? undefined : held.get(declaration.node);
  };

  const unwrap = (node: ts.Expression): ts.Expression => {
    const e = stripParentheses(node);
    return ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
      ? unwrap(e.expression)
      : e;
  };

  const isHolder = (
    e: ts.Expression,
  ): e is ts.Identifier | ts.PropertyAccessExpression | ts.ElementAccessExpression =>
    ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);

  /**
   * A value whose promise flows on (returned, awaited, joined, chained): what that promise rejects
   * with. A `const` gives what its initializer rejects with; any other variable, parameter or
   * property that holds a promise cannot be followed to where the promise was made.
   */
  const flowing = (node: ts.Expression, walk: Walk): Effect[] => {
    const e = unwrap(node);
    if (!isHolder(e)) return expression(e, walk);
    const known = ts.isIdentifier(e) ? heldBy(e) : undefined;
    if (known !== undefined) return [...known];
    expression(e, walk);
    return types.isPromiseLike(e)
      ? [unknownLeaf(REASON.heldPromise, textOf(e, sourceFile), e)]
      : [];
  };

  /** What `await <operand>` throws. */
  const awaited = (operand: ts.Expression, walk: Walk): Effect[] => {
    const inner = unwrap(operand);
    if (!isHolder(inner)) return expression(inner, walk);
    const known = ts.isIdentifier(inner) ? heldBy(inner) : undefined;
    if (known !== undefined) return [...known];
    // Awaited, so taken to be a promise whatever its type says (`any`, a union).
    expression(inner, walk);
    return [unknownLeaf(REASON.heldPromise, textOf(inner, sourceFile), inner)];
  };

  /** A callback's effects: what it throws when called, and what its promise rejects with. */
  const callback = (
    argument: ts.Expression | undefined,
    walk: Walk,
    rejectIndex?: number,
  ): { sync: Effect[]; promise: Effect[] } => {
    if (argument === undefined) return { sync: [], promise: [] };
    const fn = stripParentheses(argument);
    if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
      const reject = rejectIndex === undefined ? undefined : fn.parameters[rejectIndex];
      const scope = newScope(isAsync(fn), new Set(reject === undefined ? [] : [reject]));
      const sink: Effect[] = [];
      const inner: Walk = { scope, sink, conditional: false };
      if (ts.isBlock(fn.body)) statement(fn.body, inner);
      else scope.returns.push(...flowing(fn.body, inner));
      return scope.async
        ? { sync: [], promise: [...sink, ...scope.returns] }
        : { sync: sink, promise: scope.returns };
    }
    const name = calledName(fn);
    if (name === undefined) {
      expression(fn, walk);
      const leaf = unknownLeaf(REASON.callback, textOf(fn, sourceFile), fn);
      return { sync: [leaf], promise: [leaf] };
    }
    if (ts.isPropertyAccessExpression(fn)) expression(fn.expression, walk);
    const resolved = resolve(name);
    const text = textOf(fn, sourceFile);
    if (resolved?.kind === "function") {
      if (resolved.generator) return { sync: [], promise: [] };
      const at = spanOf(fn);
      const rejects: Leaf = { k: "call", id: resolved.id, part: "rejects", text, at };
      const throws: Leaf = { k: "call", id: resolved.id, part: "throws", text, at };
      return { sync: resolved.async ? [] : [throws], promise: [rejects] };
    }
    if (resolved?.kind === "package") {
      const leaves = packageLeaves(resolved, text, fn);
      return leaves === undefined
        ? { sync: [], promise: [] }
        : { sync: leaves.sync, promise: [...leaves.sync, ...leaves.promise] };
    }
    const leaf =
      resolved?.kind === "other"
        ? unknownLeaf(REASON.callback, text, fn)
        : unresolvedLeaf(resolved, text, fn);
    return leaf === undefined ? { sync: [], promise: [] } : { sync: [leaf], promise: [leaf] };
  };

  const both = (effects: { sync: Effect[]; promise: Effect[] }): Effect[] => [
    ...effects.sync,
    ...effects.promise,
  ];

  const evaluateArguments = (call: ts.CallExpression | ts.NewExpression, walk: Walk): void => {
    for (const argument of call.arguments ?? []) expression(argument, walk);
  };

  /** What the promises of `Promise.all(<argument>)` reject with. */
  const elements = (argument: ts.Expression | undefined, walk: Walk): Effect[] => {
    if (argument === undefined) return [];
    const list = stripParentheses(argument);
    if (ts.isArrayLiteralExpression(list)) {
      return list.elements.flatMap((element) => {
        if (ts.isSpreadElement(element)) {
          expression(element.expression, walk);
          return [unknownLeaf(REASON.promise, textOf(element, sourceFile), element)];
        }
        return flowing(element, walk);
      });
    }
    if (ts.isCallExpression(list)) return call(list, walk, true);
    expression(list, walk);
    return [unknownLeaf(REASON.promise, textOf(list, sourceFile), list)];
  };

  /** An argument in a callback's place that is a function (`replace` also takes a string). */
  const isCallback = (argument: ts.Expression): boolean => {
    const e = stripParentheses(argument);
    return ts.isArrowFunction(e) || ts.isFunctionExpression(e) || types.isCallable(e);
  };

  /**
   * The functions handed to a call of the platform that is not in the tables: it may run them
   * before it returns, so each whose body throws anything makes the call unknown. Only a function
   * written in place or one of the project's own is looked at; a parameter's body is not known.
   */
  const mayRun = (
    args: readonly ts.Expression[],
    text: string,
    at: ts.Node,
    walk: Walk,
  ): Leaf[] => {
    const reason = mayRunReason(text);
    const leaves: Leaf[] = [];
    for (const argument of args) {
      const fn = stripParentheses(argument);
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        const body = both(callback(fn, walk));
        if (body.length > 0) leaves.push({ k: "maybe", reason, text, body, at: spanOf(at) });
        continue;
      }
      const name = calledName(fn);
      const resolved = name === undefined ? undefined : resolve(name);
      if (resolved?.kind !== "function" || resolved.generator) continue;
      const callText = textOf(fn, sourceFile);
      const body: Leaf[] = [
        { k: "call", id: resolved.id, part: "both", text: callText, at: spanOf(fn) },
      ];
      leaves.push({ k: "maybe", reason, text, body, at: spanOf(at) });
    }
    return leaves;
  };

  /**
   * Whether `fetch`'s options surely carry an abort signal: an object literal with a `signal`
   * property, or a value whose type has a `signal` that is neither optional nor `undefined`.
   * `RequestInit`'s own `signal` is optional, so a `RequestInit` passed through adds no
   * `AbortError`: a possible miss rather than an error the caller may never see.
   */
  const signalOf = (argument: ts.Expression | undefined): boolean => {
    if (argument === undefined) return false;
    const init = stripParentheses(argument);
    if (ts.isObjectLiteralExpression(init)) {
      return init.properties.some(
        (p) => !ts.isSpreadAssignment(p) && p.name.getText(sourceFile) === "signal",
      );
    }
    return types.hasDefinedProperty(init, "signal");
  };

  /**
   * A call: what it throws goes to the sink; returns what its promise rejects with. With
   * `mapping`, an array method returns what the promises its callback returned reject with.
   */
  const call = (node: ts.CallExpression, walk: Walk, mapping: boolean): Effect[] => {
    const callee = stripParentheses(node.expression);
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      evaluateArguments(node, walk);
      const effects = callback(callee, walk);
      walk.sink.push(...effects.sync);
      return effects.promise;
    }
    if (callee.kind === ts.SyntaxKind.SuperKeyword) {
      evaluateArguments(node, walk);
      superCall(callee, walk);
      return [];
    }
    const name = calledName(callee);
    const text = textOf(callee, sourceFile);
    if (name === undefined) {
      expression(callee, walk);
      evaluateArguments(node, walk);
      const leaf = unknownLeaf(REASON.dynamic, text, callee);
      walk.sink.push(leaf);
      return [leaf];
    }
    const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : undefined;
    const resolved = resolve(name);
    const args = node.arguments;

    if (resolved?.kind === "platform") {
      const key = resolved.owner === null ? resolved.name : `${resolved.owner}.${resolved.name}`;
      if (resolved.owner === "Promise") {
        const before = receiver === undefined ? [] : flowing(receiver, walk);
        const [first, second] = args;
        switch (resolved.name) {
          case "then":
            return [
              ...(second === undefined ? before : both(callback(second, walk))),
              ...both(callback(first, walk)),
            ];
          case "catch":
            return first === undefined ? before : both(callback(first, walk));
          case "finally":
            return [...before, ...both(callback(first, walk))];
          default:
            evaluateArguments(node, walk);
            return before;
        }
      }
      if (receiver !== undefined) expression(receiver, walk);
      if (resolved.owner === "PromiseConstructor") {
        const [first] = args;
        switch (resolved.name) {
          case "all":
          case "race":
            return elements(first, walk);
          case "allSettled":
            elements(first, walk);
            return [];
          case "any":
            elements(first, walk);
            return classLeaves([ANY_REJECTS], `${text}(…)`, node);
          case "reject":
            return first === undefined ? [] : thrown(first, walk);
          case "resolve":
            return first === undefined ? [] : flowing(first, walk);
          default:
            evaluateArguments(node, walk);
            return [];
        }
      }
      const index = SYNC_CALLBACKS.get(key);
      let mapped: Effect[] = [];
      if (index === undefined) {
        evaluateArguments(node, walk);
        if (!DEFERRED_CALLERS.has(resolved.name)) {
          walk.sink.push(...mayRun(args, text, callee, walk));
        }
      } else {
        for (const [i, argument] of args.entries()) {
          if (i === index && isCallback(argument)) {
            const effects = callback(argument, walk);
            walk.sink.push(...effects.sync);
            mapped = effects.promise;
          } else {
            expression(argument, walk);
          }
        }
      }
      if (key === "fetch") {
        return classLeaves(
          signalOf(args[1]) ? [...FETCH_REJECTS, FETCH_ABORT] : FETCH_REJECTS,
          `${text}(…)`,
          node,
        );
      }
      const throws =
        resolved.owner === null
          ? (THROWING_GLOBALS.get(key) ??
            (key === "Array" && args.length === 1 ? ARRAY_LENGTH : []))
          : (THROWING_MEMBERS.get(key) ?? []);
      walk.sink.push(...classLeaves(throws, `${text}(…)`, node));
      return mapping && MAPPING_METHODS.has(key) ? mapped : [];
    }

    if (receiver !== undefined) expression(receiver, walk);
    if (resolved?.kind === "parameter" && walk.scope.rejectParameters.has(resolved.node)) {
      evaluateArguments(node, walk);
      const [reason] = args;
      walk.sink.push(
        ...(reason === undefined
          ? [unknownLeaf(REASON.thrownValue, text, node)]
          : thrown(reason, { ...walk, sink: [] })),
      );
      return [];
    }
    evaluateArguments(node, walk);
    if (resolved?.kind === "function") {
      if (resolved.generator) return [];
      const at = spanOf(callee);
      if (!resolved.async) {
        walk.sink.push({ k: "call", id: resolved.id, part: "throws", text, at });
      }
      return [{ k: "call", id: resolved.id, part: "rejects", text, at }];
    }
    if (resolved?.kind === "class") return [];
    if (resolved?.kind === "package") {
      const leaves = packageLeaves(resolved, text, callee);
      if (leaves === undefined) return [];
      walk.sink.push(...leaves.sync);
      return leaves.promise;
    }
    const leaf = unresolvedLeaf(resolved, text, callee);
    if (leaf === undefined) return [];
    walk.sink.push(leaf);
    return [leaf];
  };

  /** `super(…)`: what the constructor of the class this one extends throws. */
  const superCall = (callee: ts.Expression, walk: Walk): void => {
    const owner = ts.findAncestor(callee, ts.isClassLike);
    const base =
      owner === undefined
        ? undefined
        : owner.heritageClauses
            ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
            ?.types.at(0)?.expression;
    const name = base === undefined ? undefined : calledName(stripParentheses(base));
    if (base === undefined || name === undefined) return;
    const resolved = resolve(name);
    const text = `super (${textOf(base, sourceFile)})`;
    if (resolved?.kind === "class") {
      if (
        resolved.node.members.some((m) => ts.isConstructorDeclaration(m) && m.body !== undefined)
      ) {
        walk.sink.push({ k: "call", id: resolved.id, part: "throws", text, at: spanOf(callee) });
      }
      return;
    }
    const leaf = unresolvedLeaf(resolved, text, callee);
    if (leaf !== undefined) walk.sink.push(leaf);
  };

  /** `new X(…)`: what the constructor throws goes to the sink; returns a `new Promise`'s rejections. */
  const construct = (node: ts.NewExpression, walk: Walk): Effect[] => {
    const callee = stripParentheses(node.expression);
    const name = calledName(callee);
    const text = textOf(callee, sourceFile);
    const args = node.arguments ?? [];
    if (name === undefined) {
      expression(callee, walk);
      evaluateArguments(node, walk);
      walk.sink.push(unknownLeaf(REASON.dynamic, `new ${text}`, callee));
      return [];
    }
    if (ts.isPropertyAccessExpression(callee)) expression(callee.expression, walk);
    const resolved = resolve(name);
    if (resolved?.kind === "platform" && resolved.owner === null && resolved.name === "Promise") {
      const [executor] = args;
      const fn = executor === undefined ? undefined : stripParentheses(executor);
      if (fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        return both(callback(fn, walk, 1));
      }
      evaluateArguments(node, walk);
      return executor === undefined ? [] : [unknownLeaf(REASON.callback, text, executor)];
    }
    evaluateArguments(node, walk);
    switch (resolved?.kind) {
      case "platform": {
        const throws =
          resolved.owner !== null
            ? []
            : (THROWING_CONSTRUCTORS.get(resolved.name) ??
              (resolved.name === "Array" && args.length === 1 ? ARRAY_LENGTH : []));
        walk.sink.push(...classLeaves(throws, `new ${text}(…)`, node));
        if (!DEFERRED_CALLERS.has(resolved.name)) {
          walk.sink.push(...mayRun(args, `new ${text}`, callee, walk));
        }
        return [];
      }
      case "class": {
        const constructor = resolved.node.members.find(
          (member): member is ts.ConstructorDeclaration =>
            ts.isConstructorDeclaration(member) && member.body !== undefined,
        );
        if (constructor !== undefined) {
          walk.sink.push({
            k: "call",
            id: resolved.id,
            part: "throws",
            text: `new ${text}`,
            at: spanOf(callee),
          });
        }
        return [];
      }
      case "function":
        return [];
      case "package":
        walk.sink.push(...(packageLeaves(resolved, `new ${text}`, callee)?.sync ?? []));
        return [];
      case undefined:
      case "parameter":
      case "no-body":
      case "other": {
        const leaf = unresolvedLeaf(resolved, `new ${text}`, callee);
        if (leaf !== undefined) walk.sink.push(leaf);
        return [];
      }
      default: {
        const unreachable: never = resolved;
        return unreachable;
      }
    }
  };

  /** The variable of the catch clause that `name` refers to, as its start offset. */
  const caughtVariable = (name: ts.Identifier): number | undefined => {
    const symbol = types.symbolAt(name);
    const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
    const node = declaration?.node;
    return node !== undefined && ts.isVariableDeclaration(node) && ts.isCatchClause(node.parent)
      ? node.getStart(sourceFile)
      : undefined;
  };

  /** What `throw <value>` (or `reject(value)`) throws; its own calls go to the sink. */
  const thrown = (value: ts.Expression, walk: Walk): Effect[] => {
    const e = stripParentheses(value);
    if (ts.isNewExpression(e) || ts.isCallExpression(e)) {
      const id = classRef(stripParentheses(e.expression));
      if (id !== undefined) {
        evaluateArguments(e, walk);
        return [{ k: "class", id, text: null, at: spanOf(e) }];
      }
      if (ts.isCallExpression(e)) {
        call(e, walk, false);
        return [unknownLeaf(REASON.madeError, textOf(e.expression, sourceFile), e)];
      }
      construct(e, walk);
      return [unknownLeaf(REASON.thrownValue, `new ${textOf(e.expression, sourceFile)}`, e)];
    }
    if (ts.isIdentifier(e)) {
      const of = caughtVariable(e);
      if (of !== undefined) return [{ k: "rethrow", of, maybe: walk.conditional, at: spanOf(e) }];
    }
    expression(e, walk);
    return [unknownLeaf(REASON.thrownValue, `throw ${textOf(e, sourceFile)}`, e)];
  };

  // ---- statements -----------------------------------------------------------------------------

  const statements = (nodes: readonly ts.Statement[], walk: Walk): void => {
    for (const node of nodes) statement(node, walk);
  };

  const region = (nodes: readonly ts.Statement[], scope: Scope): Effect[] => {
    const sink: Effect[] = [];
    statements(nodes, { scope, sink, conditional: false });
    return sink;
  };

  const statement = (node: ts.Statement, walk: Walk): void => {
    if (isFunctionBoundary(node)) return;
    if (ts.isBlock(node)) {
      statements(node.statements, walk);
    } else if (ts.isTryStatement(node)) {
      walk.sink.push(tryOf(node, walk.scope));
    } else if (ts.isThrowStatement(node)) {
      walk.sink.push(...thrown(node.expression, walk));
    } else if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined) {
        walk.scope.returns.push(...flowing(node.expression, walk));
      }
    } else if (ts.isExpressionStatement(node)) {
      expression(node.expression, walk);
    } else if (ts.isVariableStatement(node)) {
      const constant = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of node.declarationList.declarations) {
        if (declaration.initializer === undefined) continue;
        if (constant && ts.isIdentifier(declaration.name)) {
          held.set(declaration, flowing(declaration.initializer, walk));
        } else {
          expression(declaration.initializer, walk);
        }
      }
    } else if (ts.isIfStatement(node)) {
      expression(node.expression, walk);
      const branch = { ...walk, conditional: true };
      statement(node.thenStatement, branch);
      if (node.elseStatement !== undefined) statement(node.elseStatement, branch);
    } else {
      const inner = { ...walk, conditional: true };
      ts.forEachChild(node, (child) => {
        visit(child, inner);
      });
    }
  };

  const tryOf = (node: ts.TryStatement, scope: Scope): Try => ({
    k: "try",
    at: [node.getStart(sourceFile), node.tryBlock.getStart(sourceFile)],
    body: region(node.tryBlock.statements, scope),
    handler: node.catchClause === undefined ? null : handlerOf(node.catchClause, scope),
    fin: node.finallyBlock === undefined ? [] : region(node.finallyBlock.statements, scope),
  });

  /** The classes an `if` test or `case` names with `instanceof` on the caught variable. */
  const testOf = (
    condition: ts.Expression,
    variable: string,
  ): { classes: string[]; exact: boolean; tested: boolean } => {
    const e = stripParentheses(condition);
    if (ts.isBinaryExpression(e)) {
      const operator = e.operatorToken.kind;
      if (operator === ts.SyntaxKind.InstanceOfKeyword) {
        const subject = stripParentheses(e.left);
        if (ts.isIdentifier(subject) && subject.text === variable) {
          const id = classRef(stripParentheses(e.right));
          return { classes: id === undefined ? [] : [id], exact: id !== undefined, tested: true };
        }
        return { classes: [], exact: false, tested: false };
      }
      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        const left = testOf(e.left, variable);
        const right = testOf(e.right, variable);
        return {
          classes: [...left.classes, ...right.classes],
          exact: operator === ts.SyntaxKind.BarBarToken && left.exact && right.exact,
          tested: left.tested || right.tested,
        };
      }
    }
    return { classes: [], exact: false, tested: false };
  };

  const exits = (node: ts.Node | undefined): boolean => {
    if (node === undefined) return false;
    if (ts.isBlock(node)) return exits(node.statements.at(-1));
    return ts.isReturnStatement(node) || ts.isThrowStatement(node);
  };

  const throwsIn = (nodes: readonly ts.Node[]): boolean =>
    nodes.some((node) => {
      let found = false;
      scanRunning(node, (inner) => {
        if (ts.isThrowStatement(inner)) found = true;
      });
      return found;
    });

  /**
   * Whether the statements use the caught variable declared at `of` (pass it on, log it, store
   * it, read a property), nested functions included; an `instanceof` test of it is no use.
   */
  const uses = (nodes: readonly ts.Node[], name: string, of: number): boolean => {
    const visit = (node: ts.Node): boolean => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        ts.isIdentifier(stripParentheses(node.left))
      ) {
        return visit(node.right);
      }
      if (ts.isIdentifier(node)) return node.text === name && caughtVariable(node) === of;
      return ts.forEachChild(node, (child) => (visit(child) ? true : undefined)) === true;
    };
    return nodes.some(visit);
  };

  const asStatements = (node: ts.Statement): readonly ts.Statement[] =>
    ts.isBlock(node) ? node.statements : [node];

  /** Statements and expressions (a branch of a `?:` or the right side of a `&&`) alike. */
  type Part = ts.Statement | ts.Expression;

  type Link = { classes: string[]; exact: boolean; statements: readonly Part[] };

  const regionOfParts = (nodes: readonly Part[], scope: Scope): Effect[] => {
    const sink: Effect[] = [];
    const walk: Walk = { scope, sink, conditional: false };
    for (const node of nodes) {
      if (ts.isExpression(node)) expression(node, walk);
      else statement(node, walk);
    }
    return sink;
  };

  /** A test of the caught variable, as `!(e instanceof A)`: the classes it excludes. */
  const negatedTest = (
    condition: ts.Expression,
    variable: string,
  ): { classes: string[]; exact: boolean } | undefined => {
    const e = stripParentheses(condition);
    if (!ts.isPrefixUnaryExpression(e) || e.operator !== ts.SyntaxKind.ExclamationToken) {
      return undefined;
    }
    const test = testOf(e.operand, variable);
    return test.tested ? test : undefined;
  };

  /**
   * An `if` / `else if` chain or a `switch (true)` that tests the caught variable with
   * `instanceof` at least once: its links and its final `else` or `default`.
   */
  const dispatchOf = (
    node: ts.Statement,
    variable: string,
    following: readonly ts.Statement[],
  ):
    | {
        links: Link[];
        otherwise: readonly Part[] | undefined;
        kind: "if" | "switch";
        /** A guard (`if (!(e instanceof A)) throw e;`): the statements after it are its branch. */
        guard: boolean;
      }
    | undefined => {
    const links: Link[] = [];
    let otherwise: readonly Part[] | undefined;
    let tested = false;
    let guard = false;
    const negated = ts.isIfStatement(node) ? negatedTest(node.expression, variable) : undefined;
    if (ts.isIfStatement(node) && negated !== undefined) {
      // Only a guard that leaves the catch: what follows it runs for the named classes alone.
      if (node.elseStatement !== undefined || !exits(node.thenStatement)) return undefined;
      tested = true;
      guard = true;
      links.push({ ...negated, statements: following });
      otherwise = asStatements(node.thenStatement);
    } else if (ts.isIfStatement(node)) {
      let link: ts.IfStatement | undefined = node;
      while (link !== undefined) {
        const test = testOf(link.expression, variable);
        tested ||= test.tested;
        links.push({ ...test, statements: asStatements(link.thenStatement) });
        const rest: ts.Statement | undefined = link.elseStatement;
        link = undefined;
        if (rest !== undefined && ts.isIfStatement(rest)) link = rest;
        else if (rest !== undefined) otherwise = asStatements(rest);
      }
    } else if (
      ts.isSwitchStatement(node) &&
      stripParentheses(node.expression).kind === ts.SyntaxKind.TrueKeyword
    ) {
      // Cases with no statements fall through to the next: their classes join it.
      let pending: { classes: string[]; exact: boolean } | undefined;
      for (const clause of node.caseBlock.clauses) {
        if (ts.isDefaultClause(clause)) {
          otherwise = clause.statements;
          continue;
        }
        const test = testOf(clause.expression, variable);
        tested ||= test.tested;
        const joined = {
          classes: [...(pending?.classes ?? []), ...test.classes],
          exact: (pending?.exact ?? true) && test.exact,
        };
        if (clause.statements.length === 0) {
          pending = joined;
          continue;
        }
        pending = undefined;
        links.push({ ...joined, statements: clause.statements });
      }
    } else if (ts.isReturnStatement(node) || ts.isExpressionStatement(node)) {
      const value = node.expression === undefined ? undefined : stripParentheses(node.expression);
      let cond: ts.Expression | undefined = value;
      while (cond !== undefined && ts.isConditionalExpression(cond)) {
        const test = testOf(cond.condition, variable);
        tested ||= test.tested;
        links.push({ ...test, statements: [cond.whenTrue] });
        const rest: ts.Expression = stripParentheses(cond.whenFalse);
        if (ts.isConditionalExpression(rest)) {
          cond = rest;
        } else {
          otherwise = [rest];
          cond = undefined;
        }
      }
      if (
        links.length === 0 &&
        value !== undefined &&
        ts.isBinaryExpression(value) &&
        value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        const test = testOf(value.left, variable);
        tested = test.tested;
        links.push({ ...test, statements: [value.right] });
      }
    }
    return tested
      ? { links, otherwise, kind: ts.isSwitchStatement(node) ? "switch" : "if", guard }
      : undefined;
  };

  const handlerOf = (clause: ts.CatchClause, scope: Scope): Handler => {
    const declaration = clause.variableDeclaration;
    const variable =
      declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : null;
    const of = declaration === undefined ? -1 : declaration.getStart(sourceFile);
    const at: Span = [clause.getStart(sourceFile), clause.getStart(sourceFile) + "catch".length];
    const body = clause.block.statements;
    const block: Span = [clause.block.getStart(sourceFile), clause.block.getEnd()];
    const plain = (): Handler => ({
      at,
      block,
      of,
      variable,
      dispatch: "if",
      pre: [],
      branches: [],
      otherwise: null,
      otherwiseExits: false,
      after: region(body, scope),
      restThrows: throwsIn(body),
      restUsed: false,
    });
    if (variable === null) return plain();

    for (const [index, node] of body.entries()) {
      const dispatch = dispatchOf(node, variable, body.slice(index + 1));
      if (dispatch === undefined) continue;
      const branches: Branch[] = dispatch.links.map((link) => ({
        classes: link.classes,
        exact: link.exact,
        body: regionOfParts(link.statements, scope),
        exits: exits(link.statements.at(-1)),
      }));
      const otherwise = dispatch.otherwise;
      const otherwiseExits = exits(otherwise?.at(-1));
      const following = dispatch.guard ? [] : body.slice(index + 1);
      return {
        at,
        block,
        of,
        variable,
        dispatch: dispatch.kind,
        pre: region(body.slice(0, index), scope),
        branches,
        otherwise: otherwise === undefined ? null : regionOfParts(otherwise, scope),
        otherwiseExits,
        after: region(following, scope),
        restThrows:
          (otherwise !== undefined && throwsIn(otherwise)) ||
          ((otherwise === undefined || !otherwiseExits) && throwsIn(following)),
        restUsed:
          (otherwise !== undefined && uses(otherwise, variable, of)) ||
          ((otherwise === undefined || !otherwiseExits) && uses(following, variable, of)),
      };
    }
    return plain();
  };

  // ---- @throws --------------------------------------------------------------------------------

  const docOf = (...nodes: readonly ts.Node[]): Doc | null => {
    const tags = new Set(nodes.flatMap((node) => ts.getJSDocTags(node)));
    const entries: DocEntry[] = [];
    const untyped: Span[] = [];
    let found = false;
    const add = (type: ts.TypeNode): void => {
      if (ts.isParenthesizedTypeNode(type)) {
        add(type.type);
      } else if (ts.isUnionTypeNode(type)) {
        for (const member of type.types) add(member);
      } else if (type.kind !== ts.SyntaxKind.NeverKeyword) {
        const id = ts.isTypeReferenceNode(type) ? classRef(type.typeName) : undefined;
        entries.push({
          id: id ?? null,
          name: shorten(oneLine(type.getText(sourceFile)), TEXT_MAX),
          at: spanOf(type),
        });
      }
    };
    for (const tag of tags) {
      if (!ts.isJSDocThrowsTag(tag)) continue;
      found = true;
      const type = tag.typeExpression?.type;
      if (type === undefined) untyped.push(spanOf(tag));
      else add(type);
    }
    return found ? { entries, untyped } : null;
  };

  // ---- functions ------------------------------------------------------------------------------

  const functions: FunctionFact[] = [];
  /** Function expressions that are a named declaration's value, summarized under its name. */
  const named = new Set<ts.Node>();

  const factOf = (
    name: ts.Node | undefined,
    declaration: ts.Node,
    fn: ts.SignatureDeclaration & { readonly body?: ts.ConciseBody | undefined },
    async: boolean,
  ): void => {
    // A function without a name (a handler, a callback) has no id: nothing calls it by name,
    // but its catches are checked (`ANONYMOUS`).
    const symbol = name === undefined ? { id: ANONYMOUS, name: ANONYMOUS } : types.symbolAt(name);
    const body = fn.body;
    if (symbol === undefined || body === undefined) return;
    const scope = newScope(async);
    const sink: Effect[] = [];
    const walk: Walk = { scope, sink, conditional: false };
    if (ts.isBlock(body)) statement(body, walk);
    else scope.returns.push(...flowing(body, walk));
    const doc = name === undefined ? null : docOf(declaration, fn);
    functions.push({
      id: symbol.id,
      name: symbol.name,
      at: spanOf(name ?? fn),
      async,
      // Asked only when a `@throws` needs it: that is the one place it changes the result.
      promise: async || (doc !== null && types.returnsPromiseLike(fn)),
      doc,
      local:
        (ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration)) &&
        ts.findAncestor(declaration.parent, ts.isFunctionLike) !== undefined,
      body: sink,
      returns: scope.returns,
    });
  };

  /**
   * A function declared without a body (`declare function`, a `.d.ts`, overloads with no
   * implementation) that has `@throws`: a fact with no code and the tags of all its signatures,
   * made once, at the first of them.
   */
  const bodylessFact = (
    name: ts.Node,
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
  ): void => {
    const symbol = types.symbolAt(name);
    const doc = docOf(...signaturesOf(node));
    if (symbol === undefined || doc === null) return;
    functions.push({
      id: symbol.id,
      name: symbol.name,
      at: spanOf(name),
      async: false,
      promise: types.returnsPromiseLike(node),
      doc,
      local: false,
      body: [],
      returns: [],
    });
  };

  const find = (node: ts.Node): void => {
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.asteriskToken === undefined &&
      !named.has(node)
    ) {
      factOf(undefined, node, node, isAsync(node));
    } else if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      if (node.name !== undefined && node.body !== undefined && node.asteriskToken === undefined) {
        factOf(node.name, node, node, isAsync(node));
      } else if (
        node.name !== undefined &&
        node.body === undefined &&
        node.asteriskToken === undefined &&
        !hasModifier(node, ts.SyntaxKind.AbstractKeyword) &&
        implementationOf(node) === undefined &&
        hasThrowsTag(node) &&
        signaturesOf(node)[0] === node
      ) {
        bodylessFact(node.name, node);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.name)
    ) {
      const assigned = assignedFunction(node);
      // Named only when the property resolves; otherwise it stays a function without a name.
      if (
        assigned !== undefined &&
        assigned.asteriskToken === undefined &&
        types.symbolAt(node.left.name) !== undefined
      ) {
        named.add(assigned);
        factOf(node.left.name, node, assigned, isAsync(assigned));
      }
    } else if (ts.isConstructorDeclaration(node)) {
      const owner = node.parent;
      if (owner.name !== undefined && node.body !== undefined) {
        factOf(owner.name, node, node, false);
      }
    } else {
      const initializer = functionInitializer(node);
      if (
        initializer !== undefined &&
        (ts.isVariableDeclaration(node) ||
          ts.isPropertyAssignment(node) ||
          ts.isPropertyDeclaration(node)) &&
        (ts.isIdentifier(node.name) || ts.isPrivateIdentifier(node.name)) &&
        !(ts.isFunctionExpression(initializer) && initializer.asteriskToken !== undefined)
      ) {
        named.add(initializer);
        factOf(node.name, node, initializer, isAsync(initializer));
      }
    }
    ts.forEachChild(node, find);
  };
  // The top level first: a `const` promise made there is known to the functions that use it.
  const module = region(sourceFile.statements, newScope(false));
  ts.forEachChild(sourceFile, find);

  return {
    classes: [...classes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    functions,
    module,
  };
}

/** What a name resolves to; undefined when it resolves to nothing. */
function resolveWith(types: TypeQueries, name: ts.Node): Resolved | undefined {
  const symbol = types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (symbol === undefined || declaration === undefined) return undefined;
  const node = declaration.node;
  if (!types.isOwnFile(declaration.file)) {
    if (isPlatform(node, declaration.file)) {
      const parent = node.parent;
      const owner =
        (ts.isMethodSignature(node) || ts.isPropertySignature(node)) &&
        ts.isInterfaceDeclaration(parent)
          ? parent.name.text
          : null;
      return { kind: "platform", owner, name: symbol.name };
    }
    return {
      kind: "package",
      name: ambientModuleName(node) ?? packageNameOf(types, declaration.file),
      id: symbol.id,
      node,
      file: declaration.file,
    };
  }
  return ownKind(node, symbol.id);
}
