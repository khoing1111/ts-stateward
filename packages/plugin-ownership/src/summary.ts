import ts from "@stateward/core/typescript";
import type { FileContext, TypeQueries } from "@stateward/core";
import { capitalized, shorten } from "./text.js";

/**
 * One change this file makes to a piece of shared state that another file declares: where the
 * state is declared, where it is changed here, and the call of an owner's function that would
 * make the same change (the example a message shows).
 */
export type Write = {
  /** The declaration's qualified id, "<file relative to the project>#<name>". */
  id: string;
  name: string;
  declFile: string;
  declStart: number;
  declEnd: number;
  start: number;
  end: number;
  example: string;
};

/** Shared state handed to a function as argument `index`; a change only if that function writes it. */
export type Pass = Write & {
  /** The qualified id of the function. */
  callee: string;
  index: number;
};

/**
 * What a function's body does to one parameter: a change of its own (`write`, where) and the
 * functions it passes the parameter on to (`forwards`, each a function id and a parameter index).
 */
export type ParamSummary = {
  id: string;
  /** The function's name, for the note at the write. */
  fn: string;
  index: number;
  write: { start: number; end: number } | null;
  forwards: { id: string; index: number }[];
};

export type FileSummary = { writes: Write[]; passes: Pass[]; params: ParamSummary[] };

/** Whether a file sets state up for a test: `*.test.*`, `*.spec.*` or a file under `__tests__`. */
export function isTestFile(file: string): boolean {
  return /\.(?:test|spec)\.[^/]+$/.test(file) || /(?:^|\/)__tests__\//.test(file);
}

const ARRAY_METHODS: ReadonlySet<string> = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);
const MAP_METHODS: ReadonlySet<string> = new Set(["set", "delete", "clear"]);
const SET_METHODS: ReadonlySet<string> = new Set(["add", "delete", "clear"]);

type CollectionKind = "array" | "map" | "set";

/**
 * Which built-in collection a type is, from the way TypeScript prints it. A type alias of a
 * collection is printed by its own name and is not recognised.
 */
function collectionKind(typeText: string): CollectionKind | undefined {
  const text = typeText.replace(/\s*\|\s*(?:undefined|null)\b/g, "").trim();
  if (/^readonly\b/.test(text)) return undefined;
  if (text.endsWith("[]") || text.startsWith("Array<")) return "array";
  if (text.startsWith("[") && text.endsWith("]")) return "array";
  if (/^(?:Weak)?Map</.test(text)) return "map";
  if (/^(?:Weak)?Set</.test(text)) return "set";
  return undefined;
}

function changesCollection(kind: CollectionKind | undefined, method: string): boolean {
  switch (kind) {
    case "array":
      return ARRAY_METHODS.has(method);
    case "map":
      return MAP_METHODS.has(method);
    case "set":
      return SET_METHODS.has(method);
    case undefined:
      return false;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function isWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The global `Map`, `Set`, `WeakMap` or `WeakSet`: declared in a TypeScript library, not the project. */
function isGlobalCollection(callee: ts.Expression, types: TypeQueries): boolean {
  if (!ts.isIdentifier(callee)) return false;
  if (!["Map", "Set", "WeakMap", "WeakSet"].includes(callee.text)) return false;
  const symbol = types.symbolAt(callee);
  const declaration = symbol && types.declarationOf(symbol);
  return declaration !== undefined && !types.isOwnFile(declaration.file);
}

/** `new X()` where `X` is a class of the project. */
function isProjectClass(callee: ts.Expression, types: TypeQueries): boolean {
  const symbol = types.symbolAt(ts.isPropertyAccessExpression(callee) ? callee.name : callee);
  const declaration = symbol && types.declarationOf(symbol);
  return (
    declaration !== undefined &&
    types.isOwnFile(declaration.file) &&
    (ts.isClassDeclaration(declaration.node) || ts.isClassExpression(declaration.node))
  );
}

/**
 * Shared state, judged from its declaration: a module-level `let` of any type, or a `const` built
 * from an object literal, an array literal, a `Map`, `Set`, `WeakMap` or `WeakSet`, or an
 * instance of a class of the project.
 */
function isSharedState(declaration: ts.VariableDeclaration, types: TypeQueries): boolean {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent)) return false;
  if (!ts.isSourceFile(list.parent.parent)) return false;
  if ((list.flags & ts.NodeFlags.Let) !== 0) return true;
  if ((list.flags & ts.NodeFlags.Const) === 0 || (list.flags & ts.NodeFlags.Using) !== 0) {
    return false;
  }
  if (declaration.initializer === undefined) return false;
  const initializer = unwrapped(declaration.initializer);
  if (ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)) {
    return true;
  }
  return (
    ts.isNewExpression(initializer) &&
    (isGlobalCollection(initializer.expression, types) ||
      isProjectClass(initializer.expression, types))
  );
}

