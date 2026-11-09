import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";

/**
 * What one reference to a fixed-key variable does to it. Only a `read` keeps the keys fixed;
 * anything this file does not recognise is an `escape`, and the rule then says nothing.
 */
export type Use =
  /**
   * `keys`: the keys it reads, or null when they are not known; `selfKeyed`: the key comes from `Object.keys` of this same variable (`keys` is then
   * empty: it is every key, and no key the record lacks).
   */
  | {
      kind: "read";
      keys: readonly string[] | null;
      selfKeyed: boolean;
      /**
       * A lookup with a key wider than a few literals (a `string`) that handles a missing entry
       * (`?.`, `??`, `||`, a check of the result, or `key in record` first).
       */
      handled?: true;
    }
  | { kind: "write" }
  | { kind: "escape" }
  /** A mention that neither reads nor changes it: `typeof labels` in a type. */
  | { kind: "none" };

const READ_ANY: Use = { kind: "read", keys: [], selfKeyed: false };
const WRITE: Use = { kind: "write" };
const ESCAPE: Use = { kind: "escape" };

/** The methods every object has; reading one is not reading a key of the record. */
const OBJECT_METHODS: ReadonlySet<string> = new Set([
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);

const MAP_READS: ReadonlySet<string> = new Set([
  "get",
  "has",
  "forEach",
  "keys",
  "values",
  "entries",
  "size",
]);
const MAP_WRITES: ReadonlySet<string> = new Set(["set", "delete", "clear"]);

/** `Object.<name>(variable, ...)` where the first argument is read, not changed. */
const OBJECT_READS: ReadonlySet<string> = new Set(["keys", "values", "entries", "hasOwn"]);
const OBJECT_WRITES: ReadonlySet<string> = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
]);

function skipWrappers(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    const parent = current.parent;
    const wrapper =
      ts.isParenthesizedExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTypeAssertionExpression(parent);
    if (!wrapper) return current;
    current = parent;
  }
}

/** `a = v`, `a += v`, `a++`, `delete a`, `[a] = list`, `({ k: a } = obj)`, `for (a of list)`. */
function isWriteTarget(expression: ts.Node): boolean {
  let current = skipWrappers(expression);
  for (;;) {
    const parent = current.parent;
    const inPattern =
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current);
    if (!inPattern) break;
    current = skipWrappers(parent);
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

/** The keys an element access reads, as property names; null when the key is not one of a few literals. */
function keysRead(key: ts.Expression, types: TypeQueries): readonly string[] | null {
  const found = types.literalsOf(key);
  if (found === "not-finite") return null;
  const names: string[] = [];
  for (const literal of found) {
    if (typeof literal.value !== "string" && typeof literal.value !== "number") return null;
    names.push(String(literal.value));
  }
  return names;
}

function isGlobalObject(node: ts.Expression, types: TypeQueries): boolean {
  if (!ts.isIdentifier(node) || node.text !== "Object") return false;
  const symbol = types.symbolAt(node);
  const declaration = symbol && types.declarationOf(symbol);
  return declaration !== undefined && !types.isOwnFile(declaration.file);
}

function objectMethod(callee: ts.Expression, types: TypeQueries): string | undefined {
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) return undefined;
  return isGlobalObject(callee.expression, types) ? callee.name.text : undefined;
}

/** The array methods whose callback gets each element as its first parameter. */
const ELEMENT_CALLBACKS: ReadonlySet<string> = new Set([
  "map",
  "forEach",
  "filter",
  "flatMap",
  "some",
  "every",
  "find",
  "findIndex",
]);

/** The identifier of a variable reference: itself, or the `labels` of a namespace's `ns.labels`. */
function identifierOf(expression: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(expression)) return expression;
  return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)
    ? expression.name
    : undefined;
}

