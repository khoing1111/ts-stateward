import ts from "@stateward/core/typescript";
import { defineRule } from "@stateward/core";
import type { FileContext, Fix } from "@stateward/core";
import { example, resultShapeOf, shorten, type ResultShape } from "./result-type.js";

const EXPLAIN = `# errors/result-unchecked

A call that returns its failure instead of throwing never reaches the \`catch\`; without a check, the code after it runs as if the call worked.

\`\`\`ts example-bad
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

declare function saveSettings(values: string): Promise<Result<void>>;
declare function toast(text: string): void;

export async function submit(values: string): Promise<void> {
  const result = await saveSettings(values);
  if (!result.ok) toast("Could not save");
  toast("Saved");
}
\`\`\`

When it failed, stop there: \`return\` (or \`throw\`) in the check:

\`\`\`ts example-good
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

declare function saveSettings(values: string): Promise<Result<void>>;
declare function toast(text: string): void;

export async function submit(values: string): Promise<void> {
  const result = await saveSettings(values);
  if (!result.ok) {
    toast("Could not save");
    return;
  }
  toast("Saved");
}
\`\`\`

For an RTK Query trigger, add \`.unwrap()\` so a failure throws: \`await deletePlan(id).unwrap()\`. Where the result is dropped, a quick fix adds it.

## Why it matters

Some calls do not throw when they fail: they resolve to data or an error. An RTK Query trigger without \`.unwrap()\` is the common one. Wrap \`await deletePlan(id)\` in a \`try\` and the \`catch\` never runs: a failed delete still shows "Deleted" and closes the dialog. Store the result and show its error without stopping, and the lines after still run: "Saved" appears after a save that failed.

## When it says “not checked”

An \`if\` that tests the result in a way stateward cannot read (\`if (result.error && isApiError(result.error))\`) is listed as a place not checked. Test it in one of the ways below, then narrow further inside.

## What it does not catch

It looks at a call whose value is data or an error: a promise with an \`unwrap()\` method that resolves to a union with an \`error\` member (RTK Query's triggers, found by the type, not by a name), or a Result as \`errors/result-ignored\` recognises it. It reports such a call when:

- it is awaited as a statement inside a \`try\` whose \`catch\` nothing else can reach (no call before it, no other \`await\` or \`throw\` in the \`try\`): the \`catch\` never runs;
- it is awaited as a statement inside a \`try\` after another call (an optimistic \`setFolders(…)\`), with more lines after it: when it fails, those lines run and the \`catch\` (the rollback) does not;
- a trigger is awaited as a statement outside a \`try\`, with more lines after it (\`await sendReply(x); setText("")\`);
- it is stored, then its data is read before it is checked;
- it is stored, and its error is read in an \`if\` that does not \`return\` or \`throw\` (\`"error" in result\`, \`result.error\`, \`!result.ok\`, or an \`error\` or \`isError\` taken out of it), with more lines after that \`if\`.

It is silent on:

- a Result dropped as a statement: that is \`errors/result-ignored\`;
- lines after the call that only set back a pending state set before it (\`setSaving(true)\` … \`setSaving(false)\`): they run either way on purpose;
- a \`try\` with another \`await\` or a \`throw\` in it: the \`catch\` may be there for that;
- a result passed on, returned, stored elsewhere, or checked in a callback;
- a promise that rejects on failure (react-query's \`mutateAsync\`, \`fetch\`): it has no \`unwrap()\` that resolves to data or an error.

## Getting the best from it

Code that says what it means is left alone: \`void trigger(…)\`, \`.unwrap()\`, a check (\`"error" in result\`, \`if (result.error) return\`, \`isOk(result)\`, \`const { data, isError } = await dispatch(…); if (isError) throw …\`) before the success path, an \`if\` with an \`else\` for the success path, and a component that reads the trigger's own \`isError\` or \`error\` from its hook (\`const [save, { isError }] = useSaveMutation()\`).

## Turn it on or off

\`\`\`ts
rules: { "errors/result-unchecked": "off" } // or "error"
\`\`\`
`;

/** The longest call an example line shows before its arguments become `…`. */
const CALL_MAX = 60;
/** The longest condition the fix hint quotes. */
const CONDITION_MAX = 50;

/** What the value is: an RTK-like trigger (`unwrap()`, data or error), or a Result of a known shape. */
type Kind = "trigger" | Exclude<ResultShape, "named">;