/** `a = v`, `a += v`, `a++`, `delete a`, `[a] = list`, `({ k: a } = obj)`, `for (a of list)`. */
function isWriteTarget(expression: ts.Expression): boolean {
  let current: ts.Node = expression;
  for (;;) {
    const parent: ts.Node = current.parent;
    const inPattern =
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current);
    if (!inPattern) break;
    current = parent;
  }
  const parent = current.parent;
  if (ts.isBinaryExpression(parent)) {
    const { kind } = parent.operatorToken;
    return (
      parent.left === current &&
      kind >= ts.SyntaxKind.FirstAssignment &&
      kind <= ts.SyntaxKind.LastAssignment
    );
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  if (ts.isDeleteExpression(parent)) return true;
  return (
    (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === current
  );
}

/** What a change is called in the example: the last name along the path, or the variable's own. */
function baseName(expression: ts.Expression, fallback: string): string {
  const current = unwrapped(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const key = current.argumentExpression;
    if (ts.isStringLiteral(key) && /^[A-Za-z_$][\w$]*$/.test(key.text)) return key.text;
    return baseName(current.expression, fallback);
  }
  return fallback;
}

/** The key of `a[key]` when it is not a literal: the example passes it on. */
function dynamicKey(expression: ts.Expression, sourceFile: ts.SourceFile): string | undefined {
  const current = unwrapped(expression);
  if (!ts.isElementAccessExpression(current)) return undefined;
  const key = current.argumentExpression;
  return ts.isStringLiteral(key) || ts.isNumericLiteral(key) ? undefined : key.getText(sourceFile);
}

function call(name: string, args: readonly (string | undefined)[]): string {
  const given = args.filter((arg): arg is string => arg !== undefined);
  return `${name}(${shorten(given.join(", "), 30)})`;
}

const COMPOUND_VERBS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.EqualsToken, "set"],
  [ts.SyntaxKind.PlusEqualsToken, "add"],
  [ts.SyntaxKind.MinusEqualsToken, "subtract"],
]);

/** The owner's function that would make an assignment, increment or `delete` of `target`. */
function assignmentExample(target: ts.Expression, root: string, sourceFile: ts.SourceFile): string {
  const prop = capitalized(baseName(target, root));
  const key = dynamicKey(target, sourceFile);
  const parent = target.parent;
  if (ts.isBinaryExpression(parent) && parent.left === target) {
    const verb = COMPOUND_VERBS.get(parent.operatorToken.kind) ?? "update";
    return call(`${verb}${prop}`, [key, parent.right.getText(sourceFile)]);
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    const verb = parent.operator === ts.SyntaxKind.PlusPlusToken ? "increment" : "decrement";
    return call(`${verb}${prop}`, [key]);
  }
  if (ts.isDeleteExpression(parent)) {
    return key === undefined ? call(`clear${prop}`, []) : call(`remove${prop}`, [key]);
  }
  return call(`update${prop}`, ["value"]);
}

const METHOD_VERBS = new Map<string, string>([
  ["push", "add"],
  ["unshift", "add"],
  ["pop", "removeLast"],
  ["shift", "removeFirst"],
  ["splice", "remove"],
  ["set", "set"],
  ["add", "add"],
  ["delete", "remove"],
  ["clear", "clear"],
]);

function methodExample(
  receiver: ts.Expression,
  method: string,
  args: readonly ts.Expression[],
  root: string,
  sourceFile: ts.SourceFile,
): string {
  const verb = METHOD_VERBS.get(method) ?? method;
  const prop = capitalized(baseName(receiver, root));
  const lastWord = ["pop", "shift", "clear"].includes(method);
  return call(`${verb}${prop}`, lastWord ? [] : args.map((arg) => arg.getText(sourceFile)));
}

/** What the code does where a reference's chain ends. */
type Change =
  | { kind: "write"; node: ts.Node; example: string }
  /** Hands it to a call: a write only if the function writes that parameter (found in `check`). */
  | { kind: "pass"; node: ts.Node; callee: ts.Expression; index: number; example: string };

/** The identifier of a callee, for naming: `register`, or `store.register` is `register`. */
function calleeName(callee: ts.Expression): string | undefined {
  const current = unwrapped(callee);
  if (ts.isIdentifier(current)) return current.text;
  return ts.isPropertyAccessExpression(current) ? current.name.text : undefined;
}

