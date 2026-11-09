import path from "node:path";
import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext, type Fix } from "@stateward/core";
import {
  compactText,
  fitted,
  fittedOneOf,
  HINT_MAX,
  INSERTED_MAX,
  oneLineText,
  shorten,
} from "./lookup-text.js";
import { importPlace } from "./summary.js";
import { isWriteTarget, ownKeyTest, skipParentheses, stripParentheses } from "./syntax.js";

const EXPLAIN = `# records/unchecked-key

A cast such as \`status as keyof typeof LABELS\` tells TypeScript that \`status\` is a key of \`LABELS\` without checking it, so \`LABELS[status]\` compiles and can give \`undefined\` or an inherited value.

\`\`\`ts example-bad
const LABELS = { draft: "Draft", sent: "Sent" } as const;

export function label(status: string): string {
  return LABELS[status as keyof typeof LABELS];
}
\`\`\`

Check the key before reading. The quick fix "Check the key with isKeyOf" writes the helper once, in \`src/keys.ts\` (or uses the project's own \`isKeyOf\`), and rewrites the read:

\`\`\`ts example-good
const LABELS = { draft: "Draft", sent: "Sent" } as const;

function isKeyOf<T extends object>(table: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(table, key);
}

export function label(status: string): string | undefined {
  return isKeyOf(LABELS, status) ? LABELS[status] : undefined;
}
\`\`\`

The fix writes \`undefined\` for a key the table does not have; replace it with what the code should do then. It uses \`Object.hasOwn\` when the project's \`lib\` has it (ES2022), else \`Object.prototype.hasOwnProperty.call\`, and is offered only when the code compiles after it. Other ways to fix it: use a \`Map\`, whose \`get\` returns \`undefined\` for a missing key, or validate the value where it enters the program and type it as the key there.

## Why it matters

TypeScript rejects \`LABELS[status]\` when \`status\` is a \`string\` (TS7053), and the cast makes the error go away without a check. For \`"archived"\` the read gives \`undefined\`; for \`"constructor"\` it gives a function. Both are typed as \`"Draft" | "Sent"\`. A test with \`in\` (\`status in LABELS\`) has the same gap: \`in\` also finds inherited keys such as \`"toString"\`.

## What it does not catch

It reports a cast to the keys of a plain object (an object literal, an \`as const\` object, a \`Record\` or an interface type) used to read from it, also through a \`const\` that holds the cast, and a type predicate that tests the key with \`in\`. It does not report:

- a cast checked first with \`Object.hasOwn\`, \`Object.prototype.hasOwnProperty.call\`, \`hasOwnProperty\` or a type predicate whose body does one of those (\`isKeyOf\`), in an \`if\`, before \`&&\`, in a \`?:\` condition or before an early \`return\`;
- a key checked the same way against a list of valid keys: \`VALID.has(key)\` on a \`Set\` or \`Map\`, \`VALID.includes(key)\` on an array;
- a key taken from the same table: \`for (const key in LABELS)\`, \`Object.keys(LABELS).map((key) => …)\` and the other array methods, \`for (const [key] of Object.entries(LABELS))\`;
- a read that handles a missing key: \`LABELS[key as K] ?? fallback\` (or \`||\`), \`LABELS[key as K]?.length\`, or a \`const\` that holds the read and is next compared with \`undefined\` or \`null\` or passed to \`isDefined\`, \`isNil\` or \`isNullish\`. Not when the key is read from the URL or from storage (\`params.get(…)\`, \`localStorage.getItem(…)\`): a fallback does not stop an inherited key such as \`"toString"\`;
- a key already typed as the table's keys;
- a \`Map\`, a \`Set\`, an enum, or writes (\`LABELS[key as K] = …\`);
- a table typed \`Record<string, V>\`: its keys are any string, and \`records/ambiguous-table\` covers it.

## Turn it on or off

\`\`\`ts
rules: { "records/unchecked-key": "off" } // or "warning"
rules: { "records/unchecked-key": ["error", { ignore: ["*_LABELS"] }] } // tables read with checked keys elsewhere
\`\`\`
`;

/** The quick fix's title, for a cast and for a predicate. */
export const IS_KEY_OF_TITLE = "Check the key with isKeyOf";
export const HAS_OWN_TITLE = "Check the key with Object.hasOwn";

/** The helper the quick fix writes, in the file `src/keys.ts` (or next to the code). */
export const HELPER_FILE = "keys.ts";
const HELPER_NAME = "isKeyOf";

/** The helper's text, with the own-key test of the project's `lib`. */
function helperText(test: "hasOwn" | "call"): string {
  const body =
    test === "hasOwn"
      ? "Object.hasOwn(table, key)"
      : "Object.prototype.hasOwnProperty.call(table, key)";
  return `/** Whether \`key\` is an own key of \`table\`; unlike \`in\`, inherited keys such as "toString" do not count. */
export function ${HELPER_NAME}<T extends object>(table: T, key: PropertyKey): key is keyof T {
  return ${body};
}
`;
}

/** A read with an unchecked key: a cast used as the key, or an `in` test in a type predicate. */
type Site = {
  kind: "cast" | "predicate";
  /** The span reported: the cast, or the `in` test. */
  start: number;
  end: number;
  /** The table as written (`LABELS`), and the name `ignore` matches (null when it has none). */
  table: string;
  tableName: string | null;
  /**
   * The table as messages show it: as written for a plain reference (`LABELS`, `this.labels`) or a
   * short text, else cut (`getArrowBindings(…)`).
   */
  tableShown: string;
  /** The name a hint gives a `const` that holds a table that is not a plain reference; null for a plain reference. */
  tableConst: string | null;
  key: string;
  /** The cast's type as written (`keyof typeof LABELS`), or the predicate's name. */
  target: string;
  /** The cast is used under `key in table`, which the code may take as the check. */
  inGuard: boolean;
  /** The span the quick fix replaces, and whether its new text needs parentheses; null for none. */
  fix: { start: number; end: number; wrap: boolean } | null;
};