/** A property destructured from the result, by what reading it says. */
type AliasKind = "error" | "data" | "ok";

/** How the result is reached after it is stored: its name, or the names destructured from it. */
type Tracked = {
  readonly whole: string | undefined;
  readonly aliases: ReadonlyMap<string, AliasKind>;
  readonly callee: string;
  readonly kind: Kind;
};

/** Whether a test is true when the call failed, when it worked, cannot be read, or does not look at the result. */
type Polarity = "failure" | "success" | "undecided" | "none";

// `isError` and `isSuccess`: an RTK Query state (`await dispatch(api.endpoints.x.initiate(…))`)
// carries them next to `data` and `error`, and testing one is as much a check as testing `error`.
const ALIAS_KINDS: ReadonlyMap<string, AliasKind> = new Map<string, AliasKind>([
  ["error", "error"],
  ["isError", "error"],
  ["data", "data"],
  ["value", "data"],
  ["ok", "ok"],
  ["success", "ok"],
  ["isSuccess", "ok"],
]);
const DATA_PROPERTIES = new Set(["data", "value"]);
const SUCCESS_PROPERTIES = new Set(["data", "value", "ok", "success"]);
const FAILURE_GUARD = /^is(?:Err|Error|Failure|Failed)$/;
const SUCCESS_GUARD = /^is(?:Ok|Success|Succeeded)$/;

function strip(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? strip(expression.expression) : expression;
}

function flip(polarity: Polarity): Polarity {
  if (polarity === "failure") return "success";
  if (polarity === "success") return "failure";
  return polarity;
}

/** The kind of data-or-error value a call gives, or undefined when it is something else. */
function kindOf(call: ts.CallExpression, awaited: boolean, ctx: FileContext): Kind | undefined {
  const shape = resultShapeOf(call, ctx.types, []);
  if (shape !== undefined) return shape === "named" ? undefined : shape;
  return awaited && ctx.types.settlesWithError(call) ? "trigger" : undefined;
}

function calleeText(call: ts.CallExpression, ctx: FileContext): string {
  return call.expression.getText(ctx.sourceFile).replace(/\s+/g, "");
}

/** The call as an example line shows it: whole, or its callee and `(…)` when long. */
function callText(call: ts.CallExpression, ctx: FileContext): string {
  const whole = shorten(call.getText(ctx.sourceFile), Number.MAX_SAFE_INTEGER);
  return whole.length > CALL_MAX
    ? `${shorten(call.expression.getText(ctx.sourceFile), CALL_MAX)}(…)`
    : whole;
}

/** The line that returns when the call failed, in the result's own shape and names. */
function checkLine(tracked: Tracked): string {
  const errorAlias = [...tracked.aliases].find(([, kind]) => kind === "error")?.[0];
  if (tracked.whole === undefined && errorAlias !== undefined) return `if (${errorAlias}) return;`;
  const name = tracked.whole ?? "result";
  switch (tracked.kind) {
    case "trigger":
      return `if ("error" in ${name}) return;`;
    case "ok":
      return `if (!${name}.ok) return;`;
    case "success":
      return `if (!${name}.success) return;`;
    case "isErr":
      return `if (${name}.isErr()) return;`;
    default: {
      const unreachable: never = tracked.kind;
      return unreachable;
    }
  }
}

/** Whether an identifier is a name read as a value (not `x.name`, not a property's key). */
function isValueName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  return true;
}

function someNode(node: ts.Node, test: (node: ts.Node) => boolean): boolean {
  if (test(node)) return true;
  return ts.forEachChild(node, (child) => someNode(child, test)) === true;
}

function findNode(node: ts.Node, test: (node: ts.Node) => boolean): ts.Node | undefined {
  if (test(node)) return node;
  return ts.forEachChild(node, (child) => findNode(child, test));
}

function mentions(node: ts.Node, tracked: Tracked): boolean {
  return someNode(
    node,
    (one) =>
      ts.isIdentifier(one) &&
      isValueName(one) &&
      (one.text === tracked.whole || tracked.aliases.has(one.text)),
  );
}

/**
 * Whether `node` sits where a test of the result has already said the call worked:
 * `ok ? r.data : …`, `"data" in r && r.data`, `r.error || r.data`, or an `if` branch.
 */
