import ts from "@stateward/core/typescript";
import {
  defineRule,
  matchesName,
  neverRejectsFactOf,
  option,
  type FileContext,
  type Fix,
  type Json,
  type Literal,
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

- a class component's state set from a value computed elsewhere or an updater (\`this.setState(next)\`, \`this.setState((prev) => …)\`): only an object written in place (\`this.setState({ saving: true })\`) says what is running; a setter with more than one argument;
- state that is never written again in the same function, or is written again in a different one;
- a variable declared inside the function: it is gone when the function fails;
- an \`await\` of a call it cannot see rejecting: a package function with no facts, a function received as a value or a prop (\`this.props.actions.save()\`), a declared function with no body;
- a call whose promise settles with its error in the value (\`unwrap()\`, RTK Query's triggers): it does not reject.

A call can reject when stateward can see that it does: \`fetch\`, a request of \`axios\`, \`ky\`, \`ofetch\`, \`got\`, \`node-fetch\` or \`superagent\`, a package function your config's \`facts\` say rejects or throws, \`Promise.all\` of one of those, a \`.then\` or \`.catch\` callback written in place that throws or returns one of those, or a function of your project that throws or awaits one of those outside a \`try\` that catches (every function it calls is read; a \`throw\` after a value typed \`never\` cannot run).

It guesses what the code means, so it is a warning in every preset, and it is wrong when the failure is handled somewhere it cannot see, such as a caller that always resets the state: say so above the line with \`// stateward-ignore async/pending-state-stuck-on-failure: <why>\`, or list the state's name under \`ignore\`.

## Getting the best from it

### State it: \`Pending\`

The checks above read the shape of the code. A state stated \`Pending\` says which of its values mean "in progress", and the rule then proves two things for every function that sets it to one, with no guessing:

\`\`\`ts
// src/guarantees.ts
export type Pending<T, Running extends T = Extract<T, true>> = T & {
  readonly "__guarantee:pending"?: Running;
};

const [saving, setSaving] = useState<Pending<boolean>>(false); // true means running
status: Pending<"idle" | "saving" | "saved" | "failed", "saving"> = "idle"; // "saving" means running
\`\`\`

- **It settles:** every way out of the function (success, a failed \`await\`, an early \`return\`, a \`throw\`) leaves a value that is not running. Every \`await\` counts as one that can fail, except of a promise a \`facts\` line states \`neverRejects: true\`. The fix names the value the declaration starts with, in \`finally\`; for a union, each other value that is not running (\`"failed"\`) in a \`catch\`.
- **It does not start twice:** an async function that sets it returns early while it runs, \`if (savingRef.current) return;\` (a ref, because a state value read in a handler can be one render old, so two quick clicks both see \`false\`), or the control is disabled with it (\`disabled={saving}\` in the same file).

For \`boolean\` the running value is \`true\`; for any other type, name it: a \`Pending\` with no running value is reported. These findings are errors, since the guarantee is stated and proven strictly (the kind \`stated\` under \`severities\` changes that); unmarked state keeps the checks above, as warnings.

### One state for an async result

\`loading\`, \`error\` and \`data\` side by side can contradict each other: loading and failed at once, data from the previous request next to a new error. One union holds them without contradictions:

\`\`\`ts
type Save =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "failed"; error: Error }
  | { status: "saved"; savedAt: Date };
\`\`\`

A data library's own status (React Query, SWR, RTK Query) is the same thing. When the function a finding is about also writes other state, its note names them: "\`saving\`, \`saveError\` and \`savedAt\` are written together here". Nothing rewrites the state for you: which states exist is a design choice.

### Say what cannot fail

Say what cannot fail, and the rule believes it: \`facts: { "my-client": { save: { neverRejects: true } } }\` for a package function or a promise property (shipped for RTK Query's \`cacheEntryRemoved\`), a JSDoc \`/** @neverRejects */\` on your own function (not looked into any deeper), or a setter whose type has a member nothing can fill (\`| { status: "failed"; error: never }\`). Say what a package function does reject with \`facts: { "my-client": { save: { rejects: ["Error"] } } }\`.

## Turn it on or off

\`\`\`ts
rules: { "async/pending-state-stuck-on-failure": "off" } // or "error"
rules: { "async/pending-state-stuck-on-failure": ["warning", { ignore: ["*Draft"] }] } // states set again elsewhere
rules: { "async/pending-state-stuck-on-failure": ["warning", { severities: { stated: "warning" } }] } // stated ones as warnings too
\`\`\`
`;

const OPTIONS = {
  ignore: option.strings({
    default: [],
    description:
      "State names (globs like *Busy) that are set again somewhere this rule cannot see.",
  }),
  severities: option.severities({
    kinds: {
      stated:
        "a state stated `Pending` that does not settle, starts twice, or names no running value: an error unless set here.",
      shape: "unmarked state read from the shape of the code: the rule's severity (a warning).",
    },
    description: "A severity per kind of finding.",
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

type Scope = {
  sourceFile: ts.SourceFile;
  flag: Flag;
  tracked: Tracked;
  rejects: CanReject;
  /** The value the state is set to before the work (`true`), when known: setting it again is no reset. */
  running?: string;
};

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
    if (
      ts.isAwaitExpression(child) &&
      scope.rejects(child.expression) &&
      !chainResets(child.expression, scope)
    ) {
      return child;
    }
    if (ts.isFunctionLike(child)) return undefined;
    return ts.forEachChild(child, visit);
  };
  return visit(node);
}

/**
 * Whether a chain sets the state again where a failure runs: in a `.catch` or `.finally`
 * callback, or the second callback of a `.then` (`await save().catch((e) => { setBusy(false);
 * throw e; })`). The failure still goes on, but the state is not left behind.
 */
function chainResets(expression: ts.Expression, scope: Scope): boolean {
  const chain = chainOf(expression);
  if (chain === undefined) return false;
  return chain.links.some((link) => {
    const name = linkName(link);
    // The callback itself: the link also holds the chain before it, whose `.then` runs on success.
    const callback = name === "catch" || name === "finally" ? link.arguments[0] : link.arguments[1];
    return setsOtherValue(callback, scope);
  });
}

/** Whether the node sets the state to a value other than the one it ran with (`setLoading(true)` again is not a reset). */
function setsOtherValue(node: ts.Node | undefined, scope: Scope): boolean {
  if (node === undefined) return false;
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    const use = flagUse(child, scope.sourceFile, scope.tracked);
    if (
      use !== undefined &&
      sameFlag(use.flag, scope.flag) &&
      (scope.running === undefined || compact(use.value, scope.sourceFile) !== scope.running)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
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
/** What is awaited, as shown: a call's callee, and whether it was called and with arguments. */
type Awaited = { text: string; call: boolean; args: boolean };

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

/**
 * The expression a promise comes from: a call is shown as `callee()`, or `callee(…)` when it has
 * arguments, so `search().catch(…)` does not read as a `.catch` with no callback.
 */
function awaitedOf(expression: ts.Expression): Awaited {
  const inner = unwrap(expression);
  return ts.isCallExpression(inner)
    ? { text: oneLine(inner.expression), call: true, args: inner.arguments.length > 0 }
    : { text: oneLine(inner), call: false, args: false };
}

function shownAwaited(awaited: Awaited, cut: (text: string) => string): string {
  return `${cut(awaited.text)}${awaited.call ? (awaited.args ? "(…)" : "()") : ""}`;
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
 * `this.setState(next)` or `this.setState((prev) => …)`: a class component's state replaced as a
 * whole marks nothing as running. Only an object written in place names the keys it sets.
 */
function replacesClassState(use: FlagUse): boolean {
  return (
    use.flag.kind === "call" &&
    use.flag.target === "this.setState" &&
    !ts.isObjectLiteralExpression(unwrap(use.value))
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
    if (use === undefined || firstAwait(use.value) !== undefined) return;
    // A state stated `Pending` says which values mean running: no guessing from its shape.
    const pending = pendingOf(use, ctx);
    if (pending !== undefined) {
      analyzePending(container, index, use, pending, ctx, tracked);
      return;
    }
    // A write whose value waits for a call is the result arriving, not a state set before it.
    if (isEmptying(use.value)) return;
    if (replacesClassState(use)) return;
    const scope: Scope = {
      sourceFile: ctx.sourceFile,
      flag: use.flag,
      tracked,
      rejects,
      running: compact(use.value, ctx.sourceFile),
    };
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
      related: oneStateNote(statement, use.flag, ctx, tracked),
      findingKind: "shape",
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

/** The trait `Pending<T, Running>` states: `"__guarantee:pending"?: Running`. */
export const PENDING = "pending";

/**
 * A state stated `Pending`: the values that mean running, every value of its type (when finite),
 * and the value its declaration starts with, as written.
 */
type PendingState = {
  running: readonly Literal[];
  values: readonly Literal[] | undefined;
  start: string | undefined;
  /** The state's declaration: where the trait is stated. */
  declaration: ts.Node | undefined;
};

/** The node a write is made by: the setter call, or the assignment. */
function writeNode(use: FlagUse): ts.Node {
  return use.value.parent;
}

/** The first argument of the `useState(…)` call a setter comes from: `false` in `useState(false)`. */
function stateOfSetter(
  setter: ts.Node,
  ctx: FileContext,
):
  | { state: ts.Node | undefined; start: ts.Expression | undefined; declaration: ts.Node }
  | undefined {
  const symbol = ctx.types.symbolAt(setter);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined) return undefined;
  const node = declared.node;
  if (!ts.isBindingElement(node) || !ts.isArrayBindingPattern(node.parent)) return undefined;
  const pattern = node.parent;
  const [first] = pattern.elements;
  const state = first !== undefined && ts.isBindingElement(first) ? first.name : undefined;
  const holder = pattern.parent;
  const call =
    ts.isVariableDeclaration(holder) && holder.initializer !== undefined
      ? holder.initializer
      : undefined;
  const start = call !== undefined && ts.isCallExpression(call) ? call.arguments[0] : undefined;
  return { state, start, declaration: holder };
}

/** The value a field or variable starts with: `"idle"` in `status: Pending<…> = "idle"`. */
function startOfPlace(
  place: ts.Expression,
  ctx: FileContext,
): { start: ts.Expression | undefined; declaration: ts.Node | undefined } {
  const name = ts.isPropertyAccessExpression(place) ? place.name : place;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const node = declared?.node;
  if (node !== undefined && (ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node))) {
    return { start: node.initializer, declaration: node };
  }
  return { start: undefined, declaration: node };
}

/** The `Pending` trait of the state a write writes, or undefined when it is not stated. */
function pendingOf(use: FlagUse, ctx: FileContext): PendingState | undefined {
  if (!ctx.types.declaresTrait(PENDING)) return undefined;
  const node = writeNode(use);
  if (ts.isCallExpression(node)) {
    const running = ctx.types.guaranteeValuesOf(use.value, PENDING, true);
    if (running === undefined || running === "not-finite") return undefined;
    const found = stateOfSetter(unwrap(node.expression), ctx);
    const values = found?.state === undefined ? "not-finite" : ctx.types.literalsOf(found.state);
    return {
      running,
      values: values === "not-finite" ? undefined : values,
      start: found?.start === undefined ? undefined : oneLine(found.start),
      declaration: found?.declaration,
    };
  }
  if (ts.isBinaryExpression(node)) {
    const running = ctx.types.guaranteeValuesOf(node.left, PENDING);
    if (running === undefined || running === "not-finite") return undefined;
    const values = ctx.types.literalsOf(node.left);
    const found = startOfPlace(node.left, ctx);
    return {
      running,
      values: values === "not-finite" ? undefined : values,
      start: found.start === undefined ? undefined : oneLine(found.start),
      declaration: found.declaration,
    };
  }
  return undefined;
}

/** Whether a write sets a running value: `setSaving(true)`, `this.status = "saving"`. */
function setsRunning(value: ts.Expression, pending: PendingState, ctx: FileContext): boolean {
  const written = ctx.types.literalsOf(value);
  return (
    written !== "not-finite" &&
    written.length > 0 &&
    written.every((one) => pending.running.some((run) => run.label === one.label))
  );
}

function isRunningLabel(label: string, pending: PendingState): boolean {
  return pending.running.some((run) => run.label === label);
}

/** The running values as a headline names them: `true`, `"saving"`. */
function runningText(pending: PendingState): string {
  return pending.running.map((run) => `\`${run.label}\``).join(" or ");
}

/**
 * The fix of a `Pending` state that does not settle (M22): the value it starts with, in `finally`;
 * for a union, each other value that is not running, in a `catch`, named from the type.
 */
function pendingHint(flag: Flag, pending: PendingState, success: string | undefined): string {
  const settled = (pending.values ?? []).filter((one) => !isRunningLabel(one.label, pending));
  const start =
    pending.start !== undefined && !isRunningLabel(pending.start, pending)
      ? pending.start
      : settled[0]?.label;
  const first =
    start === undefined
      ? `set \`${flag.name}\` back in \`finally\`, to a value that is not running`
      : `set \`${flag.name}\` back in \`finally\`: \`finally { ${writeCode(flag, start)} }\``;
  const others = settled
    .map((one) => one.label)
    .filter((label) => label !== start && label !== success && label !== "undefined");
  if (others.length === 0 || pending.values?.every((one) => typeof one.value === "boolean")) {
    return first;
  }
  return [
    "one of",
    `- ${first}`,
    ...others.map(
      (label) =>
        `- or set it to ${label} in a \`catch\`: \`catch (error) { ${writeCode(flag, label)} throw error; }\``,
    ),
  ].join("\n");
}

/** The name a function is known by in a headline: `save`, or "the function". */
function functionName(fn: ts.SignatureDeclaration | undefined): string {
  if (fn === undefined) return "the function";
  const name = fn.name ?? (ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined);
  return name !== undefined && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name))
    ? `\`${name.text}\``
    : "the function";
}

/** Whether `fn` returns early while the state runs, before the write at `at`, or a control is disabled with it. */
function guardsStart(
  fn: ts.SignatureDeclaration,
  at: ts.Node,
  flag: Flag,
  ctx: FileContext,
): boolean {
  const name = new RegExp(`\\b${flag.name}(?:Ref)?\\b`);
  const visit = (node: ts.Node): boolean => {
    if (node.getStart(ctx.sourceFile) >= at.getStart(ctx.sourceFile)) return false;
    if (node !== fn && ts.isFunctionLike(node)) return false;
    if (
      ts.isIfStatement(node) &&
      name.test(node.expression.getText(ctx.sourceFile)) &&
      leaves(node.thenStatement)
    ) {
      return true;
    }
    return ts.forEachChild(node, visit) === true;
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined && visit(body)) return true;
  // `disabled={saving}` on the control: a second click cannot start it.
  return new RegExp(`disabled=\\{[^}]*\\b${flag.name}\\b`).test(ctx.sourceFile.text);
}

/** A statement that leaves the function: `return`, `throw`, or a block ending in one. */
function leaves(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return last !== undefined && leaves(last);
  }
  return false;
}

/** Whether a function's body holds an `await` (not in a nested function). */
function hasAwait(fn: ts.SignatureDeclaration): boolean {
  const body = "body" in fn ? fn.body : undefined;
  return body !== undefined && firstAwait(body) !== undefined;
}

/**
 * The note on a pending finding when the same function also writes other state (an error, the
 * data): one status union holds them without contradictions. Undefined when it writes no other.
 */
function oneStateNote(
  at: ts.Node,
  flag: Flag,
  ctx: FileContext,
  tracked: Tracked,
): { node: ts.Node; message: string }[] {
  const fn = enclosingFunction(at);
  const body = fn !== undefined && "body" in fn ? fn.body : undefined;
  if (body === undefined) return [];
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    const use = flagUse(node, ctx.sourceFile, tracked);
    if (use !== undefined && use.flag.name !== flag.name && !names.includes(use.flag.name)) {
      names.push(use.flag.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (names.length === 0) return [];
  const all = [flag.name, ...names].map((name) => `\`${name}\``);
  const listed = `${all.slice(0, -1).join(", ")} and ${all.at(-1) ?? ""}`;
  return [
    {
      node: at,
      message: `${listed} are written together here: one status union holds them without contradictions`,
    },
  ];
}

/**
 * A write of a running value to a state stated `Pending`: it must settle on every way out of the
 * function (any \`await\` may fail, an early \`return\` or \`throw\` leaves), and the function must
 * not start while the state runs.
 */
function analyzePending(
  container: Container,
  index: number,
  use: FlagUse,
  pending: PendingState,
  ctx: FileContext,
  tracked: Tracked,
): void {
  const { statements } = container;
  const statement = statements[index];
  if (statement === undefined || !ts.isExpressionStatement(statement)) return;
  if (pending.running.length === 0) return;
  if (!setsRunning(use.value, pending, ctx)) return;
  // Every await may fail, except one the facts say never rejects: the state says it must settle,
  // so nothing is left to guess.
  const scope: Scope = {
    sourceFile: ctx.sourceFile,
    flag: use.flag,
    tracked,
    rejects: (expression) => neverRejectsFactOf(expression, ctx) === undefined,
  };
  const fn = enclosingFunction(statement);
  const stated =
    pending.declaration === undefined
      ? []
      : [{ node: pending.declaration, message: `\`${use.flag.name}\` is stated \`Pending\` here` }];
  const related = [...stated, ...oneStateNote(statement, use.flag, ctx, tracked)];
  if (!coveredByEnclosingTry(container, scope)) {
    const first = { node: statement.expression, value: oneLine(use.value) };
    const reset = statements.findIndex((one, at) => at > index && isSetAgain(one, scope));
    const found =
      chainReport(statements, index, first, scope) ??
      (reset < 0 ? undefined : mainReport(statements, index, first, scope, ctx));
    const success = found?.reset === undefined ? undefined : oneLine(found.reset.value);
    if (found !== undefined) {
      ctx.report({
        node: found.node,
        message: headline(found.flag, found.value, found.awaited),
        hint: pendingHint(use.flag, pending, success),
        fixes: found.fix === undefined ? [] : [found.fix],
        related,
        findingKind: "stated",
        stated: true,
      });
    } else if (reset < 0 && !resetsLater(statement, fn, scope)) {
      ctx.report({
        node: statement.expression,
        message: fitted(
          (cut) =>
            `\`${cut(use.flag.name)}\` stays \`${cut(first.value)}\` after ${functionName(fn)} returns`,
        ),
        hint: pendingHint(use.flag, pending, undefined),
        related,
        findingKind: "stated",
        stated: true,
      });
    }
  }
  if (fn === undefined || !hasAwait(fn) || guardsStart(fn, statement, use.flag, ctx)) return;
  const name = use.flag.name;
  const running = runningText(pending);
  ctx.report({
    node: statement.expression,
    message: fitted(
      (cut) => `${functionName(fn)} starts again while \`${cut(name)}\` is ${running}`,
    ),
    hint: [
      "one of",
      `- return early while it runs, read from a ref (state read in a handler can be one render old): \`if (${name}Ref.current) return;\``,
      `- or disable the control while it runs: \`disabled={${name}}\``,
    ].join("\n"),
    related: stated,
    findingKind: "stated",
    stated: true,
  });
}

/** Whether the state is set back after `statement` anywhere in the function: in a nested block, a callback. */
function resetsLater(
  statement: ts.Statement,
  fn: ts.SignatureDeclaration | undefined,
  scope: Scope,
): boolean {
  const body = fn !== undefined && "body" in fn ? fn.body : undefined;
  if (body === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node.getStart(scope.sourceFile) > statement.getEnd() && resetsIn(node, scope)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/**
 * A `Pending` that names no running value: `Pending<Status>` where `Status` has no `true`, so
 * nothing says which values mean "in progress" and nothing can be proven.
 */
function checkRunningValues(node: ts.TypeReferenceNode, ctx: FileContext): void {
  const [type] = node.typeArguments ?? [];
  if (type === undefined) return;
  if (!ctx.types.guaranteesOf(node).includes(PENDING)) return;
  const running = ctx.types.guaranteeValuesOf(node, PENDING);
  if (running === undefined || running === "not-finite" || running.length > 0) return;
  const written = oneLine(type);
  let declaration: ts.Node = node;
  while (
    !ts.isSourceFile(declaration) &&
    !ts.isVariableDeclaration(declaration) &&
    !ts.isPropertyDeclaration(declaration)
  ) {
    declaration = declaration.parent;
  }
  ctx.report({
    node,
    related: ts.isSourceFile(declaration)
      ? []
      : [{ node: declaration, message: `\`${oneLine(node)}\` is stated here` }],
    findingKind: "stated",
    stated: true,
    message: fitted((cut) => `\`${cut(oneLine(node))}\` names no running value`),
    hint: fitted(
      (cut) =>
        `say which values of \`${cut(written)}\` mean running: \`Pending<${cut(written)}, "…">\``,
    ),
  });
}

type Place = { file: string; start: number; end: number };

/**
 * What the rule keeps of a file for `stateward guarantees`, hover and code lens: the states it
 * declares `Pending` with their running values, and its writes of a running value, each with the
 * id (`<file>#<offset>`) of the state's declaration.
 */
export type PendingSummary = {
  pending: (Place & { name: string; running: string[] })[];
  starts: (Place & { id: string })[];
};

function placeOf(node: ts.Node): Place {
  const sourceFile = node.getSourceFile();
  return { file: sourceFile.fileName, start: node.getStart(sourceFile), end: node.end };
}

function idOf(node: ts.Node): string {
  const place = placeOf(node);
  return `${place.file}#${String(place.start)}`;
}

/**
 * The types written on a declaration itself: its annotation, and the type arguments of the call
 * that makes its value (`useState<Pending<boolean>>(false)`). A type it gets from another value
 * (`const loading = isSubmitting`) is not written there.
 */
function writtenTypes(
  node: ts.VariableDeclaration | ts.PropertyDeclaration,
): readonly ts.TypeNode[] {
  const written: ts.TypeNode[] = node.type === undefined ? [] : [node.type];
  let initializer = node.initializer;
  while (
    initializer !== undefined &&
    (ts.isParenthesizedExpression(initializer) || ts.isAwaitExpression(initializer))
  ) {
    initializer = initializer.expression;
  }
  if (initializer !== undefined && ts.isCallExpression(initializer)) {
    written.push(...(initializer.typeArguments ?? []));
  }
  return written;
}

/**
 * The name a `Pending` state is declared under, or undefined when the declaration states none.
 * Only a declaration that writes the marker itself (`writtenTypes`) states it: one that copies a
 * `Pending` value is the same state, read under another name.
 */
function declaredPending(
  node: ts.Node,
  ctx: FileContext,
): { name: string; running: string[] } | undefined {
  let name: ts.Node | undefined;
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)) {
    const [first] = node.name.elements;
    name = first !== undefined && ts.isBindingElement(first) ? first.name : undefined;
  } else if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
    name = node.name;
  }
  if (name === undefined || !ts.isIdentifier(name)) return undefined;
  if (
    !(ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) ||
    !writtenTypes(node).some((type) => ctx.types.guaranteesOf(type).includes(PENDING))
  ) {
    return undefined;
  }
  const running = ctx.types.guaranteeValuesOf(name, PENDING);
  if (running === undefined || running === "not-finite") return undefined;
  return { name: name.text, running: running.map((one) => one.label) };
}

function pendingSummary(ctx: FileContext<Settings>): PendingSummary | undefined {
  if (!ctx.types.declaresTrait(PENDING)) return undefined;
  const tracked = trackedWith(ctx.options, ctx);
  const summary: PendingSummary = { pending: [], starts: [] };
  const visit = (node: ts.Node): void => {
    const declared = declaredPending(node, ctx);
    if (declared !== undefined) summary.pending.push({ ...declared, ...placeOf(node) });
    if (ts.isExpressionStatement(node)) {
      const use = flagUse(node.expression, ctx.sourceFile, tracked);
      const pending = use === undefined ? undefined : pendingOf(use, ctx);
      if (
        use !== undefined &&
        pending?.declaration !== undefined &&
        setsRunning(use.value, pending, ctx)
      ) {
        summary.starts.push({ ...placeOf(node.expression), id: idOf(pending.declaration) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return summary.pending.length > 0 || summary.starts.length > 0 ? summary : undefined;
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
    const stated = ctx.types.declaresTrait(PENDING);
    const visit = (node: ts.Node): void => {
      if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        analyze(node, ctx, tracked, rejects);
      }
      if (stated && ts.isTypeReferenceNode(node)) checkRunningValues(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
  summarize(ctx): Json | undefined {
    return pendingSummary(ctx);
  },
});