/** What one file holds for the rule (JSON, cached per file). */
export type UncheckedKeySummary = {
  sites: Site[];
  /** The file exports a function `isKeyOf`. */
  exportsHelper: boolean;
  /** `isKeyOf` is in scope in the file: declared or imported. */
  hasHelper: boolean;
  /** Where an import the fix adds goes. */
  importAt: number;
  /** The endings the file's relative imports use, the likeliest first. */
  endings: string[];
  /** The length of the file: a helper appended to it goes there. */
  length: number;
  /**
   * The own-key test the project's `lib` has, read from a reference to the global `Object` in
   * the file: `Object.hasOwn` (ES2022) or only `hasOwnProperty.call`; null when the file has none.
   */
  ownTest: OwnTest | null;
};

type OwnTest = "hasOwn" | "call";

const COLLECTIONS = /^(?:Readonly|Weak)?(?:Map|Set)</;

function isEnumObject(table: ts.Expression, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(table);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declaration !== undefined && ts.isEnumDeclaration(declaration.node);
}

/**
 * The keys of a plain object: an object literal, an `as const` object, a `Record` or an interface
 * type. Undefined for a `Map`, a `Set`, an enum, an array, a primitive or a generic type.
 */
function plainKeys(table: ts.Expression, ctx: FileContext): ReadonlySet<string> | undefined {
  const keys = ctx.types.propertyKeysOf(table);
  if (keys === "not-object" || keys === "generic") return undefined;
  if (COLLECTIONS.test(ctx.types.typeTextOf(table)) || isEnumObject(table, ctx)) return undefined;
  return new Set([...keys.required, ...keys.optional]);
}

/** The keys a node's type names, when it is a finite union of string or number literals. */
function literalKeys(node: ts.Node, ctx: FileContext): readonly string[] | undefined {
  const found = ctx.types.literalsOf(node);
  if (found === "not-finite" || found.length === 0) return undefined;
  const keys: string[] = [];
  for (const literal of found) {
    if (typeof literal.value !== "string" && typeof literal.value !== "number") return undefined;
    keys.push(String(literal.value));
  }
  return keys;
}

type Cast = ts.AsExpression | ts.TypeAssertion;

function castOf(node: ts.Expression): Cast | undefined {
  const inner = stripParentheses(node);
  if (!ts.isAsExpression(inner) && !ts.isTypeAssertionExpression(inner)) return undefined;
  // `as const` states the literal's own type; it claims nothing about another value.
  const { type } = inner;
  const isConst =
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "const";
  return isConst ? undefined : inner;
}

/** `const key = status as Status;` in this file, for a read `LABELS[key]`. */
function storedCast(key: ts.Expression, ctx: FileContext): Cast | undefined {
  if (!ts.isIdentifier(key)) return undefined;
  const symbol = ctx.types.symbolAt(key);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared?.file !== ctx.file) return undefined;
  const { node } = declared;
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined) return undefined;
  const list = node.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) {
    return undefined;
  }
  return castOf(node.initializer);
}

/** The `&&` operands of an expression, parentheses removed: `a && (b && c)` gives a, b and c. */
function conjuncts(expression: ts.Expression): readonly ts.Expression[] {
  const inner = stripParentheses(expression);
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [...conjuncts(inner.left), ...conjuncts(inner.right)];
  }
  return [inner];
}

type Predicate = (
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
) & { readonly type: ts.TypePredicateNode };

/** The function a call calls, when it is a type predicate (`key is K`) declared with a body. */
function predicateOf(call: ts.CallExpression, ctx: FileContext): Predicate | undefined {
  const symbol = ctx.types.symbolAt(call.expression);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined) return undefined;
  const { node } = declared;
  const fn =
    ts.isVariableDeclaration(node) && node.initializer !== undefined
      ? stripParentheses(node.initializer)
      : node;
  return isPredicate(fn) ? fn : undefined;
}

function isPredicate(node: ts.Node): node is Predicate {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)) &&
    node.type !== undefined &&
    ts.isTypePredicateNode(node.type) &&
    node.type.assertsModifier === undefined
  );
}

/** What a type predicate returns: its arrow's expression, or its one `return`. */
function predicateTest(fn: Predicate): ts.Expression | undefined {
  const { body } = fn;
  if (body === undefined) return undefined;
  if (!ts.isBlock(body)) return ts.isExpression(body) ? body : undefined;
  const [only] = body.statements;
  return body.statements.length === 1 && only !== undefined && ts.isReturnStatement(only)
    ? only.expression
    : undefined;
}