function isObjectAssign(callee: ts.Expression, types: TypeQueries): boolean {
  const current = unwrapped(callee);
  if (!ts.isPropertyAccessExpression(current) || current.name.text !== "assign") return false;
  const target = current.expression;
  if (!ts.isIdentifier(target) || target.text !== "Object") return false;
  const symbol = types.symbolAt(target);
  const declaration = symbol && types.declarationOf(symbol);
  return declaration !== undefined && !types.isOwnFile(declaration.file);
}

/** The qualified id of the function a call goes to; undefined when it cannot be found. */
function calleeId(callee: ts.Expression, types: TypeQueries): string | undefined {
  const current = unwrapped(callee);
  const named = ts.isPropertyAccessExpression(current) ? current.name : current;
  return types.symbolAt(named)?.id;
}

/**
 * Follows the reference up its property and element accesses (`settings.user.name`) and says what
 * the code does where the chain ends: assigns to it, calls a mutating method of a collection on
 * it, hands it to `Object.assign` or to a project function that may change what it gets.
 */
function followChain(root: ts.Expression, rootName: string, ctx: FileContext): Change | undefined {
  const { types, sourceFile } = ctx;
  const steps: ts.Expression[] = [root];
  let current: ts.Expression = root;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) {
      if (types.typeTextOf(parent) === "any") return undefined;
    }
    if (
      isWrapper(parent) ||
      (ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
      (ts.isElementAccessExpression(parent) && parent.expression === current)
    ) {
      if (
        ts.isPropertyAccessExpression(parent) &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      ) {
        const method = parent.name.text;
        const kind = collectionKind(types.typeTextOf(current));
        if (!changesCollection(kind, method)) return undefined;
        if (steps.slice(0, -1).some((step) => types.typeTextOf(step) === "any")) return undefined;
        return {
          kind: "write",
          node: parent,
          example: methodExample(current, method, parent.parent.arguments, rootName, sourceFile),
        };
      }
      if (!ts.isExpression(parent)) return undefined;
      current = parent;
      steps.push(current);
      continue;
    }
    break;
  }
  const parent = current.parent;
  if (steps.slice(0, -1).some((step) => types.typeTextOf(step) === "any")) return undefined;
  if (isWriteTarget(current)) {
    return {
      kind: "write",
      node: current,
      example: assignmentExample(current, rootName, sourceFile),
    };
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments) {
    const index = parent.arguments.indexOf(current);
    if (index < 0) return undefined;
    if (ts.isCallExpression(parent) && index === 0 && isObjectAssign(parent.expression, types)) {
      const second = parent.arguments[1];
      return {
        kind: "write",
        node: current,
        example: call(`update${capitalized(baseName(current, rootName))}`, [
          second?.getText(sourceFile),
        ]),
      };
    }
    if (!ts.isCallExpression(parent) || parent.arguments.slice(0, index).some(ts.isSpreadElement)) {
      return undefined;
    }
    const name = calleeName(parent.expression) ?? "update";
    return {
      kind: "pass",
      node: current,
      callee: parent.expression,
      index,
      example: call(`${name}${capitalized(rootName)}`, []),
    };
  }
  return undefined;
}

type Imports = { named: ReadonlySet<string>; namespaces: ReadonlySet<string> };

/** The local names the file's value imports are bound to. */
function importsOf(sourceFile: ts.SourceFile): Imports {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (clause.name !== undefined) named.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) named.add(element.name.text);
      }
  }
  return { named, namespaces };
}

/** The declaration a name imported from another file of the project comes from, when it is shared state. */
function sharedStateBehind(
  name: ts.Identifier,
  ctx: FileContext,
): { declaration: ts.VariableDeclaration; id: string; file: string } | undefined {
  const { types } = ctx;
  const symbol = types.symbolAt(name);
  const found = symbol && types.declarationOf(symbol);
  if (symbol === undefined || found === undefined) return undefined;
  // A package is not shared state of this project, nor is a file the checker does not own.
  if (found.file === ctx.file || !types.isOwnFile(found.file) || isTestFile(found.file)) {
    return undefined;
  }
  const declaration = found.node;
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) {
    return undefined;
  }
  return isSharedState(declaration, types)
    ? { declaration, id: symbol.id, file: found.file }
    : undefined;
}

type Found = { writes: Write[]; passes: Pass[]; params: ParamSummary[] };