function guarded(node: ts.Node, stop: ts.Node, tracked: Tracked): boolean {
  let child = node;
  while (child !== stop) {
    const parent = child.parent;
    let test: ts.Expression | undefined;
    let when: Polarity | undefined;
    if (ts.isConditionalExpression(parent) && child !== parent.condition) {
      test = parent.condition;
      when = child === parent.whenTrue ? "success" : "failure";
    } else if (ts.isIfStatement(parent) && child !== parent.expression) {
      test = parent.expression;
      when = child === parent.thenStatement ? "success" : "failure";
    } else if (ts.isBinaryExpression(parent) && child === parent.right) {
      const operator = parent.operatorToken.kind;
      test = parent.left;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) when = "success";
      if (operator === ts.SyntaxKind.BarBarToken) when = "failure";
    }
    if (test !== undefined && when !== undefined && polarity(test, tracked) === when) return true;
    child = parent;
  }
  return false;
}

/**
 * `result.data`, or a `data` destructured from it, read where no test has said the call worked.
 * Only a trigger's data can be read unchecked: a Result's `value` exists only on its success
 * member, so TypeScript itself refuses to read it before a check.
 */
function readsData(statement: ts.Statement, tracked: Tracked): boolean {
  if (tracked.kind !== "trigger") return false;
  return someNode(statement, (one) => {
    const read =
      (ts.isPropertyAccessExpression(one) &&
        ts.isIdentifier(one.expression) &&
        one.expression.text === tracked.whole &&
        DATA_PROPERTIES.has(one.name.text)) ||
      (ts.isIdentifier(one) && isValueName(one) && tracked.aliases.get(one.text) === "data");
    return read && !guarded(one, statement, tracked);
  });
}

function isWhole(expression: ts.Expression, tracked: Tracked): boolean {
  const code = strip(expression);
  return ts.isIdentifier(code) && code.text === tracked.whole;
}

/** `undefined`, `null`, `true` or `false` as written, or undefined for anything else. */
function literalOf(expression: ts.Expression): "nullish" | "true" | "false" | undefined {
  const code = strip(expression);
  if (code.kind === ts.SyntaxKind.NullKeyword) return "nullish";
  if (ts.isIdentifier(code) && code.text === "undefined") return "nullish";
  if (code.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (code.kind === ts.SyntaxKind.FalseKeyword) return "false";
  return undefined;
}

const EQUAL = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken]);
const NOT_EQUAL = new Set([
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** `a === undefined`, `a !== null`, `a === false`: the polarity of `a` as a truthy test, turned by the comparison. */
function comparedPolarity(expression: ts.BinaryExpression, tracked: Tracked): Polarity {
  const operator = expression.operatorToken.kind;
  const rightLiteral = literalOf(expression.right);
  const literal = rightLiteral ?? literalOf(expression.left);
  const other = rightLiteral === undefined ? expression.left : expression.right;
  if (literal === undefined) return mentions(expression, tracked) ? "undecided" : "none";
  const base = polarity(other, tracked);
  if (base !== "failure" && base !== "success") return base;
  // `x === true` keeps the test; `x === undefined`, `x === null` and `x === false` turn it.
  const keeps = literal === "true";
  if (EQUAL.has(operator)) return keeps ? base : flip(base);
  return keeps ? flip(base) : base;
}

/** What an `if` condition says about the stored result (design: errors.md, result-unchecked). */
function polarity(expression: ts.Expression, tracked: Tracked): Polarity {
  const code = strip(expression);
  if (ts.isPrefixUnaryExpression(code) && code.operator === ts.SyntaxKind.ExclamationToken) {
    return flip(polarity(code.operand, tracked));
  }
  if (ts.isIdentifier(code)) {
    const alias = tracked.aliases.get(code.text);
    if (alias === "error") return "failure";
    if (alias !== undefined) return "success";
    return code.text === tracked.whole ? "undecided" : "none";
  }
  if (ts.isPropertyAccessExpression(code) && isWhole(code.expression, tracked)) {
    if (code.name.text === "error") return "failure";
    return SUCCESS_PROPERTIES.has(code.name.text) ? "success" : "undecided";
  }
  if (ts.isCallExpression(code)) {
    const callee = strip(code.expression);
    if (ts.isPropertyAccessExpression(callee) && isWhole(callee.expression, tracked)) {
      if (callee.name.text === "isErr") return "failure";
      if (callee.name.text === "isOk") return "success";
    }
    const [argument] = code.arguments;
    if (
      ts.isIdentifier(callee) &&
      code.arguments.length === 1 &&
      argument !== undefined &&
      isWhole(argument, tracked)
    ) {
      if (FAILURE_GUARD.test(callee.text)) return "failure";
      if (SUCCESS_GUARD.test(callee.text)) return "success";
    }
  }
  if (ts.isBinaryExpression(code)) {
    const operator = code.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.InKeyword &&
      ts.isStringLiteral(code.left) &&
      isWhole(code.right, tracked)
    ) {
      if (code.left.text === "error") return "failure";
      return DATA_PROPERTIES.has(code.left.text) ? "success" : "undecided";
    }
    if (EQUAL.has(operator) || NOT_EQUAL.has(operator)) return comparedPolarity(code, tracked);
  }
  return mentions(code, tracked) ? "undecided" : "none";
}

/** Whether a statement always leaves the block it is in: `return`, `throw`, `break`, `continue`. */
function exits(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  ) {
    return true;
  }
  if (ts.isBlock(statement)) return statement.statements.some(exits);
  if (ts.isIfStatement(statement)) {
    return (
      exits(statement.thenStatement) &&
      statement.elseStatement !== undefined &&
      exits(statement.elseStatement)
    );
  }
  return false;
}