/** The index of the parameter named `name`, or -1. */
function parameterIndex(fn: Predicate, name: string): number {
  return fn.parameters.findIndex(
    (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
  );
}

/**
 * Whether a call to a type predicate checks that `key` is an own key of `table`: its body is
 * `Object.hasOwn(t, k)`, `Object.prototype.hasOwnProperty.call(t, k)` or `t.hasOwnProperty(k)`,
 * possibly after other `&&` tests, where `k` is the parameter the predicate narrows and `t` is a
 * parameter given `table`, or `table` itself.
 */
function callChecksOwnKey(
  call: ts.CallExpression,
  table: ts.Expression,
  key: string,
  ctx: FileContext,
): boolean {
  const fn = predicateOf(call, ctx);
  const test = fn === undefined ? undefined : predicateTest(fn);
  if (fn === undefined || test === undefined) return false;
  const { parameterName } = fn.type;
  if (!ts.isIdentifier(parameterName)) return false;
  const narrowed = parameterIndex(fn, parameterName.text);
  const given = call.arguments[narrowed];
  if (given === undefined || compactText(given, ctx.sourceFile) !== key) return false;
  const tableText = compactText(table, ctx.sourceFile);
  const tableSymbol = ctx.types.symbolAt(table);
  return conjuncts(test).some((part) => {
    if (!ts.isCallExpression(part)) return false;
    const own = ownKeyTest(part);
    if (own === undefined) return false;
    const [object, tested] = own.map(stripParentheses);
    if (object === undefined || tested === undefined) return false;
    if (!ts.isIdentifier(tested) || tested.text !== parameterName.text) return false;
    const objectAt = ts.isIdentifier(object) ? parameterIndex(fn, object.text) : -1;
    if (objectAt >= 0) {
      const argument = call.arguments[objectAt];
      return argument !== undefined && compactText(argument, ctx.sourceFile) === tableText;
    }
    const objectSymbol = ctx.types.symbolAt(object);
    return objectSymbol !== undefined && objectSymbol.id === tableSymbol?.id;
  });
}

/** What a test says about `key` in `table` when it is true: an own key, a key found by `in`, or nothing. */
type KeyTest = "own" | "in" | undefined;

function keyTest(
  expression: ts.Expression,
  table: ts.Expression,
  key: string,
  ctx: FileContext,
): KeyTest {
  const tableText = compactText(table, ctx.sourceFile);
  const text = (node: ts.Expression): string => compactText(stripParentheses(node), ctx.sourceFile);
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.InKeyword
  ) {
    return text(expression.left) === key && text(expression.right) === tableText ? "in" : undefined;
  }
  if (!ts.isCallExpression(expression)) return undefined;
  const own = ownKeyTest(expression);
  if (own !== undefined) {
    return text(own[0]) === tableText && text(own[1]) === key ? "own" : undefined;
  }
  if (testsCollection(expression, key, ctx)) return "own";
  return callChecksOwnKey(expression, table, key, ctx) ? "own" : undefined;
}

const SETS = /^(?:Readonly)?(?:Set|Map)<.*>$/;
const ARRAYS =
  /^(?:readonly )?(?:\(.*\)|[^|]*)\[\]$|^(?:readonly )?\[.*\]$|^(?:Readonly)?Array<.*>$/;

/** The type of a collection as written, without `| undefined` and `| null`. */
function collectionType(node: ts.Expression, ctx: FileContext): string {
  return ctx.types
    .typeTextOf(node)
    .replace(/ \| (?:undefined|null)\b/g, "")
    .replace(/^(?:undefined|null) \| /, "");
}

/**
 * `VALID.has(key)` on a `Set` or `Map`, or `VALID.includes(key)` on an array or tuple, where `key`
 * is the variable the cast asserts: the code checks the key against a list of the valid keys.
 */
function testsCollection(call: ts.CallExpression, key: string, ctx: FileContext): boolean {
  const callee = stripParentheses(call.expression);
  const [argument] = call.arguments;
  if (!ts.isPropertyAccessExpression(callee) || argument === undefined) return false;
  if (call.arguments.length !== 1) return false;
  const tested = stripParentheses(argument);
  if (!ts.isIdentifier(tested) || tested.text !== key) return false;
  const method = callee.name.text;
  if (method !== "has" && method !== "includes") return false;
  const type = collectionType(callee.expression, ctx);
  return (method === "has" ? SETS : ARRAYS).test(type);
}

/**
 * What `condition` being `truth` says about the key: the test itself when true, its negation when
 * false, either side of `&&` when true, either side of `||` when false. An own-key test wins.
 */
function guardOf(
  condition: ts.Expression,
  truth: boolean,
  table: ts.Expression,
  key: string,
  ctx: FileContext,
): KeyTest {
  const inner = stripParentheses(condition);
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken) {
    return guardOf(inner.operand, !truth, table, key, ctx);
  }
  if (ts.isBinaryExpression(inner)) {
    const joins = truth ? ts.SyntaxKind.AmpersandAmpersandToken : ts.SyntaxKind.BarBarToken;
    if (inner.operatorToken.kind === joins) {
      const left = guardOf(inner.left, truth, table, key, ctx);
      const right = guardOf(inner.right, truth, table, key, ctx);
      return left === "own" || right === "own" ? "own" : (left ?? right);
    }
  }
  return truth ? keyTest(inner, table, key, ctx) : undefined;
}

/** Whether a statement always leaves the code after it: `return`, `throw`, `break`, `continue`. */
function exits(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return true;
  }
  const last = ts.isBlock(statement) ? statement.statements.at(-1) : undefined;
  return last !== undefined && exits(last);
}

/**
 * What the code around `node` has tested about `key` in `table`: in the `then` of an `if`, the
 * branch of a `?:` its test selects, the right of `&&`, or after `if (!test) return;`.
 */