function visit(node: ts.Node, imports: Imports, found: Found, ctx: FileContext): void {
  if (ts.isImportDeclaration(node)) return;
  if (ts.isIdentifier(node)) {
    const reference = referenceAt(node, imports);
    if (reference !== undefined) collect(node, reference, found, ctx);
    return;
  }
  if (ts.isFunctionLike(node) && "body" in node) summarizeParams(node, found.params, ctx);
  ts.forEachChild(node, (child) => {
    visit(child, imports, found, ctx);
  });
}

/** The name a function is declared with: `function f`, a method `f`, or `const f = () => …`. */
function functionName(fn: ts.SignatureDeclaration): ts.Identifier | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name !== undefined) {
    return ts.isIdentifier(fn.name) ? fn.name : undefined;
  }
  const parent = fn.parent;
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === fn &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name;
  }
  return undefined;
}

/** The identifiers in `body` that mean the parameter `paramId` (not a property of that name). */
function referencesTo(
  body: ts.Node,
  name: string,
  paramId: string,
  types: TypeQueries,
): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      const member = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!member && types.symbolAt(node)?.id === paramId) found.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return found;
}

/** What the body of a function does to each of its parameters, kept for the ones it changes. */
function summarizeParams(
  fn: ts.SignatureDeclaration,
  params: ParamSummary[],
  ctx: FileContext,
): void {
  const name = functionName(fn);
  const body = "body" in fn ? fn.body : undefined;
  if (name === undefined || body === undefined) return;
  const { types, sourceFile } = ctx;
  const fnId = types.symbolAt(name)?.id;
  if (fnId === undefined) return;
  fn.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name) || parameter.dotDotDotToken !== undefined) return;
    const paramId = types.symbolAt(parameter.name)?.id;
    if (paramId === undefined) return;
    let write: ParamSummary["write"] = null;
    const forwards: ParamSummary["forwards"] = [];
    for (const reference of referencesTo(body, parameter.name.text, paramId, types)) {
      const change = followChain(reference, parameter.name.text, ctx);
      if (change?.kind === "write") {
        const place = { start: change.node.getStart(sourceFile), end: change.node.end };
        if (write === null || place.start < write.start) write = place;
      } else if (change?.kind === "pass") {
        const id = calleeId(change.callee, types);
        if (id !== undefined && !forwards.some((f) => f.id === id && f.index === change.index)) {
          forwards.push({ id, index: change.index });
        }
      }
    }
    if (write === null && forwards.length === 0) return;
    forwards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index));
    params.push({ id: fnId, fn: name.text, index, write, forwards });
  });
}

/** The expression that names an imported variable at this identifier, if the identifier does. */
function referenceAt(identifier: ts.Identifier, imports: Imports): ts.Expression | undefined {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    // `ns.settings` reaches the variable through a namespace import; `a.settings` does not.
    return ts.isIdentifier(parent.expression) && imports.namespaces.has(parent.expression.text)
      ? parent
      : undefined;
  }
  if (!imports.named.has(identifier.text)) return undefined;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isBindingElement(parent)
  ) {
    return undefined;
  }
  return identifier;
}

function collect(
  identifier: ts.Identifier,
  reference: ts.Expression,
  found: Found,
  ctx: FileContext,
): void {
  const behind = sharedStateBehind(identifier, ctx);
  if (behind === undefined) return;
  const { sourceFile, types } = ctx;
  const name = behind.declaration.name;
  if (!ts.isIdentifier(name)) return;
  const change = followChain(reference, name.text, ctx);
  if (change === undefined) return;
  const declSource = behind.declaration.getSourceFile();
  const write: Write = {
    id: behind.id,
    name: name.text,
    declFile: behind.file,
    declStart: name.getStart(declSource),
    declEnd: name.end,
    start: change.node.getStart(sourceFile),
    end: change.node.end,
    example: change.example,
  };
  if (change.kind === "write") {
    found.writes.push(write);
    return;
  }
  const callee = calleeId(change.callee, types);
  if (callee !== undefined) found.passes.push({ ...write, callee, index: change.index });
}

function byPlace(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return a.start - b.start || a.end - b.end;
}

/**
 * The changes this file makes to shared state declared in other files, the state it hands to
 * functions, and what its functions do to their parameters; undefined when none.
 */
export function summarizeFile(ctx: FileContext): FileSummary | undefined {
  if (isTestFile(ctx.file)) return undefined;
  const imports = importsOf(ctx.sourceFile);
  const found: Found = { writes: [], passes: [], params: [] };
  visit(ctx.sourceFile, imports, found, ctx);
  found.writes.sort(byPlace);
  found.passes.sort(byPlace);
  found.params.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index));
  return found.writes.length === 0 && found.passes.length === 0 && found.params.length === 0
    ? undefined
    : found;
}