function isFunctionLike(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassLike(node);
}

/** Whether `node` has a descendant passing `test`, without entering nested functions. */
function inBody(node: ts.Node, test: (node: ts.Node) => boolean): boolean {
  if (test(node)) return true;
  return ts.forEachChild(node, (child) => !isFunctionLike(child) && inBody(child, test)) === true;
}

/**
 * Whether the component reads the trigger's own failure from its hook: `const [save, { isError }]
 * = useSaveMutation()`, or `const [save, saving] = …` and `saving.error` read. Failure is then
 * handled through the hook's result (stated intent), so code after the call may run either way.
 */
function hookStateRead(call: ts.CallExpression, ctx: FileContext): boolean {
  const callee = strip(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  const reads = new Set(["isError", "error"]);
  const hook = findNode(ctx.sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isArrayBindingPattern(node.name)) return false;
    const [trigger] = node.name.elements;
    return (
      trigger !== undefined &&
      ts.isBindingElement(trigger) &&
      ts.isIdentifier(trigger.name) &&
      trigger.name.text === callee.text
    );
  });
  if (hook === undefined || !ts.isVariableDeclaration(hook)) return false;
  if (!ts.isArrayBindingPattern(hook.name)) return false;
  const second = hook.name.elements[1];
  if (second === undefined || !ts.isBindingElement(second)) return false;
  const found = second.name;
  if (ts.isObjectBindingPattern(found)) {
    return found.elements.some((element) => {
      const key = element.propertyName ?? element.name;
      return ts.isIdentifier(key) && reads.has(key.text);
    });
  }
  if (!ts.isIdentifier(found)) return false;
  const name = found.text;
  return someNode(
    ctx.sourceFile,
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name &&
      reads.has(node.name.text),
  );
}

/** `await call(…);` as a statement: the call, or undefined. */
function droppedAwait(statement: ts.Statement): ts.CallExpression | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const awaited = strip(statement.expression);
  if (!ts.isAwaitExpression(awaited)) return undefined;
  const call = strip(awaited.expression);
  return ts.isCallExpression(call) ? call : undefined;
}

function reachesCatch(node: ts.Node): boolean {
  return inBody(
    node,
    (one) =>
      ts.isAwaitExpression(one) ||
      ts.isThrowStatement(one) ||
      ts.isYieldExpression(one) ||
      (ts.isForOfStatement(one) && one.awaitModifier !== undefined),
  );
}

function callsSomething(node: ts.Node): boolean {
  return inBody(
    node,
    (one) =>
      ts.isCallExpression(one) || ts.isNewExpression(one) || ts.isTaggedTemplateExpression(one),
  );
}

/**
 * Case (a): `try { await trigger(x); … } catch { … }`. When only the trigger could reach the
 * `catch`, the `catch` never runs. When a call before it could (`schema.parse(values)`, an
 * optimistic `setFolders(…)`), the `catch` may be for that call, but the lines after the trigger
 * still run when it failed, and the `catch` (a rollback) does not.
 */