function guardAround(node: ts.Node, table: ts.Expression, key: string, ctx: FileContext): KeyTest {
  let found: KeyTest;
  const note = (test: KeyTest): boolean => {
    if (test === "own") return true;
    found ??= test;
    return false;
  };
  let child: ts.Node = node;
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isIfStatement(current) && child !== current.expression) {
      if (note(guardOf(current.expression, child === current.thenStatement, table, key, ctx))) {
        return "own";
      }
    } else if (ts.isConditionalExpression(current) && child !== current.condition) {
      if (note(guardOf(current.condition, child === current.whenTrue, table, key, ctx))) {
        return "own";
      }
    } else if (
      ts.isBinaryExpression(current) &&
      current.right === child &&
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      if (note(guardOf(current.left, true, table, key, ctx))) return "own";
    } else if (ts.isBlock(current) || ts.isSourceFile(current.parent)) {
      const statements: readonly ts.Statement[] = ts.isBlock(current) ? current.statements : [];
      const at = statements.findIndex((statement) => statement === child);
      for (const statement of statements.slice(0, Math.max(at, 0))) {
        if (
          ts.isIfStatement(statement) &&
          statement.elseStatement === undefined &&
          exits(statement.thenStatement) &&
          note(guardOf(statement.expression, false, table, key, ctx))
        ) {
          return "own";
        }
      }
    }
    child = current;
  }
  return found;
}

/** `LABELS` for `LABELS[k]`, `labels` for `this.labels[k]`: the name `ignore` matches. */
function tableName(table: ts.Expression): string | null {
  if (ts.isIdentifier(table)) return table.text;
  return ts.isPropertyAccessExpression(table) ? table.name.text : null;
}

/** `a`, `a.b.c`, `this.a`: an expression the fix can write twice with the same value. */
function isPlainReference(node: ts.Expression): boolean {
  const inner = stripParentheses(node);
  if (ts.isIdentifier(inner) || inner.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isPropertyAccessExpression(inner) && isPlainReference(inner.expression);
}

/** Where `a ? b : c` can replace the read without parentheses. */
function standsAlone(access: ts.Node): boolean {
  const parent = access.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.initializer === access) ||
    (ts.isReturnStatement(parent) && parent.expression === access) ||
    (ts.isArrowFunction(parent) && parent.body === access) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === access) ||
    ts.isParenthesizedExpression(parent) ||
    ts.isJsxExpression(parent) ||
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      (parent.arguments ?? []).some((argument) => argument === access))
  );
}

/** `Object.keys(T)` or `Object.entries(T)`: which of the two, and `T`. */
function objectKeysOf(
  node: ts.Expression,
): { method: "keys" | "entries"; object: ts.Expression } | undefined {
  const call = stripParentheses(node);
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) return undefined;
  const callee = stripParentheses(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const target = stripParentheses(callee.expression);
  const method = callee.name.text;
  const [object] = call.arguments;
  if (!ts.isIdentifier(target) || target.text !== "Object" || object === undefined) {
    return undefined;
  }
  return method === "keys" || method === "entries" ? { method, object } : undefined;
}

/** Array methods whose callback gets each element as its first parameter. */
const ELEMENT_CALLBACKS: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flatMap",
  "forEach",
  "map",
  "some",
]);

/** `reduce` and `reduceRight` get each element as their callback's second parameter. */
const REDUCERS: ReadonlySet<string> = new Set(["reduce", "reduceRight"]);

/**
 * The object a key variable was taken from: `T` when the variable is declared by
 * `for (const k in T)`, `for (const k of Object.keys(T))`, `for (const [k] of Object.entries(T))`,
 * or as the element parameter of a callback given to an array method of `Object.keys(T)` or
 * `Object.entries(T)` (`Object.keys(T).forEach((k) => …)`, `reduce((acc, k) => …)`).
 */
function keysSource(key: ts.Expression, ctx: FileContext): ts.Expression | undefined {
  if (!ts.isIdentifier(key)) return undefined;
  const symbol = ctx.types.symbolAt(key);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared?.file !== ctx.file) return undefined;
  let node = declared.node;
  let wanted: "keys" | "entries" = "keys";
  if (ts.isBindingElement(node)) {
    // `[k, v]` of an entry: the key is the first element.
    const pattern = node.parent;
    if (!ts.isArrayBindingPattern(pattern) || pattern.elements[0] !== node) return undefined;
    if (node.dotDotDotToken !== undefined) return undefined;
    node = pattern.parent;
    wanted = "entries";
  }
  if (ts.isVariableDeclaration(node)) {
    const list = node.parent;
    if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1) return undefined;
    const loop = list.parent;
    if (ts.isForInStatement(loop) && loop.initializer === list) {
      return wanted === "keys" ? loop.expression : undefined;
    }
    if (!ts.isForOfStatement(loop) || loop.initializer !== list) return undefined;
    const keys = objectKeysOf(loop.expression);
    return keys?.method === wanted ? keys.object : undefined;
  }
  if (!ts.isParameter(node)) return undefined;
  const fn = node.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return undefined;
  const given = skipParentheses(fn);
  const call = given.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== given) return undefined;
  const callee = stripParentheses(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  const index = REDUCERS.has(method) ? 1 : ELEMENT_CALLBACKS.has(method) ? 0 : -1;
  if (fn.parameters.indexOf(node) !== index) return undefined;
  const keys = objectKeysOf(callee.expression);
  return keys?.method === wanted ? keys.object : undefined;
}

/** Whether two expressions are the same object: the same text, or names of the same symbol. */
function sameObject(a: ts.Expression, b: ts.Expression, ctx: FileContext): boolean {
  const left = stripParentheses(a);
  const right = stripParentheses(b);
  if (compactText(left, ctx.sourceFile) === compactText(right, ctx.sourceFile)) return true;
  if (!ts.isIdentifier(left) || !ts.isIdentifier(right)) return false;
  const symbol = ctx.types.symbolAt(left);
  return symbol !== undefined && symbol.id === ctx.types.symbolAt(right)?.id;
}

/** Guards named for a test of `null` and `undefined`: `isDefined(x)`, `isNil(x)`. */
const NULLISH_GUARDS: ReadonlySet<string> = new Set(["isDefined", "isNil", "isNullish"]);