/** Whether `a` and `b` name the same variable, through imports and renames. */
function sameVariable(a: ts.Expression, b: ts.Expression, types: TypeQueries): boolean {
  const first = identifierOf(a);
  const second = identifierOf(b);
  if (first === undefined || second === undefined) return false;
  const symbol = types.symbolAt(first);
  return symbol !== undefined && symbol.id === types.symbolAt(second)?.id;
}

/** `Object.keys(variable)` for the same `variable` as `self`. */
function isObjectKeysOf(
  expression: ts.Expression,
  self: ts.Expression,
  types: TypeQueries,
): boolean {
  const call = skipWrappers(expression);
  if (!ts.isCallExpression(call) || objectMethod(call.expression, types) !== "keys") return false;
  const [argument] = call.arguments;
  return (
    call.arguments.length === 1 && argument !== undefined && sameVariable(argument, self, types)
  );
}

/** The declaration of the variable `identifier` names, when it is a parameter or a `const`. */
function bindingOf(identifier: ts.Identifier, types: TypeQueries): ts.Node | undefined {
  const symbol = types.symbolAt(identifier);
  return symbol && types.declarationOf(symbol)?.node;
}

/**
 * Whether `key` is a key of `self` taken from `Object.keys(self)`: the element of that call
 * (`Object.keys(self)[0]`), the `const` of `for (const key of Object.keys(self))`, or the first
 * parameter of the callback of `Object.keys(self).map(key => …)` (and `forEach`, `filter`, …).
 * The code then looks keys up again that it could take together with their values.
 */
function isKeyOfSelf(key: ts.Expression, self: ts.Expression, types: TypeQueries): boolean {
  const expression = skipWrappers(key);
  if (ts.isElementAccessExpression(expression)) {
    return isObjectKeysOf(expression.expression, self, types);
  }
  if (!ts.isIdentifier(expression)) return false;
  const declaration = bindingOf(expression, types);
  if (declaration === undefined) return false;
  if (ts.isVariableDeclaration(declaration)) {
    const list = declaration.parent;
    const loop = list.parent;
    return (
      ts.isVariableDeclarationList(list) &&
      (list.flags & ts.NodeFlags.Const) !== 0 &&
      ts.isForOfStatement(loop) &&
      loop.initializer === list &&
      isObjectKeysOf(loop.expression, self, types)
    );
  }
  if (!ts.isParameter(declaration)) return false;
  const callback = declaration.parent;
  const call = callback.parent;
  return (
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
    callback.parameters[0] === declaration &&
    ts.isCallExpression(call) &&
    call.arguments[0] === callback &&
    ts.isPropertyAccessExpression(call.expression) &&
    ELEMENT_CALLBACKS.has(call.expression.name.text) &&
    isObjectKeysOf(call.expression.expression, self, types)
  );
}

function asArgument(call: ts.CallExpression, current: ts.Expression, types: TypeQueries): Use {
  const index = call.arguments.indexOf(current);
  const method = objectMethod(call.expression, types);
  if (method !== undefined) {
    if (index === 0 && OBJECT_READS.has(method)) return READ_ANY;
    if (index === 0 && OBJECT_WRITES.has(method)) return WRITE;
    // `Object.assign(target, labels)` copies the entries into another object, like a spread:
    // the table is handed on, and read there with keys stateward cannot follow.
    if (index > 0 && method === "assign") return ESCAPE;
  }
  return types.parameterIsReadonly(call, index) ? READ_ANY : ESCAPE;
}

function asRecordMember(access: ts.PropertyAccessExpression): Use {
  if (isWriteTarget(access)) return WRITE;
  if (!ts.isIdentifier(access.name)) return ESCAPE;
  const name = access.name.text;
  return {
    kind: "read",
    keys: OBJECT_METHODS.has(name) ? [] : [name],
    selfKeyed: false,
  };
}