function checkTry(statement: ts.TryStatement, ctx: FileContext): void {
  if (statement.catchClause === undefined) return;
  const statements = statement.tryBlock.statements;
  const found: (readonly [ts.Statement, ts.CallExpression])[] = [];
  let callBefore = false;
  for (const inner of statements) {
    const call = droppedAwait(inner);
    if (call !== undefined && kindOf(call, true, ctx) === "trigger") {
      found.push([inner, call]);
      continue;
    }
    if (reachesCatch(inner)) return;
    if (found.length === 0 && callsSomething(inner)) callBefore = true;
  }
  if (callBefore) {
    for (const [inner, call] of found) {
      const index = statements.indexOf(inner);
      const after = statements.slice(index + 1);
      if (after.every((next) => undoesPending(next, statements.slice(0, index)))) continue;
      if (hookStateRead(call, ctx)) continue;
      ctx.report({
        node: inner,
        message: `code after the call runs even when \`${calleeText(call, ctx)}(…)\` failed, and the \`catch\` does not`,
        hint: [
          'add `.unwrap()` so a failure reaches the `catch` (quick fix), or check `"error" in result` and return:',
          example([
            `const result = await ${callText(call, ctx)};`,
            `if ("error" in result) return;`,
          ]),
        ].join("\n"),
        fixes: [unwrapFix(call, "Add `.unwrap()` so a failure reaches the `catch`", ctx)],
      });
    }
    return;
  }
  for (const [inner, call] of found) {
    ctx.report({
      // The statement, as `errors/result-ignored` reports it, so that rule can yield to this one.
      node: inner,
      message: `\`catch\` never runs for \`${calleeText(call, ctx)}(…)\`: it does not throw when it fails`,
      hint: [
        'add `.unwrap()` (quick fix), or check `"error" in result` and return, so the code after it does not run on failure:',
        example([`const result = await ${callText(call, ctx)};`, `if ("error" in result) return;`]),
      ].join("\n"),
      fixes: [unwrapFix(call, "Add `.unwrap()` so a failure reaches the `catch`", ctx)],
    });
  }
}

function unwrapFix(call: ts.CallExpression, title: string, ctx: FileContext): Fix {
  const at = call.getEnd();
  return {
    title,
    edits: [
      { location: { file: ctx.sourceFile.fileName, start: at, end: at }, newText: ".unwrap()" },
    ],
  };
}

/** A state setter by its name: `setSaving`, `form.setBusy`. */
const SETTER = /^set[A-Z_]/;

/**
 * The target a statement sets, as written: `setSaving` in `setSaving(false)`, `state.busy` in
 * `state.busy = false`. Only a setter counts: `toast("Saving…")` before and `toast("Saved")` after
 * are two messages, not a pending state set back.
 */
function setTarget(statement: ts.Statement): string | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const code = strip(statement.expression);
  if (ts.isCallExpression(code) && code.arguments.length === 1) {
    const callee = strip(code.expression);
    const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    if (!ts.isIdentifier(name) || !SETTER.test(name.text)) return undefined;
    return code.expression.getText().replace(/\s+/g, "");
  }
  if (ts.isBinaryExpression(code) && code.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return code.left.getText().replace(/\s+/g, "");
  }
  return undefined;
}

/**
 * Whether a statement after the call only sets back a pending state set before it
 * (`setSaving(true)` … `setSaving(false)`): that runs on success and failure alike on purpose,
 * so it is not the code going on as if the call worked.
 */
function undoesPending(statement: ts.Statement, before: readonly ts.Statement[]): boolean {
  if (ts.isReturnStatement(statement) && statement.expression === undefined) return true;
  const target = setTarget(statement);
  return target !== undefined && before.some((earlier) => setTarget(earlier) === target);
}

/** Whether `node` is in the `try` block of a `try` statement, in the same function. */
function inTry(node: ts.Node): boolean {
  for (let child = node; !ts.isSourceFile(child); child = child.parent) {
    if (isFunctionLike(child)) return false;
    if (ts.isTryStatement(child.parent) && child.parent.tryBlock === child) return true;
  }
  return false;
}

/**
 * `await sendReply(x);` dropped outside a `try`, with lines after it: they run even when it
 * failed (the reply the user typed is cleared). Inside a `try` it is `checkTry`'s.
 */