function isUndefinedLiteral(node: ts.Expression): boolean {
  const inner = stripParentheses(node);
  return (
    (ts.isIdentifier(inner) && inner.text === "undefined") ||
    (ts.isVoidExpression(inner) && ts.isNumericLiteral(stripParentheses(inner.expression)))
  );
}

/**
 * Whether a use of a value tests it for a missing entry: `x === undefined`, `x !== undefined`,
 * `x == null`, `x != null` (either side), or `isDefined(x)`, `isNil(x)`, `isNullish(x)`.
 */
function testsMissing(use: ts.Node): boolean {
  const node = skipParentheses(use);
  const parent = node.parent;
  if (ts.isBinaryExpression(parent)) {
    const other = parent.left === node ? parent.right : parent.left;
    const kind = parent.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      return isUndefinedLiteral(other);
    }
    if (kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsToken) {
      return (
        isUndefinedLiteral(other) || stripParentheses(other).kind === ts.SyntaxKind.NullKeyword
      );
    }
    return false;
  }
  if (!ts.isCallExpression(parent) || !parent.arguments.some((argument) => argument === node)) {
    return false;
  }
  const callee = stripParentheses(parent.expression);
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined;
  return name !== undefined && NULLISH_GUARDS.has(name);
}

/** The body a declaration is in: its nearest function, or the file. */
function scopeOf(node: ts.Node): ts.Node {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionLike(current) && "body" in current && current.body !== undefined) {
      return current.body;
    }
  }
  return node.getSourceFile();
}

/** The first use of a `const` after its declaration, in its function. */
function firstUse(
  declaration: ts.VariableDeclaration,
  ctx: FileContext,
): ts.Identifier | undefined {
  const { name } = declaration;
  if (!ts.isIdentifier(name)) return undefined;
  const symbol = ctx.types.symbolAt(name);
  if (symbol === undefined) return undefined;
  const after = declaration.getEnd();
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || node.getEnd() <= after) return;
    if (
      ts.isIdentifier(node) &&
      node.text === name.text &&
      node.getStart(ctx.sourceFile) >= after &&
      ctx.types.symbolAt(node)?.id === symbol.id
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scopeOf(declaration));
  return found;
}

/**
 * Whether the code handles a key the table does not have where it reads it: the read is the left
 * of `??` or `||`, is followed by `?.`, or is held in a `const` whose first use tests it for
 * `undefined` or `null`.
 */
function handlesMissing(access: ts.ElementAccessExpression, ctx: FileContext): boolean {
  const node = skipParentheses(access);
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    const kind = parent.operatorToken.kind;
    return kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken;
  }
  if (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isCallExpression(parent)) &&
    parent.expression === node
  ) {
    return parent.questionDotToken !== undefined;
  }
  if (!ts.isVariableDeclaration(parent) || parent.initializer !== node) return false;
  const list = parent.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return false;
  const use = firstUse(parent, ctx);
  return use !== undefined && testsMissing(use);
}

/** Objects whose `get`/`getItem` return text from outside the program: the URL, browser storage. */
const OUTSIDE_SOURCES = /^(?:Readonly)?URLSearchParams$|^Storage$/;

/**
 * Whether a key is read from outside the program where it is cast, or in the `const` it comes
 * from: `params.get("sort")` on a `URLSearchParams`, `localStorage.getItem("tab")`.
 */
function readFromOutside(value: ts.Expression, ctx: FileContext): boolean {
  let node = stripParentheses(value);
  if (ts.isIdentifier(node)) {
    const symbol = ctx.types.symbolAt(node);
    const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    const local = declared?.file === ctx.file ? declared.node : undefined;
    if (
      local === undefined ||
      !ts.isVariableDeclaration(local) ||
      (ts.getCombinedNodeFlags(local) & ts.NodeFlags.Const) === 0 ||
      local.initializer === undefined
    ) {
      return false;
    }
    node = stripParentheses(local.initializer);
  }
  // `params.get("sort") ?? "name"`, `params.get("sort")!`: the read is the left or the operand.
  while (
    ts.isNonNullExpression(node) ||
    (ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken))
  ) {
    node = stripParentheses(ts.isNonNullExpression(node) ? node.expression : node.left);
  }
  if (!ts.isCallExpression(node)) return false;
  const callee = stripParentheses(node.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  if (method !== "get" && method !== "getItem") return false;
  return OUTSIDE_SOURCES.test(collectionType(callee.expression, ctx));
}

/** The name a hint gives a `const` that holds the table: the last word of what makes it. */
function constNameFor(table: ts.Expression, key: string): string {
  const inner = stripParentheses(table);
  const source = ts.isCallExpression(inner) ? stripParentheses(inner.expression) : undefined;
  const named =
    source === undefined
      ? undefined
      : ts.isIdentifier(source)
        ? source.text
        : ts.isPropertyAccessExpression(source)
          ? source.name.text
          : undefined;
  const word = named?.match(/[A-Z]?[a-z][a-z0-9]*$/)?.[0]?.toLowerCase();
  const usable =
    word !== undefined && word.length > 2 && word !== key && !VERBS.has(word) && word !== named;
  return usable ? word : "table";
}

/** Last words of a call's name that do not name what it returns. */
const VERBS: ReadonlySet<string> = new Set(["get", "make", "create", "build", "load", "read"]);

/** The table as messages show it: whole when short or a plain reference, else cut (`f(…)`). */
function shownTable(table: ts.Expression, sourceFile: ts.SourceFile): string {
  const text = oneLineText(table, sourceFile);
  if (isPlainReference(table) || text.length <= INSERTED_MAX) return text;
  const inner = stripParentheses(table);
  if (ts.isCallExpression(inner)) {
    const callee = shorten(oneLineText(inner.expression, sourceFile), INSERTED_MAX);
    return `${callee}(${inner.arguments.length === 0 ? "" : "…"})`;
  }
  return shorten(text, INSERTED_MAX);
}

