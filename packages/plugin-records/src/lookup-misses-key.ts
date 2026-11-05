import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext } from "@stateward/core";
import { checkedThroughConst } from "./uses.js";
import {
  INSERTED_MAX,
  compactText,
  fitted,
  listItems,
  oneLineText,
  shorten,
} from "./lookup-text.js";

const EXPLAIN = `# records/lookup-misses-key

A lookup like labels[status] has an entry for every value of the key, or handles a missing one.

## Why

\`labels[status]\` is typed \`string\`, so the code uses it as text. When \`status\` can be \`"failed"\` and \`labels\` has no \`failed\` entry, the read gives \`undefined\`: the page shows "undefined", or the next \`.toUpperCase()\` throws. The type promised a value that the object does not have.

## When to use it

Use it for any object or \`Map\`-like table keyed by a union: labels, colours, icons, handlers, routes. It is on as an error in every preset. Turn it off only in code where a missing key is normal and handled in a way the rule cannot see.

## What it catches

A read \`table[key]\` where \`key\` is a union of strings or numbers, some value of \`key\` has no entry of its own in \`table\` (or only a catch-all like \`Record<string, string>\`), and the result's type does not already include \`undefined\`.

### Bad

\`\`\`ts
type Status = "idle" | "failed";
const labels: Record<string, string> = { idle: "Idle" };
const text = labels[status]; // typed string, undefined for "failed"
\`\`\`

### Good

\`\`\`ts
const labels = { idle: "Idle", failed: "Failed" } satisfies Record<Status, string>;
const text = labels[status];
\`\`\`

With \`satisfies Record<Status, string>\`, a missing entry fails to compile where the table is written.

### Fix

Add the missing entries; the message names them (the first 3, then a count) and suggests \`satisfies Record<…>\`. There is no quick fix, since the values are yours to write. When the table has no fixed keys at all (a registry a hook returns, a server response), the message asks you to give it its real keys (\`Record<"zoom-in" | …, …>\`) or handle a missing entry. When the table comes from a cast (\`(value as Record<string, T>)[key]\`), the message points at the cast, which is what hides the keys.

## What it does not catch

- A read whose type already includes \`undefined\` (an optional property, \`Partial<…>\`, \`noUncheckedIndexedAccess\`): TypeScript already makes you handle it.
- A read checked first with \`key in table\`, \`Object.hasOwn(table, key)\` or \`hasOwnProperty\`, in an \`if\`, before \`&&\`, or in a \`?:\` condition.
- A read stored in a \`const\` whose first use checks for a missing entry (\`toggle?.kbd\`, \`if (!asset)\`, \`Array.isArray(shades)\`), also when it is the fallback of \`??\` or \`||\`.
- A table whose keys come from a generic (\`Record<K, string>\`): the rule cannot see them.
- An enum's reverse lookup (\`Color[value]\`).
- Arrays, tuples and array-likes (\`match[1]\`, \`files[0]\`): they are read by position.
- A key typed \`string\` or \`number\`, with no fixed set of values.
- Writes (\`labels[status] = …\`).

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "records/lookup-misses-key": "off" } // or "warning"
rules: { "records/lookup-misses-key": ["error", { ignore: ["*_LABELS"] }] } // tables checked elsewhere
groups: { "guards/lookups": "off" } // the whole group
\`\`\`
`;

function skipParentheses(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
}