function checkDropped(statement: ts.ExpressionStatement, ctx: FileContext): void {
  const call = droppedAwait(statement);
  if (call === undefined) return;
  const parent = statement.parent;
  if (!ts.isBlock(parent) && !ts.isSourceFile(parent) && !ts.isCaseClause(parent)) return;
  if (inTry(statement)) return;
  const siblings = parent.statements;
  const index = siblings.indexOf(statement);
  const before = siblings.slice(0, index);
  const after = siblings.slice(index + 1);
  // The type questions after the syntax that rules most statements out.
  if (after.every((next) => undoesPending(next, before))) return;
  if (kindOf(call, true, ctx) !== "trigger" || hookStateRead(call, ctx)) return;
  ctx.report({
    node: statement,
    message: `code after the call runs even when \`${calleeText(call, ctx)}(…)\` failed`,
    hint: [
      'add `.unwrap()` so a failure throws (quick fix), or check `"error" in result` and return:',
      example([`const result = await ${callText(call, ctx)};`, `if ("error" in result) return;`]),
    ].join("\n"),
    fixes: [unwrapFix(call, "Add `.unwrap()` so a failure stops the function", ctx)],
  });
}

/** What a stored result is reached by: `const r = …` or `const { data, error } = …`. */
function trackedOf(
  declaration: ts.VariableDeclaration,
  call: ts.CallExpression,
  kind: Kind,
  ctx: FileContext,
): Tracked | undefined {
  const callee = calleeText(call, ctx);
  if (ts.isIdentifier(declaration.name)) {
    return { whole: declaration.name.text, aliases: new Map(), callee, kind };
  }
  if (!ts.isObjectBindingPattern(declaration.name)) return undefined;
  const aliases = new Map<string, AliasKind>();
  for (const element of declaration.name.elements) {
    if (element.dotDotDotToken !== undefined || !ts.isIdentifier(element.name)) return undefined;
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key)) return undefined;
    const alias = ALIAS_KINDS.get(key.text);
    if (alias !== undefined) aliases.set(element.name.text, alias);
  }
  return aliases.size === 0 ? undefined : { whole: undefined, aliases, callee, kind };
}

function goesOnHeadline(tracked: Tracked, after: "statement" | "if"): string {
  const what = after === "if" ? "the `if`" : "the call";
  return `code after ${what} runs even when \`${tracked.callee}(…)\` failed`;
}

/**
 * The statements that run after a check that is the last of its list: those after the enclosing
 * `if` branch, `try` block or plain block, outward, within the same function. It stops at the
 * function, at a loop, a `catch`, a `finally` and a `case`.
 */
function followingStatements(statement: ts.Statement): readonly ts.Statement[] {
  let node: ts.Node = statement;
  for (;;) {
    const parent: ts.Node = node.parent;
    if (ts.isIfStatement(parent)) {
      node = parent;
      continue;
    }
    if (!ts.isBlock(parent)) return [];
    const current = node;
    const later = parent.statements.slice(
      parent.statements.findIndex((one) => one === current) + 1,
    );
    if (later.length > 0) return later;
    const owner: ts.Node = parent.parent;
    const walksOut =
      ts.isIfStatement(owner) ||
      ts.isBlock(owner) ||
      (ts.isTryStatement(owner) && owner.tryBlock === parent);
    if (!walksOut) return [];
    node = owner;
  }
}

/** `return result;` or `return result.data;`: the failure is handed to the caller at once. */
function returnsResult(statement: ts.Statement, tracked: Tracked): boolean {
  if (!ts.isReturnStatement(statement) || statement.expression === undefined) return false;
  const code = strip(statement.expression);
  if (isWhole(code, tracked)) return true;
  return (
    ts.isPropertyAccessExpression(code) &&
    isWhole(code.expression, tracked) &&
    DATA_PROPERTIES.has(code.name.text)
  );
}

/** What the statements after a stored result do with it, before anything is reported. */
type StoredOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "undecided"; readonly test: ts.Expression }
  | {
      readonly kind: "goes-on";
      readonly test: ts.Expression;
      readonly after: readonly ts.Statement[];
    }
  | { readonly kind: "reads-data" };

/**
 * Case (b), read from syntax alone: the statements after a stored result, until it is checked,
 * passed on or read. `tracked.kind` matters only to `readsData` (a trigger's data).
 */
