import ts from "@stateward/core/typescript";
import {
  defineRule,
  matchesName,
  option,
  type FileContext,
  type Fix,
  type OptionsOf,
} from "@stateward/core";
import { rejectionsOf, type CanReject } from "./rejects.js";
import { fitted } from "./text.js";

const EXPLAIN = `# async/pending-state-stuck-on-failure

When the awaited call fails, a state set to "loading" before it stays set and the spinner shows until reload; resetting it in \`finally\` prevents that.

\`\`\`ts example-bad
import { useState } from "react";

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  async function run(query: string): Promise<void> {
    setLoading(true);
    const response = await fetch(\`/api/search?q=\${query}\`);
    setResults((await response.json()) as string[]);
    setLoading(false);
  }

  return { loading, results, run };
}
\`\`\`

Clear the state in a \`finally\`, so it is cleared whether the call works or fails:

\`\`\`ts example-good
import { useState } from "react";

export function useSearch() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  async function run(query: string): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch(\`/api/search?q=\${query}\`);
      setResults((await response.json()) as string[]);
    } finally {
      setLoading(false);
    }
  }

  return { loading, results, run };
}
\`\`\`

When the code is a plain run (a write, some awaited statements, then the write again as the last statement of the same block, no \`try\`) and the write again clears the state (\`false\`, \`null\`, \`undefined\`), the editor's quick fix wraps the middle in \`try { … } finally { … }\`. In every other shape there is no quick fix: what a failure should leave is your call. When success writes a value only success makes true (\`setStatus("saved")\`, the call's result), write what a failure means in a \`catch\`: \`catch (error) { setStatus("failed"); throw error; }\`. A \`catch\` that writes the state also counts, as long as the code after the \`try\` does too.

## Why it matters

\`setLoading(true); await search(); setLoading(false);\` works until \`search()\` fails. The function stops at the \`await\`, \`setLoading(false)\` never runs, and the spinner stays on until the page is reloaded. The same goes for \`setStatus("saving")\` before a save and \`setStatus("saved")\` after it: a failed save shows "saving" for ever.

## What it does not catch

It reads the shape of the code, not the names: in one function, state that outlives the call is written (\`setLoading(true)\`, \`this.isSaving = true\`, \`state.phase = "loading"\`, \`setState({ status: "loading" })\`), then a call that can reject is awaited, then the state is written again, but a failure, an early \`return\` or a \`throw\` in between skips that. A promise chain that writes it again only in \`.then()\` counts too. "State that outlives the call" is a setter (\`set…\` with one argument) or a place not declared inside the function: a field of \`this\`, a parameter's field, a module-level variable, a \`useState\` setter of the component around a handler. The finding is on the first write. It does not see:

- state written through \`this.setState({ loading: true })\`, or a setter with more than one argument;
- state that is never written again in the same function, or is written again in a different one;
- a variable declared inside the function: it is gone when the function fails;
- an \`await\` of a call it cannot see rejecting: a package function with no facts, a function received as a value or a prop (\`this.props.actions.save()\`), a declared function with no body;
- a call whose promise settles with its error in the value (\`unwrap()\`, RTK Query's triggers): it does not reject.

A call can reject when stateward can see that it does: \`fetch\`, a request of \`axios\`, \`ky\`, \`ofetch\`, \`got\`, \`node-fetch\` or \`superagent\`, a package function your config's \`facts\` say rejects or throws, \`Promise.all\` of one of those, or a function of your project that throws or awaits one of those outside a \`try\` that catches (followed four calls deep).

It guesses what the code means, so it is a warning in every preset, and it is wrong when the failure is handled somewhere it cannot see, such as a caller that always resets the state: say so above the line with \`// stateward-ignore async/pending-state-stuck-on-failure: <why>\`, or list the state's name under \`ignore\`.

## Getting the best from it

Keep a request in one union instead of separate flags: \`{ kind: "idle" } | { kind: "loading" } | { kind: "failed"; error: Error } | { kind: "ready"; data: T }\`, and set its failed case in a \`catch\`. Then "loading but also failed" cannot happen, and every screen decides what a failure shows.

Say what cannot fail, and the rule believes it: \`facts: { "my-client": { save: { rejects: [] } } }\` for a package function, a JSDoc \`/** @neverRejects */\` on your own function (not looked into any deeper), or a setter whose type has a member nothing can fill (\`| { status: "failed"; error: never }\`). Say what a package function does reject with \`facts: { "my-client": { save: { rejects: ["Error"] } } }\`.

## Turn it on or off

\`\`\`ts
rules: { "async/pending-state-stuck-on-failure": "off" } // or "error"
rules: { "async/pending-state-stuck-on-failure": ["warning", { ignore: ["*Draft"] }] } // states set again elsewhere
\`\`\`
`;