/** The fields of a site that say how messages show its table. */
function tableFields(
  table: ts.Expression,
  key: string,
  sourceFile: ts.SourceFile,
): Pick<Site, "table" | "tableShown" | "tableConst"> {
  return {
    table: oneLineText(table, sourceFile),
    tableShown: shownTable(table, sourceFile),
    tableConst: isPlainReference(table) ? null : constNameFor(table, key),
  };
}

function castSite(
  access: ts.ElementAccessExpression,
  ignore: readonly string[],
  ctx: FileContext,
): Site | undefined {
  if (isWriteTarget(access)) return undefined;
  const argument = stripParentheses(access.argumentExpression);
  const inline = castOf(argument);
  const cast = inline ?? storedCast(argument, ctx);
  if (cast === undefined) return undefined;
  const table = stripParentheses(access.expression);
  const name = tableName(table);
  if (name !== null && matchesName(name, ignore)) return undefined;
  const target = literalKeys(cast, ctx);
  const keys = plainKeys(table, ctx);
  if (target === undefined || keys === undefined) return undefined;
  if (!target.every((key) => keys.has(key))) return undefined;
  // A value already typed as the keys: the cast only restates its type.
  const given = literalKeys(cast.expression, ctx);
  if (given?.every((key) => target.includes(key)) === true) return undefined;
  const value = stripParentheses(cast.expression);
  // A key taken from the same object (`Object.keys(T)`, `for (k in T)`) is one of its keys.
  const source = keysSource(value, ctx);
  if (source !== undefined && sameObject(source, table, ctx)) return undefined;
  // `?? fallback` handles a missing key, not an inherited one (`"toString"` gives a function): a
  // key read from the URL or from storage is still reported.
  if (!readFromOutside(value, ctx) && handlesMissing(access, ctx)) return undefined;
  const key = compactText(value, ctx.sourceFile);
  const guard = guardAround(inline === undefined ? cast : access, table, key, ctx);
  if (guard === "own") return undefined;
  const fixable = inline !== undefined && isPlainReference(value) && isPlainReference(table);
  const keyText = oneLineText(value, ctx.sourceFile);
  return {
    kind: "cast",
    start: cast.getStart(ctx.sourceFile),
    end: cast.getEnd(),
    ...tableFields(table, keyText, ctx.sourceFile),
    tableName: name,
    key: keyText,
    target: oneLineText(cast.type, ctx.sourceFile),
    inGuard: guard === "in",
    fix: fixable
      ? { start: access.getStart(ctx.sourceFile), end: access.getEnd(), wrap: !standsAlone(access) }
      : null,
  };
}

/**
 * A type predicate that answers with `key in table` (`function isStatus(key: string): key is Status
 * { return key in LABELS; }`), where `key` is the narrowed parameter and the predicate's type is
 * keys of `table`: `in` also finds inherited keys such as "toString".
 */
function predicateSite(
  fn: Predicate,
  ignore: readonly string[],
  ctx: FileContext,
): Site | undefined {
  const test = predicateTest(fn);
  const { parameterName, type } = fn.type;
  if (test === undefined || type === undefined || !ts.isIdentifier(parameterName)) return undefined;
  const parts = conjuncts(test);
  const found = parts.find(
    (part) =>
      ts.isBinaryExpression(part) &&
      part.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      ts.isIdentifier(stripParentheses(part.left)) &&
      compactText(part.left, ctx.sourceFile) === parameterName.text,
  );
  if (found === undefined || !ts.isBinaryExpression(found)) return undefined;
  const table = stripParentheses(found.right);
  if (parts.some((part) => keyTest(part, table, parameterName.text, ctx) === "own"))
    return undefined;
  const name = tableName(table);
  if (name !== null && matchesName(name, ignore)) return undefined;
  const isKeyof = ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.KeyOfKeyword;
  if (!isKeyof) {
    const claimed = literalKeys(type, ctx);
    const keys = plainKeys(table, ctx);
    if (claimed === undefined || keys === undefined) return undefined;
    if (!claimed.every((key) => keys.has(key))) return undefined;
  }
  const fnName =
    fn.name !== undefined && ts.isIdentifier(fn.name)
      ? fn.name.text
      : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
        ? fn.parent.name.text
        : "the type predicate";
  return {
    kind: "predicate",
    start: found.getStart(ctx.sourceFile),
    end: found.getEnd(),
    ...tableFields(table, parameterName.text, ctx.sourceFile),
    tableName: name,
    key: parameterName.text,
    target: fnName,
    inGuard: false,
    fix: isPlainReference(table)
      ? { start: found.getStart(ctx.sourceFile), end: found.getEnd(), wrap: false }
      : null,
  };
}

/** Whether the file declares or imports a value named `isKeyOf`, and whether it exports one. */
function helperIn(sourceFile: ts.SourceFile): { has: boolean; exports: boolean } {
  let has = false;
  let exported = false;
  for (const statement of sourceFile.statements) {
    const isExported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    const names: string[] = [];
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        names.push(...bindings.elements.map((element) => element.name.text));
      }
    }
    if (names.includes(HELPER_NAME)) {
      has = true;
      exported ||= isExported;
    }
  }
  return { has, exports: exported };
}

/** The endings the file's own relative imports use (`.js`, none), the likeliest first. */
function importEndings(sourceFile: ts.SourceFile): string[] {
  const relative = sourceFile.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text.startsWith(".")
      ? [statement.moduleSpecifier.text]
      : [],
  );
  if (relative.some((specifier) => specifier.endsWith(".js"))) return [".js"];
  if (relative.some((specifier) => specifier.endsWith(".ts"))) return [".ts"];
  return relative.length > 0 ? [""] : ["", ".js"];
}