/** `a[k] = v`, `a[k]++`, `delete a[k]`, `[a[k]] = list`, `for (a[k] of list)`: not a read. */
function isWriteTarget(access: ts.Node): boolean {
  let current = skipParentheses(access);
  for (;;) {
    const parent = current.parent;
    const inPattern =
      ts.isArrayLiteralExpression(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      (ts.isPropertyAssignment(parent) && parent.initializer === current);
    if (!inPattern) break;
    current = skipParentheses(parent);
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

function isNothing(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(expression) ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
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

/**
 * The code around the access already deals with a missing value (`?.`, `??`, `!`, a truthiness or
 * `undefined` test). The rule is about code that does not; when this is in doubt it says nothing.
 */
function dealsWithMissing(access: ts.Node): boolean {
  const current = skipParentheses(access);
  const parent = current.parent;
  if (ts.isNonNullExpression(parent) || ts.isTypeOfExpression(parent)) return true;
  if (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isCallExpression(parent)) &&
    parent.expression === current &&
    parent.questionDotToken !== undefined
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(parent)) return parent.operator === ts.SyntaxKind.ExclamationToken;
  if (ts.isIfStatement(parent) || ts.isWhileStatement(parent)) return parent.expression === current;
  if (ts.isConditionalExpression(parent)) return parent.condition === current;
  if (!ts.isBinaryExpression(parent)) return false;
  const { kind } = parent.operatorToken;
  if (FALLBACKS.has(kind)) return parent.left === current;
  if (!EQUALITY.has(kind)) return false;
  return isNothing(parent.left === current ? parent.right : parent.left);
}

function missingHeadline(map: string, missing: readonly string[], access: string): string {
  const keys = listItems(missing);
  return fitted(
    (cut) => `\`${cut(map)}\` has no entry for ${keys}, so \`${cut(access)}\` can be undefined`,
  );
}

function missingHint(map: string): string {
  return fitted(
    (cut) =>
      `add the missing key, or declare \`${cut(map)}\` with \`satisfies Record<…, …>\` so a missing key fails to compile`,
  );
}

/** A key that is one known value (`HttpCode.Ok`): there is nothing to type, only an entry to add. */
function constantKeyHint(map: string): string {
  return fitted((cut) => `add the missing key to \`${cut(map)}\``);
}

/**
 * A constant key on a record with no fixed keys (a registry from a hook, a server response): there
 * is no literal to add an entry to, so the keys need a type, or the read a fallback.
 */
function registryHint(map: string, key: string): string {
  return fitted(
    (cut) =>
      `give \`${cut(map)}\` its real keys (\`Record<${shorten(key, INSERTED_MAX)} | …, …>\`), or handle a missing entry with \`?.\` or \`??\``,
  );
}

/** `(value as Record<string, T>)[key]`: the cast decides that any key is there. */
function castHeadline(value: string, type: string, access: string): string {
  return fitted(
    (cut) =>
      `\`${cut(value)}\` is cast to \`${shorten(type, INSERTED_MAX)}\`, so \`${cut(access)}\` is never checked`,
  );
}

function castHint(value: string): string {
  return fitted(
    (cut) =>
      `the cast hides which keys \`${cut(value)}\` has: type it where it is made, or handle a missing entry with \`??\``,
  );
}

/** The value under `as T` (or `<T>value`), parentheses removed; undefined when there is no cast. */
function castValue(expression: ts.Expression): ts.Expression | undefined {
  const node = stripParentheses(expression);
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    ? stripParentheses(node.expression)
    : undefined;
}

function indexedHeadline(map: string, type: string, access: string): string {
  return fitted(
    (cut) =>
      `\`${cut(map)}\` is typed \`${shorten(type, INSERTED_MAX)}\`, so \`${cut(access)}\` is never checked`,
  );
}

function indexedHint(map: string, key: string): string {
  return fitted(
    (cut) =>
      `declare \`${cut(map)}\` with \`satisfies Record<…>\` over its real keys, or type \`${cut(key)}\` so a missing key is handled`,
  );
}

/**
 * The name the table is declared with (`labels` in `const labels: Record<string, string> = …`),
 * where `records/table-type-too-loose` reports a table typed too loosely.
 */
function tableDeclaration(table: ts.Expression, ctx: FileContext): ts.Node | undefined {
  const symbol = ctx.types.symbolAt(stripParentheses(table));
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const node = declaration?.node;
  if (node === undefined) return undefined;
  return ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) ? node.name : undefined;
}

/** `Color[value]`: an enum object maps names to values and, for numbers, values back to names. */
function isEnumObject(object: ts.Expression, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(stripParentheses(object));
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declaration !== undefined && ts.isEnumDeclaration(declaration.node);
}

function stripParentheses(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParentheses(node.expression) : node;
}

/** The `[object, key]` a call such as `Object.hasOwn(o, k)` or `o.hasOwnProperty(k)` asks about. */
function ownKeyTest(call: ts.CallExpression): readonly [ts.Expression, ts.Expression] | undefined {
  const callee = stripParentheses(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const [first, second] = call.arguments;
  const target = stripParentheses(callee.expression);
  if (callee.name.text === "hasOwn" && ts.isIdentifier(target) && target.text === "Object") {
    return first !== undefined && second !== undefined ? [first, second] : undefined;
  }
  if (callee.name.text === "hasOwnProperty") {
    return first !== undefined && second === undefined ? [target, first] : undefined;
  }
  // `Object.prototype.hasOwnProperty.call(o, k)` passes the object first.
  const viaCall =
    callee.name.text === "call" &&
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "hasOwnProperty";
  return viaCall && first !== undefined && second !== undefined ? [first, second] : undefined;
}

/** Whether `condition` is a test that `key` is present in `object`. */
function testsKey(
  condition: ts.Expression,
  object: string,
  key: string,
  ctx: FileContext,
): boolean {
  const text = (node: ts.Node): string => compactText(node, ctx.sourceFile);
  const inner = stripParentheses(condition);
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.InKeyword) {
    return text(inner.left) === key && text(inner.right) === object;
  }
  if (!ts.isCallExpression(inner)) return false;
  const test = ownKeyTest(inner);
  return test !== undefined && text(test[0]) === object && text(test[1]) === key;
}

/**
 * Whether `condition` being `truth` means the key is present: the test itself when true, its
 * negation when false, either side of `&&` when true, either side of `||` when false.
 */
function establishes(
  condition: ts.Expression,
  truth: boolean,
  object: string,
  key: string,
  ctx: FileContext,
): boolean {
  const inner = stripParentheses(condition);
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.ExclamationToken) {
    return establishes(inner.operand, !truth, object, key, ctx);
  }
  if (ts.isBinaryExpression(inner)) {
    const { kind } = inner.operatorToken;
    const joins = truth ? ts.SyntaxKind.AmpersandAmpersandToken : ts.SyntaxKind.BarBarToken;
    if (kind === joins) {
      return (
        establishes(inner.left, truth, object, key, ctx) ||
        establishes(inner.right, truth, object, key, ctx)
      );
    }
  }
  return truth && testsKey(inner, object, key, ctx);
}

/**
 * The read sits where `key in map`, `Object.hasOwn(map, key)` or `map.hasOwnProperty(key)` (same
 * key and map text) has decided the key is there: in the `then` of an `if`, the right of `&&`, or
 * the `?:` branch the test selects.
 */
function isGuardedByKeyTest(access: ts.ElementAccessExpression, ctx: FileContext): boolean {
  const object = compactText(access.expression, ctx.sourceFile);
  const key = compactText(access.argumentExpression, ctx.sourceFile);
  let child: ts.Node = access;
  for (let node = access.parent; !ts.isSourceFile(node); node = node.parent) {
    if (
      ts.isIfStatement(node) &&
      child !== node.expression &&
      establishes(node.expression, child === node.thenStatement, object, key, ctx)
    ) {
      return true;
    }
    if (
      ts.isConditionalExpression(node) &&
      child !== node.condition &&
      establishes(node.condition, child === node.whenTrue, object, key, ctx)
    ) {
      return true;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.right === child &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      establishes(node.left, true, object, key, ctx)
    ) {
      return true;
    }
    child = node;
  }
  return false;
}

/** The name a lookup table is read by: `labels` for `labels[k]` and `this.labels[k]`. */
function tableName(table: ts.Expression): string | undefined {
  if (ts.isIdentifier(table)) return table.text;
  return ts.isPropertyAccessExpression(table) ? table.name.text : undefined;
}

/**
 * The value is stored in a `const` whose first use checks for a missing entry
 * (`const toggle = actions[id]; toggle?.kbd`), also as the fallback of `??` or `||`
 * (`const asset = icons[name] ?? icons[fallback]; if (!asset) …`).
 */
function storedAndChecked(access: ts.ElementAccessExpression, ctx: FileContext): boolean {
  let current: ts.Node = skipParentheses(access);
  for (;;) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === current &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      current = skipParentheses(parent);
    } else break;
  }
  return (
    (current !== access && dealsWithMissing(current)) || checkedThroughConst(current, ctx.types)
  );
}