const OPTIONS = {
  ignore: option.strings({
    default: [],
    description:
      "State names (globs like *Busy) that are set again somewhere this rule cannot see.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

/**
 * Whether a write is to state that outlives the function: a setter or a place not declared as a
 * variable inside the innermost function around `at` (`this.busy`, a parameter's field, a
 * module-level variable, a `useState` setter of the component around a handler).
 */
type Tracked = (name: string, root: ts.Identifier | undefined, at: ts.Node) => boolean;

function trackedWith(settings: Settings, ctx: FileContext): Tracked {
  return (name, root, at) => {
    if (matchesName(name, settings.ignore)) return false;
    if (root === undefined) return true;
    const symbol = ctx.types.symbolAt(root);
    const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
    if (declaration?.file !== ctx.file) return true;
    const fn = enclosingFunction(at);
    const node = declaration.node;
    const local =
      fn !== undefined &&
      node.getStart(ctx.sourceFile) >= fn.getStart(ctx.sourceFile) &&
      node.getEnd() <= fn.getEnd() &&
      !isParameterOf(node, fn);
    return !local;
  };
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let at = node.parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionLike(at)) return at;
  }
  return undefined;
}

function isParameterOf(node: ts.Node, fn: ts.SignatureDeclaration): boolean {
  for (let at: ts.Node = node; at !== fn; at = at.parent) {
    if (ts.isParameter(at)) return true;
  }
  return false;
}

/** A write as it is in the code: the setter call or the assigned place. */
type Flag = { kind: "call" | "assign"; target: string; name: string };
type FlagUse = { flag: Flag; value: ts.Expression };

function compact(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, "");
}

function lastName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  return ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
}

/** The variable a place starts from: `state` of `state.items.count`; undefined for `this`. */
function rootOf(node: ts.Expression): ts.Identifier | undefined {
  if (ts.isIdentifier(node)) return node;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return rootOf(node.expression);
  }
  return undefined;
}

/** `setLoading(true)` as `loading`, `setIsSaving(false)` as `isSaving`. */
function setterFlagName(setter: string): string | undefined {
  const match = /^set([A-Z].*)$/.exec(setter);
  const rest = match?.[1];
  return rest === undefined ? undefined : `${rest.slice(0, 1).toLowerCase()}${rest.slice(1)}`;
}

/** What an expression writes: `setLoading(true)`, `this.status = "saving"`, `state.items = []`. */
function flagUse(node: ts.Node, sourceFile: ts.SourceFile, tracked: Tracked): FlagUse | undefined {
  if (ts.isCallExpression(node)) {
    const setter = lastName(node.expression);
    const [argument, ...rest] = node.arguments;
    const name = setter === undefined ? undefined : setterFlagName(setter);
    if (name === undefined || argument === undefined || rest.length > 0) return undefined;
    if (!tracked(name, rootOf(node.expression), node)) return undefined;
    return {
      flag: { kind: "call", target: compact(node.expression, sourceFile), name },
      value: argument,
    };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const name = lastName(node.left);
    if (name === undefined || !tracked(name, rootOf(node.left), node)) return undefined;
    return {
      flag: { kind: "assign", target: compact(node.left, sourceFile), name },
      value: node.right,
    };
  }
  return undefined;
}

function sameFlag(a: Flag, b: Flag): boolean {
  return a.kind === b.kind && a.target === b.target;
}

type Scope = { sourceFile: ts.SourceFile; flag: Flag; tracked: Tracked; rejects: CanReject };

/** The statement is exactly `place = value` / `setPlace(value)` for the same place. */
function isSetAgain(statement: ts.Node, scope: Scope): boolean {
  if (!ts.isExpressionStatement(statement)) return false;
  const use = flagUse(statement.expression, scope.sourceFile, scope.tracked);
  return use !== undefined && sameFlag(use.flag, scope.flag);
}