/**
 * The own-key test the project's `lib` has, read from the type of a reference to the global
 * `Object`: `Object.hasOwn` (ES2022), else `hasOwnProperty.call`. Null when `Object` is the
 * project's own declaration.
 */
function ownTestOf(globalObject: ts.Identifier, ctx: FileContext): OwnTest | null {
  const symbol = ctx.types.symbolAt(globalObject);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || ctx.types.isOwnFile(declared.file)) return null;
  return ctx.types.hasDefinedProperty(globalObject, "hasOwn") ? "hasOwn" : "call";
}

function summarize(ctx: FileContext<{ ignore: readonly string[] }>): UncheckedKeySummary {
  const sites: Site[] = [];
  const seen = new Set<number>();
  const add = (site: Site | undefined): void => {
    if (site === undefined || seen.has(site.start)) return;
    seen.add(site.start);
    sites.push(site);
  };
  let globalObject: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isElementAccessExpression(node)) add(castSite(node, ctx.options.ignore, ctx));
    else if (isPredicate(node)) add(predicateSite(node, ctx.options.ignore, ctx));
    else if (
      globalObject === undefined &&
      ts.isIdentifier(node) &&
      node.text === "Object" &&
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.expression === node
    ) {
      globalObject = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  const helper = helperIn(ctx.sourceFile);
  return {
    ownTest: globalObject === undefined ? null : ownTestOf(globalObject, ctx),
    sites: sites.sort((a, b) => a.start - b.start),
    exportsHelper: helper.exports,
    hasHelper: helper.has,
    importAt: importPlace(ctx.sourceFile),
    endings: importEndings(ctx.sourceFile),
    length: ctx.sourceFile.text.length,
  };
}

function castHeadline(site: Site): string {
  return fitted((cut) =>
    site.inGuard
      ? `\`${cut(site.key)} in ${cut(site.tableShown)}\` also finds inherited keys such as "toString": the cast to \`${cut(site.target)}\` is not checked`
      : `the cast to \`${cut(site.target)}\` does not check that \`${cut(site.key)}\` is a key of \`${cut(site.tableShown)}\``,
  );
}

/** The own-key test as the fix writes it, for `table` and `key`. */
function ownTestText(test: OwnTest, table: string, key: string): string {
  return test === "hasOwn"
    ? `Object.hasOwn(${table}, ${key})`
    : `Object.prototype.hasOwnProperty.call(${table}, ${key})`;
}

/**
 * The first fix line: check the key with `isKeyOf` (on a `const` that holds the table when the
 * table is not a plain reference), and what `isKeyOf` tests: the project's own helper, or the
 * own-key test of the project's `lib` the quick fix writes in it.
 */
function isKeyOfLine(site: Site, helper: "project" | OwnTest | null): string {
  const what =
    helper === "project"
      ? ", the project's type predicate"
      : helper === null
        ? ", a type predicate that tests own keys"
        : `, a type predicate that uses \`${helper === "hasOwn" ? "Object.hasOwn" : "Object.prototype.hasOwnProperty.call"}\``;
  const { tableConst } = site;
  const check = (cut: (text: string) => string): string =>
    tableConst === null
      ? `- check the key first with \`isKeyOf(${cut(site.table)}, ${cut(site.key)})\``
      : `- put the object in a \`const\` first (\`const ${tableConst} = ${site.tableShown}\`), then check the key with \`isKeyOf(${tableConst}, ${cut(site.key)})\``;
  const short = (cut: (text: string) => string): string =>
    tableConst === null
      ? check(cut)
      : `- put the object in a \`const\` (\`const ${tableConst} = ${site.tableShown}\`) and check the key with \`isKeyOf(${tableConst}, ${cut(site.key)})\``;
  return fittedOneOf(HINT_MAX, [(cut) => `${check(cut)}${what}`, check, short]);
}

function castHint(site: Site, helper: "project" | OwnTest | null): string {
  return [
    "one of",
    isKeyOfLine(site, helper),
    `- or use a \`Map\`: its \`get\` returns \`undefined\` for a missing key`,
    `- or validate \`${site.key}\` where it enters the program, and type it as the key there`,
  ].join("\n");
}

function predicateHeadline(site: Site): string {
  return fitted(
    (cut) =>
      `\`${cut(site.target)}\` tests \`${cut(site.key)} in ${cut(site.tableShown)}\`, which also finds inherited keys such as "toString"`,
  );
}

function predicateHint(site: Site, test: OwnTest | null): string {
  const table = site.tableConst ?? site.table;
  const forms: readonly OwnTest[] = test === null ? ["hasOwn", "call"] : [test];
  const ways = (cut: (text: string) => string): string =>
    forms.map((form) => `\`${ownTestText(form, table, cut(site.key))}\``).join(" or ");
  const names = forms
    .map((form) => (form === "hasOwn" ? "`Object.hasOwn`" : "`hasOwnProperty.call`"))
    .join(" or ");
  const first =
    site.tableConst === null
      ? fittedOneOf(HINT_MAX, [
          (cut) => `- test with ${ways(cut)}: it finds own keys only`,
          () => `- test own keys only, with ${names}`,
        ])
      : fittedOneOf(HINT_MAX, [
          (cut) =>
            `- put the object in a \`const\` first (\`const ${table} = ${site.tableShown}\`), then test with ${ways(cut)}`,
          () =>
            `- put the object in a \`const\` first (\`const ${table} = ${site.tableShown}\`), then test own keys only, with ${names}`,
          () =>
            `- put the object in a \`const\` (\`const ${table} = ${site.tableShown}\`) and test own keys with ${names}`,
        ]);
  return ["one of", first, `- or use a \`Map\` and its \`has\``].join("\n");
}