function checkAccess(
  node: ts.ElementAccessExpression,
  ignore: readonly string[],
  ctx: FileContext,
): void {
  if (isWriteTarget(node) || dealsWithMissing(node) || storedAndChecked(node, ctx)) return;
  const name = tableName(node.expression);
  if (name !== undefined && matchesName(name, ignore)) return;
  const keys = ctx.types.literalsOf(node.argumentExpression);
  if (keys === "not-finite") return;
  if (keys.some((key) => typeof key.value !== "string" && typeof key.value !== "number")) return;
  const present = ctx.types.propertyKeysOf(node.expression);
  if (present === "not-object" || present === "generic") return;
  const known = new Set([...present.required, ...present.optional]);
  const missing = keys.filter((key) => !known.has(String(key.value)));
  if (missing.length === 0 || ctx.types.canBeUndefined(node)) return;
  if (isEnumObject(node.expression, ctx) || isGuardedByKeyTest(node, ctx)) return;
  const map = oneLineText(node.expression, ctx.sourceFile);
  const access = oneLineText(node, ctx.sourceFile);
  if (present.indexSignature) {
    const key = oneLineText(node.argumentExpression, ctx.sourceFile);
    const type = ctx.types.typeTextOf(node.expression);
    const cast = castValue(node.expression);
    if (cast !== undefined) {
      const value = oneLineText(cast, ctx.sourceFile);
      ctx.report({ node, message: castHeadline(value, type, access), hint: castHint(value) });
      return;
    }
    const [only] = keys;
    const table = tableDeclaration(node.expression, ctx);
    ctx.report({
      node,
      ...(table === undefined ? {} : { about: table }),
      message: indexedHeadline(map, type, access),
      hint:
        keys.length === 1 && only !== undefined
          ? registryHint(map, only.label)
          : indexedHint(map, key),
    });
    return;
  }
  ctx.report({
    node,
    message: missingHeadline(
      map,
      missing.map((key) => key.label),
      access,
    ),
    hint: keys.length === 1 ? constantKeyHint(map) : missingHint(map),
  });
}

export const lookupMissesKey = defineRule({
  kind: "file",
  meta: {
    description:
      "A lookup like labels[status] has an entry for every value of the key, or handles a missing one.",
    defaultSeverity: "error",
    tier: "core",
    group: "keys",
    // A table typed too loosely is one cause: its fix makes every lookup into it checked.
    yieldsTo: ["table-type-too-loose"],
    options: {
      ignore: option.strings({
        default: [],
        description: "Table names (globs like *_LABELS) whose lookups are not checked.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isElementAccessExpression(node)) checkAccess(node, ctx.options.ignore, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