/** Where the state is set again inside the node, also in a callback; undefined when nowhere. */
function resetIn(node: ts.Node | undefined, scope: Scope): FlagUse | undefined {
  if (node === undefined) return undefined;
  const visit = (child: ts.Node): FlagUse | undefined => {
    const use = flagUse(child, scope.sourceFile, scope.tracked);
    if (use !== undefined && sameFlag(use.flag, scope.flag)) return use;
    return ts.forEachChild(child, visit);
  };
  return visit(node);
}

function resetsIn(node: ts.Node | undefined, scope: Scope): boolean {
  return resetIn(node, scope) !== undefined;
}

/** The first `await` in source order whose call can reject, not looking inside nested functions. */
function firstFailingAwait(node: ts.Node, scope: Scope): ts.AwaitExpression | undefined {
  const visit = (child: ts.Node): ts.AwaitExpression | undefined => {
    if (ts.isAwaitExpression(child) && scope.rejects(child.expression)) return child;
    if (ts.isFunctionLike(child)) return undefined;
    return ts.forEachChild(child, visit);
  };
  return visit(node);
}

/** The first `await` (or `for await`) in source order, not looking inside nested functions. */
function firstAwait(node: ts.Node): ts.AwaitExpression | ts.ForOfStatement | undefined {
  const visit = (child: ts.Node): ts.AwaitExpression | ts.ForOfStatement | undefined => {
    if (ts.isAwaitExpression(child)) return child;
    if (ts.isForOfStatement(child) && child.awaitModifier !== undefined) return child;
    if (ts.isFunctionLike(child)) return undefined;
    return ts.forEachChild(child, visit);
  };
  return visit(node);
}

type Walk = { leak: boolean; on: boolean };

/**
 * Walks statements in order while the flag is on, and says whether the function can be left with
 * it still on (an `await` that fails, a `throw` or a `return`) and whether it is still on at the
 * end. `caught` is true inside a `try` that has a `catch`, where a failure goes to the `catch`.
 */
function walkList(statements: readonly ts.Statement[], caught: boolean, scope: Scope): Walk {
  let leak = false;
  for (const statement of statements) {
    const step = walkStatement(statement, caught, scope);
    leak = leak || step.leak;
    if (!step.on) return { leak, on: false };
  }
  return { leak, on: true };
}

function walkStatement(statement: ts.Statement, caught: boolean, scope: Scope): Walk {
  const failsHere = (node: ts.Node | undefined): boolean =>
    !caught && node !== undefined && firstFailingAwait(node, scope) !== undefined;
  if (isSetAgain(statement, scope)) return { leak: false, on: false };
  if (ts.isReturnStatement(statement)) return { leak: true, on: false };
  if (ts.isThrowStatement(statement)) return { leak: !caught, on: false };
  if (ts.isBlock(statement)) return walkList(statement.statements, caught, scope);
  if (ts.isLabeledStatement(statement)) return walkStatement(statement.statement, caught, scope);
  if (ts.isTryStatement(statement)) return walkTry(statement, caught, scope);
  if (ts.isIfStatement(statement)) {
    const then = walkStatement(statement.thenStatement, caught, scope);
    const otherwise =
      statement.elseStatement === undefined
        ? { leak: false, on: true }
        : walkStatement(statement.elseStatement, caught, scope);
    return {
      leak: failsHere(statement.expression) || then.leak || otherwise.leak,
      on: then.on || otherwise.on,
    };
  }
  if (ts.isSwitchStatement(statement)) {
    const clauses = statement.caseBlock.clauses.map((clause) =>
      walkList(clause.statements, caught, scope),
    );
    const hasDefault = statement.caseBlock.clauses.some(ts.isDefaultClause);
    return {
      leak: failsHere(statement.expression) || clauses.some((clause) => clause.leak),
      on: !(hasDefault && clauses.every((clause) => !clause.on)),
    };
  }
  if (
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement)
  ) {
    const body = walkStatement(statement.statement, caught, scope);
    const others =
      ts.isDoStatement(statement) || ts.isWhileStatement(statement)
        ? statement.expression
        : ts.isForStatement(statement)
          ? statement.condition
          : statement.expression;
    return { leak: failsHere(others) || body.leak, on: true };
  }
  return { leak: failsHere(statement), on: true };
}