/** The nearest `src` folder above the file, else the file's own folder. */
function helperFileFor(file: string): string {
  let directory = path.posix.dirname(file);
  for (let current = directory; ; current = path.posix.dirname(current)) {
    if (path.posix.basename(current) === "src") {
      directory = current;
      break;
    }
    if (path.posix.dirname(current) === current) break;
  }
  return path.posix.join(directory, HELPER_FILE);
}

function importSpecifier(from: string, helperFile: string, ending: string): string {
  const relative = path.posix
    .relative(path.posix.dirname(from), helperFile)
    .replace(/\.[cm]?tsx?$/, "");
  return `${relative.startsWith(".") ? relative : `./${relative}`}${ending}`;
}

/** The project's own `isKeyOf`: the first file, by path, that exports one. */
function projectHelper(summaries: ReadonlyMap<string, UncheckedKeySummary>): string | undefined {
  return [...summaries]
    .filter(([, summary]) => summary.exportsHelper)
    .map(([file]) => file)
    .sort()
    .at(0);
}

/**
 * The quick fix for a cast: the helper written once (or the project's own), imported, and the read
 * rewritten as `isKeyOf(TABLE, key) ? TABLE[key] : undefined`. Its forms cover the `lib`
 * (`Object.hasOwn` from ES2022, else `hasOwnProperty.call`) and the import endings; the first that
 * compiles is offered, and none when none does.
 */
function castFix(
  site: Site,
  file: string,
  summary: UncheckedKeySummary,
  summaries: ReadonlyMap<string, UncheckedKeySummary>,
): Fix | undefined {
  const { fix } = site;
  if (fix === null) return undefined;
  const test = `${HELPER_NAME}(${site.table}, ${site.key}) ? ${site.table}[${site.key}] : undefined`;
  const rewrite = {
    location: { file, start: fix.start, end: fix.end },
    newText: fix.wrap ? `(${test})` : test,
  };
  const existing = projectHelper(summaries);
  const helperFile = existing ?? helperFileFor(file);
  const helperSummary = summaries.get(helperFile);
  const imports =
    summary.hasHelper || helperFile === file
      ? [[]]
      : summary.endings.map((ending) => [
          {
            location: { file, start: summary.importAt, end: summary.importAt },
            newText: `${summary.importAt === 0 ? "" : "\n"}import { ${HELPER_NAME} } from ${JSON.stringify(importSpecifier(file, helperFile, ending))};${summary.importAt === 0 ? "\n" : ""}`,
          },
        ]);
  const helperEdits =
    existing !== undefined
      ? [[]]
      : (["hasOwn", "call"] as const).map((form) =>
          helperSummary === undefined
            ? [{ location: { file: helperFile, start: 0, end: 0 }, newText: helperText(form) }]
            : [
                {
                  location: {
                    file: helperFile,
                    start: helperSummary.length,
                    end: helperSummary.length,
                  },
                  newText: `\n${helperText(form)}`,
                },
              ],
        );
  const forms = helperEdits.flatMap((helper) =>
    imports.map((added) => ({
      title: IS_KEY_OF_TITLE,
      edits: [...helper, ...added, rewrite],
    })),
  );
  const [first, ...rest] = forms;
  return first === undefined ? undefined : { ...first, alternatives: rest };
}

/** The quick fix for a predicate: `key in TABLE` becomes an own-key test. */
function predicateFix(site: Site, file: string): Fix | undefined {
  const { fix } = site;
  if (fix === null) return undefined;
  const at = { file, start: fix.start, end: fix.end };
  return {
    title: HAS_OWN_TITLE,
    edits: [{ location: at, newText: `Object.hasOwn(${site.table}, ${site.key})` }],
    alternatives: [
      {
        title: HAS_OWN_TITLE,
        edits: [
          {
            location: at,
            newText: `Object.prototype.hasOwnProperty.call(${site.table}, ${site.key})`,
          },
        ],
      },
    ],
  };
}

export const uncheckedKey = defineRule({
  kind: "project",
  meta: {
    description:
      "A cast such as `status as keyof typeof LABELS` tells TypeScript that `status` is a key of `LABELS` without checking it, so `LABELS[status]` compiles and can give `undefined` or an inherited value.",
    summary:
      "a key cast (`as keyof typeof LABELS`) or `in` test used to read a table without an own-key check",
    defaultSeverity: "warning",
    tier: "addon",
    addon: "unchecked-key",
    group: "keys",
    options: {
      ignore: option.strings({
        default: [],
        description: "Table names (globs like *_LABELS) whose reads are not checked.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize,
  check(summaries, ctx) {
    // The `lib` read from another file when a file has no reference to `Object`: the first by path.
    const projectTest =
      [...summaries]
        .filter(([, summary]) => summary.ownTest !== null)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .at(0)?.[1].ownTest ?? null;
    const helper = projectHelper(summaries);
    for (const [file, summary] of summaries) {
      const test = summary.ownTest ?? projectTest;
      for (const site of summary.sites) {
        const location = { file, start: site.start, end: site.end };
        const fix =
          site.kind === "cast" ? castFix(site, file, summary, summaries) : predicateFix(site, file);
        ctx.report({
          message: site.kind === "cast" ? castHeadline(site) : predicateHeadline(site),
          hint:
            site.kind === "cast"
              ? castHint(site, helper === undefined ? test : "project")
              : predicateHint(site, test),
          location,
          fixes: fix === undefined ? [] : [fix],
        });
      }
    }
  },
});