function storedOutcome(rest: readonly ts.Statement[], tracked: Tracked): StoredOutcome {
  for (const [index, next] of rest.entries()) {
    if (ts.isIfStatement(next)) {
      const test = polarity(next.expression, tracked);
      if (test === "undecided") return { kind: "undecided", test: next.expression };
      if (test !== "none") {
        const failed = test === "failure" ? next.thenStatement : next.elseStatement;
        const worked = test === "failure" ? next.elseStatement : next.thenStatement;
        if (failed === undefined || worked !== undefined || exits(failed)) return { kind: "none" };
        const later = rest.slice(index + 1);
        return {
          kind: "goes-on",
          test: next.expression,
          after: later.length > 0 ? later : followingStatements(next),
        };
      }
    }
    if (index === 0 && returnsResult(next, tracked)) return { kind: "none" };
    if (readsData(next, tracked)) return { kind: "reads-data" };
    if (mentions(next, tracked) || exits(next)) return { kind: "none" };
  }
  return { kind: "none" };
}

/** Case (b): reports what `storedOutcome` found. */
function followStored(
  statement: ts.VariableStatement,
  before: readonly ts.Statement[],
  rest: readonly ts.Statement[],
  tracked: Tracked,
  call: ts.CallExpression,
  ctx: FileContext,
): void {
  const outcome = storedOutcome(rest, tracked);
  switch (outcome.kind) {
    case "none":
      return;
    case "undecided":
      ctx.unknown({
        node: outcome.test,
        message: `not checked: whether the \`if\` tests that \`${tracked.callee}(…)\` failed: it does not test the result itself`,
        hint: `test the result itself, as in \`${checkLine(tracked)}\`, so the check can be followed`,
      });
      return;
    case "goes-on": {
      if (outcome.after.every((one) => undoesPending(one, before)) || hookStateRead(call, ctx)) {
        return;
      }
      ctx.report({
        node: outcome.test,
        message: goesOnHeadline(tracked, "if"),
        hint: [
          "end the branch that handles the failure with `return` (or `throw`):",
          example([
            `if (${shorten(outcome.test.getText(ctx.sourceFile), CONDITION_MAX)}) {`,
            "  // … what it shows now",
            "  return;",
            "}",
          ]),
        ].join("\n"),
      });
      return;
    }
    case "reads-data": {
      if (hookStateRead(call, ctx)) return;
      const data =
        tracked.whole === undefined
          ? ([...tracked.aliases].find(([, kind]) => kind === "data")?.[0] ?? "data")
          : `${tracked.whole}.data`;
      ctx.report({
        node: statement,
        message: goesOnHeadline(tracked, "statement"),
        hint: [
          `check that it worked before reading \`${data}\`, and return when it failed:`,
          example([checkLine(tracked)]),
        ].join("\n"),
      });
      return;
    }
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

function checkDeclaration(statement: ts.VariableStatement, ctx: FileContext): void {
  const parent = statement.parent;
  if (!ts.isBlock(parent) && !ts.isSourceFile(parent) && !ts.isCaseClause(parent)) return;
  const [declaration] = statement.declarationList.declarations;
  if (declaration?.initializer === undefined) return;
  if (statement.declarationList.declarations.length !== 1) return;
  const value = strip(declaration.initializer);
  const awaited = ts.isAwaitExpression(value);
  const call = strip(awaited ? value.expression : value);
  if (!ts.isCallExpression(call)) return;
  const siblings = parent.statements;
  const index = siblings.indexOf(statement);
  const rest = siblings.slice(index + 1);
  // The type question last: most stored calls are read or passed on
  // before any test, and then nothing is said whatever they give. The kind matters only to a
  // trigger's data, which only an awaited call can be; a trigger read finds the most.
  const probe = trackedOf(declaration, call, awaited ? "trigger" : "ok", ctx);
  if (probe === undefined || storedOutcome(rest, probe).kind === "none") return;
  const kind = kindOf(call, awaited, ctx);
  if (kind === undefined) return;
  const tracked = trackedOf(declaration, call, kind, ctx);
  if (tracked === undefined) return;
  followStored(statement, siblings.slice(0, index), rest, tracked, call, ctx);
}

export const resultUnchecked = defineRule({
  kind: "file",
  meta: {
    description:
      "A call that returns its failure instead of throwing never reaches the `catch`; without a check, the code after it runs as if the call worked.",
    summary:
      "a call that fails in its value (an RTK Query trigger, a Result) used as if it had worked",
    defaultSeverity: "warning",
    tier: "core",
    group: "callers",
    heuristic: true,
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isTryStatement(node)) checkTry(node, ctx);
      if (ts.isVariableStatement(node)) checkDeclaration(node, ctx);
      if (ts.isExpressionStatement(node)) checkDropped(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