function walkTry(statement: ts.TryStatement, caught: boolean, scope: Scope): Walk {
  // A `finally` that sets the flag back runs on every way out, so nothing inside can leak.
  if (resetsIn(statement.finallyBlock, scope)) return { leak: false, on: false };
  const inner = walkList(
    statement.tryBlock.statements,
    caught || statement.catchClause !== undefined,
    scope,
  );
  if (statement.catchClause === undefined) return inner;
  const handler = walkList(statement.catchClause.block.statements, caught, scope);
  return { leak: inner.leak || handler.leak, on: inner.on || handler.on };
}

function isOwnTryBlock(parent: ts.Node, node: ts.Node): parent is ts.TryStatement {
  return ts.isTryStatement(parent) && parent.tryBlock === node;
}

/**
 * An enclosing `try` whose `catch` or `finally` sets the flag back covers everything inside it.
 * The walk stops at the function around the container, or at the file for a block at the top of
 * a module (`if (…) { … }` outside any function), whose parent is not set.
 */
function coveredByEnclosingTry(container: ts.Node, scope: Scope): boolean {
  let node = container;
  for (
    let parent = node.parent;
    !ts.isFunctionLike(parent) && !ts.isSourceFile(parent);
    parent = parent.parent
  ) {
    if (
      isOwnTryBlock(parent, node) &&
      (resetsIn(parent.finallyBlock, scope) || resetsIn(parent.catchClause, scope))
    ) {
      return true;
    }
    node = parent;
  }
  return false;
}

type Container = ts.Block | ts.CaseClause | ts.DefaultClause;

/** What the message names as the thing that fails: `search()`, `api.save()`, `request`. */
type Awaited = { text: string; call: boolean };

function oneLine(node: ts.Node): string {
  return node.getText().replace(/\s+/g, " ").trim();
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isVoidExpression(node)
    ? unwrap(node.expression)
    : node;
}

/** The expression a promise comes from: a call is shown as `callee()`, without its arguments. */
function awaitedOf(expression: ts.Expression): Awaited {
  const inner = unwrap(expression);
  return ts.isCallExpression(inner)
    ? { text: oneLine(inner.expression), call: true }
    : { text: oneLine(inner), call: false };
}

function shownAwaited(awaited: Awaited, cut: (text: string) => string): string {
  return `${cut(awaited.text)}${awaited.call ? "()" : ""}`;
}

function headline(flag: Flag, value: string, awaited: Awaited): string {
  return fitted(
    (cut) =>
      `\`${cut(flag.name)}\` stays \`${cut(value)}\` when \`${shownAwaited(awaited, cut)}\` fails`,
  );
}

/**
 * A write that clears the state (`false`, `null`, `undefined`): right after a failure as much as
 * after success, so it can move to a `finally`. A value like `"saved"` or the call's result is
 * true only after success: a failure needs its own write, in a `catch`.
 */
function clears(node: ts.Expression): boolean {
  return (
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  );
}

/**
 * A first write that clears (`false`, `""`, `[]`, `{ error: null }`): a state emptied before the
 * call is not pending when the call fails, so it is not followed.
 */
function isEmptying(node: ts.Expression): boolean {
  if (clears(node)) return true;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text === "";
  if (ts.isNumericLiteral(node)) return node.text === "0";
  if (ts.isArrayLiteralExpression(node)) return node.elements.length === 0;
  if (ts.isParenthesizedExpression(node)) return isEmptying(node.expression);
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.every(
      (property) => ts.isPropertyAssignment(property) && isEmptying(property.initializer),
    )
  );
}

function writeCode(flag: Flag, value: string): string {
  return flag.kind === "call" ? `${flag.target}(${value});` : `${flag.target} = ${value};`;
}

function hint(flag: Flag, reset: FlagUse | undefined, awaited: Awaited): string {
  const value = reset === undefined ? undefined : oneLine(reset.value);
  if (reset !== undefined && value !== undefined && clears(reset.value)) {
    return fitted(
      (cut) =>
        `set \`${cut(flag.name)}\` again in a \`finally\`, so a failure resets it too: \`try { await ${shownAwaited(awaited, cut)}; } finally { ${cut(writeCode(flag, value))} }\``,
    );
  }
  return fitted(
    (cut) =>
      `set \`${cut(flag.name)}\` in a \`catch\` too, so a failure resets it: \`try { await ${shownAwaited(awaited, cut)}; … } catch (error) { ${cut(writeCode(flag, "…"))} throw error; }\``,
  );
}