function asMapMember(access: ts.PropertyAccessExpression, types: TypeQueries): Use {
  if (!ts.isIdentifier(access.name)) return ESCAPE;
  const name = access.name.text;
  if (MAP_WRITES.has(name)) return WRITE;
  if (!MAP_READS.has(name)) return ESCAPE;
  const call = access.parent;
  const [key] = ts.isCallExpression(call) && call.expression === access ? call.arguments : [];
  if ((name !== "get" && name !== "has") || key === undefined || !ts.isCallExpression(call)) {
    return READ_ANY;
  }
  // A lookup with a key from outside (`reasons.get(reason) ?? reason`) is an open dictionary
  // when it handles a miss, as for a record: `has` is the test itself.
  if (keysRead(key, types) !== null) return READ_ANY;
  return name === "has" || handlesMissing(call, access.expression, key, types)
    ? { kind: "read", keys: null, selfKeyed: false, handled: true }
    : { kind: "read", keys: null, selfKeyed: false };
}

function outsideParentheses(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

function isNothing(node: ts.Expression): boolean {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  return (
    inner.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(inner) ||
    (ts.isIdentifier(inner) && inner.text === "undefined")
  );
}

const EQUALITY: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

const FALLBACKS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

/** The value at `node` is checked for being missing where it is used (`?.`, `??`, a test). */
function usedAsMaybeMissing(node: ts.Node): boolean {
  const current = outsideParentheses(node);
  const parent = current.parent;
  if (ts.isTypeOfExpression(parent)) return true;
  // `Array.isArray(value)`: a test that a missing value fails.
  if (
    ts.isCallExpression(parent) &&
    parent.arguments[0] === current &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text === "isArray" &&
    ts.isIdentifier(parent.expression.expression) &&
    parent.expression.expression.text === "Array"
  ) {
    return true;
  }
  if (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isCallExpression(parent)) &&
    parent.expression === current
  ) {
    return parent.questionDotToken !== undefined;
  }
  if (ts.isPrefixUnaryExpression(parent)) return parent.operator === ts.SyntaxKind.ExclamationToken;
  if (ts.isIfStatement(parent) || ts.isWhileStatement(parent)) return parent.expression === current;
  if (ts.isConditionalExpression(parent)) return parent.condition === current;
  if (!ts.isBinaryExpression(parent)) return false;
  const { kind } = parent.operatorToken;
  if (FALLBACKS.has(kind)) return parent.left === current;
  return EQUALITY.has(kind) && isNothing(parent.left === current ? parent.right : parent.left);
}

/** `const value = record[key]` whose first use checks for a missing value. */
export function checkedThroughConst(access: ts.Node, types: TypeQueries): boolean {
  const declaration = outsideParentheses(access).parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false;
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return false;
  const symbol = types.symbolAt(declaration.name);
  const scope = ts.findAncestor(list, (node) => ts.isBlock(node) || ts.isSourceFile(node));
  if (symbol === undefined || scope === undefined) return false;
  let first: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (first !== undefined) return;
    if (
      ts.isIdentifier(node) &&
      node !== declaration.name &&
      node.pos >= declaration.end &&
      types.symbolAt(node)?.id === symbol.id
    ) {
      first = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return first !== undefined && usedAsMaybeMissing(first);
}

/**
 * `key in record`, `Object.hasOwn(record, key)`, `record.hasOwnProperty(key)` or, for a Map,
 * `record.has(key)`, as written.
 */
function testsKey(condition: ts.Expression, record: string, key: string): boolean {
  const inner = ts.isParenthesizedExpression(condition) ? condition.expression : condition;
  if (ts.isBinaryExpression(inner)) {
    const { kind } = inner.operatorToken;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return testsKey(inner.left, record, key) || testsKey(inner.right, record, key);
    }
    return (
      kind === ts.SyntaxKind.InKeyword &&
      inner.left.getText() === key &&
      inner.right.getText() === record
    );
  }
  if (!ts.isCallExpression(inner) || !ts.isPropertyAccessExpression(inner.expression)) return false;
  const [first, second] = inner.arguments;
  const method = inner.expression.name.text;
  if (method === "hasOwn" && first !== undefined && second !== undefined) {
    return first.getText() === record && second.getText() === key;
  }
  return (
    (method === "hasOwnProperty" || method === "has") &&
    first !== undefined &&
    inner.expression.expression.getText() === record &&
    first.getText() === key
  );
}