type Report = {
  node: ts.Node;
  flag: Flag;
  /** The value set before the await, as written. */
  value: string;
  /** Where it is set again after the await. */
  reset: FlagUse | undefined;
  awaited: Awaited;
  fix: Fix | undefined;
};

/** `p.then(a).catch(b).finally(c)` as its calls in the order they run, with the call it starts from. */
function chainOf(
  expression: ts.Expression,
): { root: ts.Expression; links: readonly ts.CallExpression[] } | undefined {
  const links: ts.CallExpression[] = [];
  let current = unwrap(expression);
  while (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ["then", "catch", "finally"].includes(current.expression.name.text)
  ) {
    links.unshift(current);
    current = unwrap(current.expression.expression);
  }
  return links.length === 0 ? undefined : { root: current, links };
}

function linkName(link: ts.CallExpression): string {
  return ts.isPropertyAccessExpression(link.expression) ? link.expression.name.text : "";
}

/** The write again that only a successful `.then()` runs, with nothing after it that handles a failure. */
function chainLeak(links: readonly ts.CallExpression[], scope: Scope): FlagUse | undefined {
  let handled = false;
  let bad: FlagUse | undefined;
  for (const link of links) {
    const [first, second] = link.arguments;
    switch (linkName(link)) {
      case "finally":
        if (resetsIn(link, scope)) return undefined;
        break;
      case "catch":
        if (resetsIn(link, scope)) return undefined;
        handled = true;
        break;
      default:
        if (resetsIn(second, scope)) return undefined;
        if (second !== undefined) handled = true;
        if (!handled) bad ??= resetIn(first, scope);
    }
  }
  return bad;
}

function chainReport(
  statements: readonly ts.Statement[],
  from: number,
  first: { node: ts.Node; value: string },
  scope: Scope,
): Report | undefined {
  for (const statement of statements.slice(from + 1)) {
    if (isSetAgain(statement, scope)) return undefined;
    const expression =
      ts.isExpressionStatement(statement) || ts.isReturnStatement(statement)
        ? statement.expression
        : undefined;
    const chain = expression === undefined ? undefined : chainOf(expression);
    const reset =
      chain === undefined || !scope.rejects(chain.root) ? undefined : chainLeak(chain.links, scope);
    if (chain === undefined || reset === undefined) continue;
    return {
      node: first.node,
      flag: scope.flag,
      value: first.value,
      reset,
      awaited: awaitedOf(chain.root),
      fix: undefined,
    };
  }
  return undefined;
}

function hasMultilineTemplate(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const visit = (child: ts.Node): boolean =>
    ((ts.isNoSubstitutionTemplateLiteral(child) || ts.isTemplateExpression(child)) &&
      child.getText(sourceFile).includes("\n")) ||
    ts.forEachChild(child, visit) === true;
  return visit(node);
}

function containsTry(node: ts.Node): boolean {
  return ts.isTryStatement(node) || ts.forEachChild(node, containsTry) === true;
}

/** Set; awaited statements; set back as the last statement of the block: wrap the middle in try/finally. */
function wrapFix(
  statements: readonly ts.Statement[],
  from: number,
  reset: number,
  file: string,
  sourceFile: ts.SourceFile,
): Fix | undefined {
  const middle = statements.slice(from + 1, reset);
  const [first] = middle;
  const last = middle.at(-1);
  const closing = statements[reset];
  if (first === undefined || last === undefined || closing === undefined) return undefined;
  if (reset !== statements.length - 1) return undefined;
  if (middle.some((statement) => containsTry(statement))) return undefined;
  if (middle.some((statement) => hasMultilineTemplate(statement, sourceFile))) return undefined;
  const text = sourceFile.text;
  const start = first.getStart(sourceFile);
  if (text.slice(last.getEnd(), closing.getStart(sourceFile)).trim() !== "") return undefined;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  const lineStart = start - character;
  const indent = text.slice(lineStart, start);
  if (indent.trim() !== "" || line < 0) return undefined;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text
    .slice(start, last.getEnd())
    .split(/\r?\n/)
    .map((row, index) => (index === 0 || row.trim() === "" ? row : `  ${row}`))
    .join(newline);
  const newText = [
    "try {",
    `${indent}  ${body}`,
    `${indent}} finally {`,
    `${indent}  ${closing.getText(sourceFile)}`,
    `${indent}}`,
  ].join(newline);
  return {
    title: "Reset the state in a finally",
    edits: [{ location: { file, start, end: closing.getEnd() }, newText }],
  };
}

/** The fields that hold a failure: a union member whose one is typed `never` cannot happen. */
const FAILURE_FIELDS: ReadonlySet<string> = new Set(["error", "reason"]);

/**
 * Whether the state's own type says failure is impossible: the setter takes a union with a member
 * like `{ status: "failed"; error: never }`. Only a setter shows the type; a place assigned
 * (`this.state = …`) holds a value, not the union.
 */
function cannotFail(use: FlagUse, ctx: FileContext): boolean {
  return (
    use.flag.kind === "call" &&
    ctx.types.neverFieldsOf(use.value).some((field) => FAILURE_FIELDS.has(field))
  );
}

function analyze(
  container: Container,
  ctx: FileContext,
  tracked: Tracked,
  rejects: CanReject,
): void {
  const { statements } = container;
  statements.forEach((statement, index) => {
    if (!ts.isExpressionStatement(statement)) return;
    const use = flagUse(statement.expression, ctx.sourceFile, tracked);
    // A write whose value waits for a call is the result arriving, not a state set before it.
    if (use === undefined || firstAwait(use.value) !== undefined || isEmptying(use.value)) return;
    const scope: Scope = { sourceFile: ctx.sourceFile, flag: use.flag, tracked, rejects };
    if (coveredByEnclosingTry(container, scope)) return;
    const first = { node: statement.expression, value: oneLine(use.value) };
    const found =
      chainReport(statements, index, first, scope) ??
      mainReport(statements, index, first, scope, ctx);
    // A state whose type has a failure member that nothing can fill (`error: never`) says the
    // request cannot fail. Asked last: it is a type question, and most writes are not reported.
    if (found === undefined || cannotFail(use, ctx)) return;
    const fixes = found.fix === undefined ? [] : [found.fix];
    ctx.report({
      node: found.node,
      message: headline(found.flag, found.value, found.awaited),
      hint: hint(found.flag, found.reset, found.awaited),
      fixes,
    });
  });
}

/** Between the state set and the same state set again, an await can fail or the code can leave early. */
function mainReport(
  statements: readonly ts.Statement[],
  from: number,
  first: { node: ts.Node; value: string },
  scope: Scope,
  ctx: FileContext,
): Report | undefined {
  const reset = statements.findIndex(
    (statement, index) => index > from && isSetAgain(statement, scope),
  );
  const closing = statements[reset];
  if (reset < 0 || closing === undefined || !ts.isExpressionStatement(closing)) return undefined;
  const again = flagUse(closing.expression, scope.sourceFile, scope.tracked);
  const middle = statements.slice(from + 1, reset);
  const awaitedNode = middle
    .map((statement) => firstFailingAwait(statement, scope))
    .find((found) => found !== undefined);
  if (awaitedNode === undefined) return undefined;
  if (!walkList(middle, false, scope).leak) return undefined;
  return {
    node: first.node,
    flag: scope.flag,
    value: first.value,
    reset: again,
    awaited: awaitedOf(awaitedNode.expression),
    fix:
      again !== undefined && clears(again.value)
        ? wrapFix(statements, from, reset, ctx.file, ctx.sourceFile)
        : undefined,
  };
}

export const pendingStateStuckOnFailure = defineRule({
  kind: "file",
  meta: {
    description:
      'When the awaited call fails, a state set to "loading" before it stays set and the spinner shows until reload; resetting it in `finally` prevents that.',
    summary: 'a "loading" state set before an `await` that stays set when the call fails',
    defaultSeverity: "warning",
    tier: "core",
    group: "failures",
    heuristic: true,
    options: OPTIONS,
    explain: EXPLAIN,
    // `@neverRejects` is read from the project's JSDoc.
    needsJsDoc: true,
  },
  check(ctx) {
    const tracked = trackedWith(ctx.options, ctx);
    const rejects = rejectionsOf(ctx);
    const visit = (node: ts.Node): void => {
      if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        analyze(node, ctx, tracked, rejects);
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