/** `labels[key]` itself, alone or in an `&&` chain: the read below it has a value. */
function testsTruthy(condition: ts.Expression, access: string): boolean {
  const inner = ts.isParenthesizedExpression(condition) ? condition.expression : condition;
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return testsTruthy(inner.left, access) || testsTruthy(inner.right, access);
  }
  return inner.getText() === access;
}

/** The condition under which `child` of `node` runs, when it runs only if that condition holds. */
function conditionFor(node: ts.Node, child: ts.Node): ts.Expression | undefined {
  if (ts.isIfStatement(node) && child === node.thenStatement) return node.expression;
  if (ts.isConditionalExpression(node) && child === node.whenTrue) return node.condition;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    child === node.right
  ) {
    return node.left;
  }
  return undefined;
}

/** The read sits where a key test on the same record and key holds: an `if`, `?:` or `&&`. */
function guardedByKeyTest(access: ts.Expression, record: ts.Node, key: ts.Expression): boolean {
  const recordText = record.getText();
  const keyText = key.getText();
  let child: ts.Node = access;
  for (let node = access.parent; !ts.isSourceFile(node); node = node.parent) {
    if (ts.isFunctionLike(node)) return false;
    const condition = conditionFor(node, child);
    if (
      condition !== undefined &&
      (testsKey(condition, recordText, keyText) || testsTruthy(condition, access.getText()))
    ) {
      return true;
    }
    child = node;
  }
  return false;
}

/** The lookup handles a key the record lacks: tested first, or its result checked. */
export function handlesMissing(
  access: ts.Expression,
  record: ts.Node,
  key: ts.Expression,
  types: TypeQueries,
): boolean {
  return (
    usedAsMaybeMissing(access) ||
    checkedThroughConst(access, types) ||
    guardedByKeyTest(access, record, key)
  );
}

/**
 * The use `reference` makes of its variable. `reference` is the identifier, or the whole
 * `ns.labels` when the variable is reached through a namespace import.
 */
export function classifyUse(
  reference: ts.Expression,
  kind: "record" | "map",
  types: TypeQueries,
): Use {
  const current = skipWrappers(reference);
  if (!ts.isExpression(current)) return ESCAPE;
  const parent = current.parent;
  if (isWriteTarget(current)) return WRITE;
  if (ts.isElementAccessExpression(parent) && parent.expression === current) {
    if (kind === "map") return ESCAPE;
    if (isWriteTarget(parent)) return WRITE;
    if (isKeyOfSelf(parent.argumentExpression, current, types)) {
      return { kind: "read", keys: [], selfKeyed: true };
    }
    // A key whose type does not resolve is unknown, not `string`: the record stays open (the
    // `stateward/imports` unknown says why).
    if (types.isErrorType(parent.argumentExpression)) return ESCAPE;
    const keys = keysRead(parent.argumentExpression, types);
    return keys === null && handlesMissing(parent, current, parent.argumentExpression, types)
      ? { kind: "read", keys, selfKeyed: false, handled: true }
      : { kind: "read", keys, selfKeyed: false };
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === current) {
    return kind === "record" ? asRecordMember(parent) : asMapMember(parent, types);
  }
  if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
    return asArgument(parent, current, types);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword) {
    return parent.right === current ? READ_ANY : ESCAPE;
  }
  if (
    (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) &&
    parent.expression === current
  ) {
    return READ_ANY;
  }
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return READ_ANY;
  // `{ ...labels, extra }` hands the table on: the copy is read with keys stateward cannot follow
  // (`registry.views[name] ?? null` with a key from the server), so it is an escape.
  return ESCAPE;
}
