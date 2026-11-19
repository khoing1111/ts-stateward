import ts from "@stateward/core/typescript";
import {
  defineRule,
  iteratesPlainly,
  matchesName,
  neverRejectsFactOf,
  option,
  type FileContext,
  type Fix,
  type Json,
  type LedgerRef,
  type Literal,
  type OptionsOf,
  type ReadOutcome,
} from "@stateward/core";
import { rejectionsOf, type CanReject } from "./rejects.js";
import { fitted, withExample } from "./text.js";

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

It guesses what the code means, so it is a warning in every preset, and it is wrong when the failure is handled somewhere it cannot see, such as a caller that always resets the state: say so above the line with \`// stateward-ignore async/pending-state-stuck-on-failure: <why>\`, or list the state's name under \`ignore\` (a state stated \`Pending\` is always checked: an ignore comment hides its finding, and the guarantee then reads not proven).

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

- **It settles:** every way out of the function (success, a failed \`await\`, an early \`return\`, a \`throw\`) leaves a value that is not running. Every \`await\` and every \`for await\` counts as one that can fail, except an \`await\` of a promise a \`facts\` line states \`neverRejects: true\`; so do a \`yield\` and any call or \`new\` (synchronous code throws too), but not a write of another state (\`setError(null)\`). A \`.then(done, failed)\` whose \`failed\` does not set it back leaves it running, as \`.then(done).catch(failed)\` does: a link counts only its own callbacks, so \`.then(reset).catch(() => undefined)\` resets on success only. The fix names the value the declaration starts with, in \`finally\`; for a union, each other value that is not running (\`"failed"\`) in a \`catch\`.
- **It does not start twice:** a function that leaves it running (it awaits, or sets it back only in a callback) returns early while it runs, on every path before the running write: \`if (savingRef.current) return;\` with a ref whose every write sits next to the state's (a ref, because a state value read in a handler can be one render old, so two quick clicks both see \`false\`), or \`if (saving) return;\`; or the element whose handler starts it is disabled with it (\`<button disabled={saving} onClick={save}>\`). A test of the state in another form is not checked.

The proof lists every write of the state and every way out after a running write, and reads these forms: the setter called as a statement of a function with a literal (\`setSaving(true);\`, \`this.status = "saving";\`), a reset that runs on every way out (a \`finally\` or a \`catch\` that writes a resting literal on every path, or a statement after the work), and a resting literal in a \`.then\`, \`.catch\` or \`.finally\` callback. A reset only on some paths is not proven (\`finally { if (…) setSaving(false); }\`). Everything else is "not checked", with the place, and the guarantee reads "not checked", never "unused", while one is left: the setter copied, passed on, stored or returned (\`const set = setBusy\`); an updater (\`setLoading((v) => !v)\`) or a value that is not a literal; a running write that is not a statement of its function (\`setTimeout(() => setSaving(true))\`); a reset in another callback (\`setTimeout(() => setSaving(false))\`); a compound or logical assignment of a field. Every reference to the state is read, or listed as "not checked" at its place: a field, a \`#private\` field (its guard \`if (this.#saving) return;\` counts as a public field's), a member of an object type (\`store: { saving: Pending<boolean> }\`) and both names of a \`useState\` pair, or the setter alone (\`const [, setSaving] = …\`); a write through another name for the object (\`const self = this; self.saving = true\`) or a computed key (\`store["saving"] = true\`) is not checked. So is an object holding the state written without naming it: \`Object.assign(this, { saving: true })\`, \`Reflect.set\`, a new object for a state that holds it (\`setForm({ ...form, saving: true })\` with \`useState<{ saving: Pending<boolean> }>\`), a reducer's state.

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
      "State names (globs like *Busy) that are set again somewhere this rule cannot see. Not for a state stated `Pending`: it is always checked.",
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

function trackedWith(settings: Settings, ctx: FileContext, honourIgnore = true): Tracked {
  return (name, root, at) => {
    if (honourIgnore && matchesName(name, settings.ignore)) return false;
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
  /**
   * A state stated `Pending`: whether a value is a resting one the proof reads (a literal that is
   * not running). Only such a write is a reset, and only an unconditional one settles a
   * `finally` or `catch`.
   */
  rests?: (value: ts.Expression) => boolean;
  /**
   * A state stated `Pending`: a call or `new` (synchronous code that can throw) and a `yield` are
   * failing work too, not only an `await`. A write of a state (`setError(null)`) is not.
   */
  syncFails?: boolean;
  /**
   * A state stated `Pending`: other synchronous code that can throw, read with the type checker:
   * a getter or setter that runs, an element read that may find nothing, a tagged template, a
   * `for…of` over anything but an array or a string.
   */
  syncWork?: (node: ts.Node) => boolean;
};

/** Work between a running write and its reset: an `await`, a `for await`, a call, `new` or `yield`. */
type Work =
  | ts.AwaitExpression
  | ts.ForOfStatement
  | ts.CallExpression
  | ts.NewExpression
  | ts.YieldExpression
  | ts.TaggedTemplateExpression
  | ts.PropertyAccessExpression
  | ts.ElementAccessExpression;

/** The expression a piece of work is shown by: what is awaited, iterated, called or yielded. */
function workExpression(work: Work): ts.Expression {
  if (ts.isAwaitExpression(work) || ts.isForOfStatement(work)) return work.expression;
  if (ts.isYieldExpression(work)) return work.expression ?? work;
  return work;
}

/** The statement is exactly `place = value` / `setPlace(value)` for the same place. */
function isSetAgain(statement: ts.Node, scope: Scope): boolean {
  if (!ts.isExpressionStatement(statement)) return false;
  const use = flagUse(statement.expression, scope.sourceFile, scope.tracked);
  return (
    use !== undefined &&
    sameFlag(use.flag, scope.flag) &&
    (scope.rests === undefined || scope.rests(use.value))
  );
}

/**
 * Whether a block sets the state back on every path through it: a statement of the block (or of a
 * plain block, or a `try` that settles itself) that writes a resting value. Only for a state
 * stated `Pending`, where `if (…) setS(false)` in a `finally` does not settle it.
 */
function settlesBlock(block: ts.Block, scope: Scope): boolean {
  return block.statements.some((statement) => {
    if (isSetAgain(statement, scope)) return true;
    if (ts.isBlock(statement)) return settlesBlock(statement, scope);
    return ts.isTryStatement(statement) && settlesTry(statement, scope);
  });
}

function settlesTry(statement: ts.TryStatement, scope: Scope): boolean {
  if (statement.finallyBlock !== undefined && settlesBlock(statement.finallyBlock, scope)) {
    return true;
  }
  return (
    statement.catchClause !== undefined &&
    settlesBlock(statement.catchClause.block, scope) &&
    settlesBlock(statement.tryBlock, scope)
  );
}

/** Whether a `finally` sets the state back: any write for a guessed state, an unconditional resting one for `Pending`. */
function finallyResets(block: ts.Block | undefined, scope: Scope): boolean {
  if (block === undefined) return false;
  return scope.rests === undefined ? resetsIn(block, scope) : settlesBlock(block, scope);
}

/** The same for a `catch` that covers what is inside its `try`. */
function catchResets(clause: ts.CatchClause | undefined, scope: Scope): boolean {
  if (clause === undefined) return false;
  return scope.rests === undefined ? resetsIn(clause, scope) : settlesBlock(clause.block, scope);
}

/** Where the state is set again inside the node, also in a callback; undefined when nowhere. */
function resetIn(node: ts.Node | undefined, scope: Scope): FlagUse | undefined {
  if (node === undefined) return undefined;
  const visit = (child: ts.Node): FlagUse | undefined => {
    const use = flagUse(child, scope.sourceFile, scope.tracked);
    if (use !== undefined && sameFlag(use.flag, scope.flag)) {
      if (scope.rests === undefined || scope.rests(use.value)) return use;
    }
    return ts.forEachChild(child, visit);
  };
  return visit(node);
}

function resetsIn(node: ts.Node | undefined, scope: Scope): boolean {
  return resetIn(node, scope) !== undefined;
}

/**
 * The first `await` in source order whose call can reject, or `for await` (the promises it reads
 * are work that can fail too), not looking inside nested functions.
 */
function firstFailingAwait(node: ts.Node, scope: Scope): Work | undefined {
  const visit = (child: ts.Node): Work | undefined => {
    if (ts.isForOfStatement(child) && child.awaitModifier !== undefined) return child;
    if (ts.isAwaitExpression(child)) {
      if (scope.rejects(child.expression) && !chainResets(child.expression, scope)) return child;
      // An `await` that does not fail (a fact says so, or its chain resets the state): the call
      // it awaits is read with it.
      if (scope.syncFails === true) return undefined;
    }
    if (ts.isFunctionLike(child)) return undefined;
    if (scope.syncFails === true) {
      if (ts.isYieldExpression(child)) return child;
      if (
        (ts.isCallExpression(child) || ts.isNewExpression(child)) &&
        flagUse(child, scope.sourceFile, scope.tracked) === undefined
      ) {
        return child;
      }
      if (
        (ts.isTaggedTemplateExpression(child) ||
          ts.isPropertyAccessExpression(child) ||
          ts.isElementAccessExpression(child) ||
          ts.isForOfStatement(child)) &&
        scope.syncWork?.(child) === true
      ) {
        return child;
      }
    }
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
  const resets = chain.links.map((link) => {
    const name = linkName(link);
    // The callback itself: the link also holds the chain before it, whose `.then` runs on success.
    const callback = name === "catch" || name === "finally" ? link.arguments[0] : link.arguments[1];
    return setsOtherValue(callback, scope);
  });
  // For a state stated `Pending`, a reset covers only the links before it: a later link can still
  // fail (`.catch(reset).then((r) => JSON.parse(r))`), so the last link must reset.
  return scope.rests === undefined ? resets.includes(true) : resets.at(-1) === true;
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
      (scope.rests !== undefined
        ? scope.rests(use.value)
        : scope.running === undefined || compact(use.value, scope.sourceFile) !== scope.running)
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
    // `for await`: each turn awaits a promise that can reject.
    const awaits = ts.isForOfStatement(statement) && statement.awaitModifier !== undefined;
    // `for…of` over an iterator of the project's code (`Iterable<T>`): each turn runs it.
    const iterates = ts.isForOfStatement(statement) && scope.syncWork?.(statement) === true;
    return {
      leak: ((awaits || iterates) && !caught) || failsHere(others) || body.leak,
      on: true,
    };
  }
  return { leak: failsHere(statement), on: true };
}

function walkTry(statement: ts.TryStatement, caught: boolean, scope: Scope): Walk {
  // A `finally` that sets the flag back runs on every way out, so nothing inside can leak.
  if (finallyResets(statement.finallyBlock, scope)) return { leak: false, on: false };
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
      (finallyResets(parent.finallyBlock, scope) || catchResets(parent.catchClause, scope))
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

/**
 * The way to state a state `Pending`, from the value its first write sets: `Pending<boolean>` for
 * `true`, else the type with the running value named.
 */
function pendingStatement(value: string): string {
  if (value === "true") return "Pending<boolean>";
  return /^["'][^"']*["']$/.test(value) ? `Pending<…, ${value}>` : "Pending<…>";
}

/**
 * The fix of a state that stays running when the call fails (M22): the way that fixes it, then the
 * readings that state a purpose: it is set again where this rule cannot see (`ignore`), or its type
 * says which values mean running (`Pending`).
 */
function hint(flag: Flag, reset: FlagUse | undefined, awaited: Awaited, value: string): string {
  const cleared = reset === undefined ? undefined : oneLine(reset.value);
  const fix =
    reset !== undefined && cleared !== undefined && clears(reset.value)
      ? fitted(
          (cut) =>
            `set \`${cut(flag.name)}\` again in a \`finally\`, so a failure resets it too: \`try { await ${shownAwaited(awaited, cut)}; } finally { ${cut(writeCode(flag, cleared))} }\``,
        )
      : fitted(
          (cut) =>
            `set \`${cut(flag.name)}\` in a \`catch\` too, so a failure resets it: \`try { await ${shownAwaited(awaited, cut)}; … } catch (error) { ${cut(writeCode(flag, "…"))} throw error; }\``,
        );
  return [
    "one of",
    `- ${fix}`,
    `- or, if a caller sets \`${flag.name}\` again where this rule cannot see, list it under the rule's \`ignore\` option`,
    `- or state it \`${pendingStatement(value)}\`, a type you add once in \`guarantees.ts\` (the rule's page shows it), and stateward proves it settles`,
  ].join("\n");
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
  // For a state stated `Pending`, only the link's own callbacks: the call it is made on holds the
  // links before it (`.then(reset).catch(ignore)` resets on success only).
  const ownCallbacks = (link: ts.CallExpression): boolean =>
    scope.rests === undefined
      ? resetsIn(link, scope)
      : link.arguments.some((argument) => resetsIn(argument, scope));
  for (const link of links) {
    const [first, second] = link.arguments;
    switch (linkName(link)) {
      case "finally":
        if (ownCallbacks(link)) return undefined;
        break;
      case "catch":
        if (ownCallbacks(link)) return undefined;
        handled = true;
        break;
      default:
        if (resetsIn(second, scope)) return undefined;
        // `.then(reset, onFailure)`: the failure runs `onFailure`, which leaves the state.
        if (!handled || second !== undefined) bad ??= resetIn(first, scope);
        if (second !== undefined) handled = true;
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
  everyState: Tracked,
  ignore: readonly string[],
  rejects: CanReject,
  sink: UncheckedSink,
  statedOnly = false,
): void {
  const { statements } = container;
  statements.forEach((statement, index) => {
    if (!ts.isExpressionStatement(statement)) return;
    // Read without `ignore`: a state stated `Pending` is always checked.
    const use = flagUse(statement.expression, ctx.sourceFile, everyState);
    if (use === undefined || firstAwait(use.value) !== undefined) return;
    // A state stated `Pending` says which values mean running: no guessing from its shape.
    const pending = pendingOf(use, ctx);
    if (pending !== undefined) {
      analyzePending(container, index, use, pending, ctx, everyState, sink);
      return;
    }
    if (statedOnly) return;
    if (matchesName(use.flag.name, ignore)) return;
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
      hint: hint(found.flag, found.reset, found.awaited, found.value),
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
    awaited: awaitedOf(workExpression(awaitedNode)),
    fix:
      again !== undefined && clears(again.value)
        ? wrapFix(statements, from, reset, ctx.file, ctx.sourceFile)
        : undefined,
  };
}

/** A place the proof of a `Pending` state cannot follow, and the state's declaration it is about. */
/** `fix` is what to write instead; without it, the general way (`UNCHECKED_FIX`). */
type Unchecked = {
  node: ts.Node;
  reason: string;
  declaration: ts.Node | undefined;
  fix?: string;
};
type UncheckedSink = (found: Unchecked) => void;

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
  /** The name the state is read by: `saving` of `const [saving, setSaving] = useState(…)`. */
  readAs: string | undefined;
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
      readAs:
        found?.state !== undefined && ts.isIdentifier(found.state) ? found.state.text : undefined,
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
      readAs: oneLine(node.left),
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
function pendingHint(
  flag: Flag,
  pending: PendingState,
  success: string | undefined,
  awaited: Awaited | undefined,
): string {
  const work = awaited === undefined ? "…" : `await ${shownAwaited(awaited, (text) => text)}; …`;
  const settled = (pending.values ?? []).filter((one) => !isRunningLabel(one.label, pending));
  const start =
    pending.start !== undefined && !isRunningLabel(pending.start, pending)
      ? pending.start
      : settled[0]?.label;
  const first =
    start === undefined
      ? `set \`${flag.name}\` back in \`finally\`, to a value that is not running`
      : `set \`${flag.name}\` back in \`finally\`: \`try { ${work} } finally { ${writeCode(flag, start)} }\``;
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
        `- or set it to ${label} in a \`catch\`: \`try { ${work} } catch (error) { ${writeCode(flag, label)} throw error; }\``,
    ),
  ].join("\n");
}

/** The test that says the state is running: `saving`, or `status === "saving"`. */
function runningTest(read: string, pending: PendingState): string {
  const labels = pending.running.map((run) => run.label);
  return labels.length === 1 && labels[0] === "true"
    ? read
    : labels.map((label) => `${read} === ${label}`).join(" || ");
}

/**
 * The fix of a function that can start while its `Pending` state runs (M22): return early, or
 * disable the control. A hook's state is read from a ref, a field or variable is read itself; the
 * names are the ones the code declares.
 */
function startsAgainHint(flag: Flag, pending: PendingState): string {
  const read = pending.readAs ?? flag.name;
  const isHook = flag.kind === "call" && /^set[A-Z]/.test(flag.target);
  const early = isHook
    ? {
        text: "return early while it runs, read from a ref, since state read in a handler can be one render old",
        example: [
          `const ${read}Ref = useRef(false); // in the component, once`,
          `if (${read}Ref.current) return;`,
          `${read}Ref.current = true; try { … } finally { ${read}Ref.current = false; }`,
        ],
      }
    : {
        text: `return early while it runs: \`if (${runningTest(read, pending)}) return;\``,
        example: [],
      };
  return [
    "one of",
    withExample(`- ${early.text}`, early.example),
    isHook
      ? `- or disable the control while it runs: \`disabled={${runningTest(read, pending)}}\``
      : "- or disable the control while it runs",
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

/**
 * How `fn` keeps from starting again while the state runs, before the running write at `at`:
 * `"guarded"` when it returns early on a test of this state (or of a ref whose every write mirrors
 * it), in a statement on every path to the write, or a control whose handler starts it is disabled
 * by such a test; `"other"` when it tests something by the state's name in another form (a nested
 * `if`, another object's field, a control that does not start it), which the proof does not read;
 * `"none"` when nothing tests it.
 */
function guardOf(
  fn: ts.SignatureDeclaration,
  at: ts.Statement,
  use: FlagUse,
  pending: PendingState,
  ctx: FileContext,
  tracked: Tracked,
): "guarded" | "other" | "none" {
  const tests = (expression: ts.Expression): boolean =>
    testsState(expression, use, pending, ctx, tracked);
  // An `if (test) return;` before the write, in a block on the way from the body to the write.
  for (let node: ts.Node = at; node !== fn && !ts.isSourceFile(node); node = node.parent) {
    const parent = node.parent;
    if (!ts.isBlock(parent)) continue;
    for (const statement of parent.statements) {
      if (statement === node) break;
      if (
        ts.isIfStatement(statement) &&
        statement.elseStatement === undefined &&
        leaves(statement.thenStatement) &&
        tests(statement.expression)
      ) {
        return "guarded";
      }
    }
  }
  const name = startedName(fn);
  if (name !== undefined && disabledWhileRunning(name, tests, ctx.sourceFile)) return "guarded";
  // The form the proof does not read: something by the state's name tested before the write, or a
  // control disabled by it.
  const word = use.flag.name.replace(/^#/, "#?");
  const named = new RegExp(`(?<![\\w$])${word}(?:Ref)?\\b`);
  const visit = (node: ts.Node): boolean => {
    if (node.getStart(ctx.sourceFile) >= at.getStart(ctx.sourceFile)) return false;
    if (node !== fn && ts.isFunctionLike(node)) return false;
    if (ts.isIfStatement(node) && named.test(node.expression.getText(ctx.sourceFile))) return true;
    return ts.forEachChild(node, visit) === true;
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined && visit(body)) return "other";
  return new RegExp(`disabled=\\{[^}]*(?<![\\w$])${word}\\b`).test(ctx.sourceFile.text)
    ? "other"
    : "none";
}

/** The name a function is started by: its own, or the variable that holds it. */
function startedName(fn: ts.SignatureDeclaration): string | undefined {
  const name = fn.name ?? (ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined);
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}

/**
 * Whether an expression tests that the state runs: the state read itself (`saving`,
 * `this.saving`) when its running value is `true`, `read === <running value>`, or the `.current`
 * of a ref whose every write sits next to a write of the state with the same meaning.
 */
function testsState(
  expression: ts.Expression,
  use: FlagUse,
  pending: PendingState,
  ctx: FileContext,
  tracked: Tracked,
): boolean {
  const inner = unwrap(expression);
  const read = pending.readAs;
  const runningLabels = pending.running.map((one) => one.label);
  const isRead = (node: ts.Expression): boolean =>
    compact(unwrap(node), ctx.sourceFile) === read?.replace(/\s+/g, "");
  if (isRead(inner) || mirrors(inner, use, pending, ctx, tracked)) {
    return runningLabels.length === 1 && runningLabels[0] === "true";
  }
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    runningLabels.length === 1
  ) {
    const [left, right] = [unwrap(inner.left), unwrap(inner.right)];
    const label = runningLabels[0];
    return (
      (isRead(left) && right.getText(ctx.sourceFile) === label) ||
      (isRead(right) && left.getText(ctx.sourceFile) === label)
    );
  }
  return false;
}

/**
 * Whether `node` is `ref.current` of a ref (`const ref = useRef(false)`) that mirrors the state:
 * every write `ref.current = true` / `= false` sits in the same block as a write of the state to a
 * running / resting value, and the ref is used nowhere else.
 */
function mirrors(
  node: ts.Expression,
  use: FlagUse,
  pending: PendingState,
  ctx: FileContext,
  tracked: Tracked,
): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "current") return false;
  const ref = unwrap(node.expression);
  if (!ts.isIdentifier(ref)) return false;
  const symbol = ctx.types.symbolAt(ref);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (symbol === undefined || declared === undefined) return false;
  const declaration = declared.node;
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer === undefined ||
    !startsFalse(unwrap(declaration.initializer))
  ) {
    return false;
  }
  // Every use of the ref: `undefined` for a read of `.current`, the assignment for a write, and
  // `"other"` for anything else (the ref handed on).
  const uses: (ts.BinaryExpression | "other" | undefined)[] = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isIdentifier(child) &&
      child !== declaration.name &&
      ctx.types.symbolAt(child)?.id === symbol.id
    ) {
      const access = child.parent;
      if (!ts.isPropertyAccessExpression(access) || access.name.text !== "current") {
        uses.push("other");
        return;
      }
      const assignment = access.parent;
      const writes =
        ts.isBinaryExpression(assignment) &&
        assignment.left === access &&
        assignment.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        assignment.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      uses.push(writes ? assignment : undefined);
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(ctx.sourceFile);
  const writes = uses.filter((one) => one !== undefined);
  return (
    writes.length > 0 &&
    writes.every((one) => one !== "other" && mirroredWrite(one, use, pending, ctx, tracked))
  );
}

/** `useRef(false)`, or a ref written in place: `{ current: false }`. */
function startsFalse(initializer: ts.Expression): boolean {
  if (ts.isCallExpression(initializer)) {
    return (
      lastName(initializer.expression) === "useRef" &&
      initializer.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword
    );
  }
  if (!ts.isObjectLiteralExpression(initializer)) return false;
  const [only] = initializer.properties;
  return (
    initializer.properties.length === 1 &&
    only !== undefined &&
    ts.isPropertyAssignment(only) &&
    only.name.getText() === "current" &&
    only.initializer.kind === ts.SyntaxKind.FalseKeyword
  );
}

/** Whether `ref.current = true|false` sits in a block with a write of the state that means the same. */
function mirroredWrite(
  assignment: ts.BinaryExpression,
  use: FlagUse,
  pending: PendingState,
  ctx: FileContext,
  tracked: Tracked,
): boolean {
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const value = assignment.right.kind;
  const statement = assignment.parent;
  if (value !== ts.SyntaxKind.TrueKeyword && value !== ts.SyntaxKind.FalseKeyword) return false;
  if (!ts.isExpressionStatement(statement) || !ts.isBlock(statement.parent)) return false;
  return statement.parent.statements.some((other) => {
    if (!ts.isExpressionStatement(other)) return false;
    const write = flagUse(other.expression, ctx.sourceFile, tracked);
    if (write === undefined || !sameFlag(write.flag, use.flag)) return false;
    return value === ts.SyntaxKind.TrueKeyword
      ? setsRunning(write.value, pending, ctx)
      : restingValue(write.value, pending, ctx);
  });
}

/**
 * Whether a JSX element whose `on…` handler starts the function by `name` (`onClick={save}`,
 * `onClick={() => void save()}`) is disabled by a test of the state (`disabled={saving}`,
 * `disabled={busy || saving}`).
 */
function disabledWhileRunning(
  name: string,
  tests: (expression: ts.Expression) => boolean,
  sourceFile: ts.SourceFile,
): boolean {
  const startsIt = (value: ts.Expression): boolean => {
    const inner = unwrap(value);
    if (ts.isIdentifier(inner)) return inner.text === name;
    if (!ts.isArrowFunction(inner) && !ts.isFunctionExpression(inner)) return false;
    let found = false;
    const visit = (child: ts.Node): void => {
      if (found) return;
      if (
        ts.isCallExpression(child) &&
        ts.isIdentifier(child.expression) &&
        child.expression.text === name
      ) {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(inner.body);
    return found;
  };
  const disables = (value: ts.Expression): boolean => {
    const inner = unwrap(value);
    if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return disables(inner.left) || disables(inner.right);
    }
    return tests(inner);
  };
  const valueOf = (attribute: ts.JsxAttribute): ts.Expression | undefined => {
    const initializer = attribute.initializer;
    return initializer !== undefined && ts.isJsxExpression(initializer)
      ? initializer.expression
      : undefined;
  };
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const handled = attributes.some((attribute) => {
        const value = valueOf(attribute);
        return (
          /^on[A-Z]/.test(attribute.name.getText(sourceFile)) &&
          value !== undefined &&
          startsIt(value)
        );
      });
      const disabled = attributes.some((attribute) => {
        const value = valueOf(attribute);
        return (
          attribute.name.getText(sourceFile) === "disabled" &&
          value !== undefined &&
          disables(value)
        );
      });
      if (handled && disabled) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
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
  sink: UncheckedSink,
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
    rests: (value) => restingValue(value, pending, ctx),
    syncFails: true,
    syncWork: (node) => syncWorkOf(node, ctx),
  };
  const fn = enclosingFunction(statement);
  const stated =
    pending.declaration === undefined
      ? []
      : [{ node: pending.declaration, message: `\`${use.flag.name}\` is stated \`Pending\` here` }];
  const related = [...stated, ...oneStateNote(statement, use.flag, ctx, tracked)];
  // A write of the state the proof cannot read in this function (an updater, a value it does not
  // know) may reset it or set it running: nothing is said about how it settles, and the write is
  // listed as not checked.
  const unreadable = fn !== undefined && writesUnreadably(fn, pending, scope, ctx);
  if (!unreadable && !coveredByEnclosingTry(container, scope)) {
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
        hint: pendingHint(use.flag, pending, success, found.awaited),
        fixes: found.fix === undefined ? [] : [found.fix],
        related,
        findingKind: "stated",
        stated: true,
      });
    } else if (reset < 0) {
      const later = settlesAfter(statement, fn, scope);
      if (later.kind === "none") {
        ctx.report({
          node: statement.expression,
          message: fitted(
            (cut) =>
              `\`${cut(use.flag.name)}\` stays \`${cut(first.value)}\` after ${functionName(fn)} returns`,
          ),
          hint: pendingHint(use.flag, pending, undefined, undefined),
          related,
          findingKind: "stated",
          stated: true,
        });
      } else if (later.kind === "conditional") {
        ctx.report({
          node: statement.expression,
          message: fitted(
            (cut) =>
              `\`${cut(use.flag.name)}\` is set back only on some paths of ${functionName(fn)}: \`${cut(oneLine(later.at))}\` is conditional`,
          ),
          hint: pendingHint(use.flag, pending, undefined, undefined),
          related: [
            ...related,
            { node: later.at, message: "the write that settles it, on some paths only" },
          ],
          findingKind: "stated",
          stated: true,
        });
      } else if (later.kind === "callback") {
        sink({
          node: later.at,
          reason: `\`${oneLine(later.at)}\` runs in ${later.via}, which stateward does not follow, so whether \`${use.flag.name}\` is set back is not proven`,
          declaration: pending.declaration,
          fix: `set \`${use.flag.name}\` back in the function itself, in \`finally\``,
        });
      }
    }
  }
  if (fn === undefined) return;
  // It can start again while the state runs when it returns before the state is set back: it
  // awaits or yields, or nothing after the write in its own statements sets it back (a callback
  // does, later).
  const resetHere = statements.some(
    (one, at) =>
      at > index &&
      (isSetAgain(one, scope) ||
        (ts.isTryStatement(one) && finallyResets(one.finallyBlock, scope))),
  );
  const generator = "asteriskToken" in fn && fn.asteriskToken !== undefined;
  const body = "body" in fn ? fn.body : undefined;
  // A function that never sets it back is already an error ("stays `true`"); one that does so in
  // a callback returns while it runs.
  const resetLater = !resetHere && resetIn(body, scope) !== undefined;
  if (!hasAwait(fn) && !generator && !resetLater) return;
  const guard = guardOf(fn, statement, use, pending, ctx, tracked);
  if (guard === "guarded") return;
  const name = use.flag.name;
  if (guard === "other") {
    sink({
      node: statement.expression,
      reason: `${functionName(fn)} tests \`${name}\` in a way stateward does not read, so starting it twice is not checked`,
      declaration: pending.declaration,
      fix: `return early while it runs, as its own statement: \`if (${name}) return;\``,
    });
    return;
  }
  const running = runningText(pending);
  ctx.report({
    node: statement.expression,
    message: fitted(
      (cut) => `${functionName(fn)} starts again while \`${cut(name)}\` is ${running}`,
    ),
    hint: startsAgainHint(use.flag, pending),
    related: stated,
    findingKind: "stated",
    stated: true,
  });
}

/**
 * Synchronous code that can throw for a state stated `Pending`, besides a call: a getter or setter
 * that runs (`this.total`, `this.value = v`), an element read that may find nothing
 * (`this.items[0].name`), a tagged template (a call of its tag), and a `for…of` over an iterator
 * that is not an array's, a string's, or one of a `Map` or `Set` (`m.values()`).
 */
function syncWorkOf(node: ts.Node, ctx: FileContext): boolean {
  if (ts.isTaggedTemplateExpression(node)) return true;
  if (ts.isForOfStatement(node)) {
    return node.awaitModifier === undefined && !iteratesPlainly(node.expression, ctx.types);
  }
  if (ts.isElementAccessExpression(node)) {
    // Reading an element runs nothing; reading further from what it found may throw
    // (`items[0].name` on an empty list), and a literal key may name a getter.
    const parent = node.parent;
    const readFurther =
      (ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent) ||
        ts.isCallExpression(parent)) &&
      parent.expression === node;
    return (
      (readFurther || ts.isStringLiteralLike(node.argumentExpression)) &&
      !ctx.types.readIsPlain(node)
    );
  }
  if (!ts.isPropertyAccessExpression(node)) return false;
  // What a call is made on: the call is the work.
  if (ts.isCallExpression(node.parent) && node.parent.expression === node) return false;
  const symbol = ctx.types.symbolAt(node.name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return (
    declared !== undefined &&
    (ts.isGetAccessorDeclaration(declared.node) || ts.isSetAccessorDeclaration(declared.node))
  );
}

/** Whether a value is a resting one the proof reads: a finite set of literals, none of them running. */
function restingValue(value: ts.Expression, pending: PendingState, ctx: FileContext): boolean {
  const written = ctx.types.literalsOf(value);
  return (
    written !== "not-finite" &&
    written.length > 0 &&
    written.every((one) => !isRunningLabel(one.label, pending))
  );
}

/** Whether a write's value is one the proof reads: all running, or all resting. */
function readableValue(value: ts.Expression, pending: PendingState, ctx: FileContext): boolean {
  return restingValue(value, pending, ctx) || setsRunning(value, pending, ctx);
}

/** Whether the function writes the state with a value the proof cannot read, in its own body. */
function writesUnreadably(
  fn: ts.SignatureDeclaration,
  pending: PendingState,
  scope: Scope,
  ctx: FileContext,
): boolean {
  const body = "body" in fn ? fn.body : undefined;
  if (body === undefined) return false;
  const visit = (node: ts.Node): boolean => {
    const use = flagUse(node, scope.sourceFile, scope.tracked);
    if (
      use !== undefined &&
      sameFlag(use.flag, scope.flag) &&
      !readableValue(use.value, pending, ctx)
    ) {
      return true;
    }
    return ts.forEachChild(node, visit) === true;
  };
  return visit(body);
}

/**
 * Where the state is set back after `statement`, when no sibling statement of its block does:
 * - `settled`: a later statement of an enclosing block writes a resting value on every path;
 * - `conditional`: the function writes it only on some paths (`if (…) setS(false)` in a
 *   `finally`): not proven;
 * - `callback`: a callback writes it (`setTimeout(() => setS(false))`): not followed;
 * - `none`: nowhere.
 * A `.then`, `.catch` or `.finally` callback is read by the chain check, so it counts as settled.
 */
type Later =
  | { kind: "settled" | "none" }
  | { kind: "conditional"; at: ts.Node }
  | { kind: "callback"; at: ts.Node; via: string };

function settlesAfter(
  statement: ts.Statement,
  fn: ts.SignatureDeclaration | undefined,
  scope: Scope,
): Later {
  for (
    let node: ts.Node = statement;
    !ts.isFunctionLike(node.parent) && !ts.isSourceFile(node.parent);
    node = node.parent
  ) {
    const { parent } = node;
    if (!(ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent))) continue;
    const at = parent.statements.findIndex((one) => one === node);
    for (const later of parent.statements.slice(at + 1)) {
      if (isSetAgain(later, scope)) return { kind: "settled" };
      if (ts.isTryStatement(later) && settlesTry(later, scope)) return { kind: "settled" };
    }
  }
  const body = fn !== undefined && "body" in fn ? fn.body : undefined;
  if (body === undefined) return { kind: "none" };
  let found: Later = { kind: "none" };
  const visit = (node: ts.Node): void => {
    if (found.kind !== "none") return;
    if (node.getStart(scope.sourceFile) > statement.getEnd()) {
      const use = flagUse(node, scope.sourceFile, scope.tracked);
      if (
        use !== undefined &&
        sameFlag(use.flag, scope.flag) &&
        (scope.rests?.(use.value) ?? true)
      ) {
        found = classifyReset(node, fn);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** A reset found after the write, by where it is: a chain's callback, another callback, or this function. */
function classifyReset(node: ts.Node, fn: ts.SignatureDeclaration | undefined): Later {
  for (let at: ts.Node = node; at !== fn && !ts.isSourceFile(at); at = at.parent) {
    const call = ts.isFunctionLike(at) ? at.parent : undefined;
    if (call === undefined || !ts.isCallExpression(call)) continue;
    const callee = call.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      ["then", "catch", "finally"].includes(callee.name.text)
    ) {
      return { kind: "settled" };
    }
    return { kind: "callback", at: node, via: `\`${oneLine(callee).slice(0, 40)}(…)\`` };
  }
  return { kind: "conditional", at: node };
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

const ASSIGNMENTS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** A hook that takes a dependency list as its last argument: a setter listed there is not a use. */
const DEPENDENCY_HOOKS = /(?:Callback|Effect|Memo|Handle)$/;

function isStatementOfBlock(node: ts.Node): boolean {
  return (
    ts.isExpressionStatement(node.parent) &&
    (ts.isBlock(node.parent.parent) ||
      ts.isCaseClause(node.parent.parent) ||
      ts.isDefaultClause(node.parent.parent))
  );
}

function isDependencyList(node: ts.Node): boolean {
  const list = node.parent;
  if (!ts.isArrayLiteralExpression(list)) return false;
  const call = list.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.at(-1) === list &&
    DEPENDENCY_HOOKS.test(lastName(call.expression) ?? "")
  );
}

/** How a use of the setter other than a call is told: "`setBusy` is copied to `set`". */
function passedOn(id: ts.Identifier): string {
  const { parent } = id;
  const name = `\`${id.text}\``;
  if (ts.isVariableDeclaration(parent) && parent.initializer === id) {
    return `${name} is copied to \`${oneLine(parent.name)}\`, whose writes cannot be followed`;
  }
  if (ts.isCallExpression(parent)) {
    return `${name} is passed to \`${oneLine(parent.expression).slice(0, 40)}(…)\`, which cannot be followed`;
  }
  if (ts.isBinaryExpression(parent) && parent.right === id) {
    return `${name} is copied to \`${oneLine(parent.left)}\`, whose writes cannot be followed`;
  }
  return `${name} is stored, returned or passed on, so its writes cannot be followed`;
}

/**
 * Every use of a `useState` setter of a state stated `Pending`, as the proof reads it: a call with
 * a literal (a running write that is a statement of its function, or a resting one) is read; a
 * call with an updater or a value it cannot read, a running write outside the statements of its
 * function (`setTimeout(() => setS(true))`), and the setter passed on (an alias, an argument, a
 * property, a return) are not checked.
 */
function scanSetter(
  setter: ts.Identifier,
  pending: PendingState,
  ctx: FileContext,
  sink: UncheckedSink,
): void {
  const symbol = ctx.types.symbolAt(setter);
  if (symbol === undefined) return;
  const home = enclosingFunction(setter);
  const unchecked = (node: ts.Node, reason: string, fix: string): void => {
    sink({ node, reason, declaration: pending.declaration, fix });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node !== setter && node.text === setter.text) {
      const shorthand = ts.isShorthandPropertyAssignment(node.parent);
      const same =
        ctx.types.symbolAt(node)?.id === symbol.id ||
        (shorthand && home !== undefined && node.pos >= home.pos && node.end <= home.end);
      if (same && !ts.isTypeQueryNode(node.parent)) use(node);
    }
    ts.forEachChild(node, visit);
  };
  const use = (id: ts.Identifier): void => {
    const { parent } = id;
    if (ts.isBindingElement(parent) && parent.name === id) return;
    if (isDependencyList(id)) return;
    if (!(ts.isCallExpression(parent) && parent.expression === id)) {
      unchecked(id, passedOn(id), SETTER_LOCAL);
      return;
    }
    const [argument, ...rest] = parent.arguments;
    const call = `\`${oneLine(parent).slice(0, 60)}\``;
    if (argument === undefined || rest.length > 0 || ts.isSpreadElement(argument)) {
      unchecked(parent, `${call} does not write one literal value`, WRITE_LITERAL);
    } else if (!readableValue(argument, pending, ctx)) {
      const updater = ts.isArrowFunction(argument) || ts.isFunctionExpression(argument);
      unchecked(
        parent,
        updater
          ? `${call} is an updater, so the value it writes is not known`
          : `${call} writes a value that is not a literal`,
        WRITE_LITERAL,
      );
    } else if (setsRunning(argument, pending, ctx) && !isStatementOfBlock(parent)) {
      unchecked(
        parent,
        `${call} is not a statement of its function, so when it runs is not followed`,
        "call it as a statement of the function, not in a callback or an expression",
      );
    }
  };
  visit(ctx.sourceFile);
}

/**
 * Every write of a field or variable stated `Pending` that is not a plain `place = value;`
 * statement with a literal: a compound or logical assignment, one inside an expression, a value
 * the proof cannot read.
 */
function scanAssignment(node: ts.BinaryExpression, ctx: FileContext, sink: UncheckedSink): void {
  if (!ASSIGNMENTS.has(node.operatorToken.kind)) return;
  const running = ctx.types.guaranteeValuesOf(node.left, PENDING);
  if (running === undefined || running === "not-finite") return;
  const pending: PendingState = {
    running,
    values: undefined,
    start: undefined,
    readAs: undefined,
    declaration: startOfPlace(node.left, ctx).declaration,
  };
  const plain = node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isStatementOfBlock(node);
  const call = `\`${oneLine(node).slice(0, 60)}\``;
  if (!plain) {
    sink({
      node,
      reason: `${call} is not a plain \`place = value;\` statement, so what it writes is not followed`,
      declaration: pending.declaration,
      fix: "write it as `place = value;`, with a literal",
    });
  } else if (!readableValue(node.right, pending, ctx)) {
    sink({
      node,
      reason: `${call} writes a value that is not a literal`,
      declaration: pending.declaration,
      fix: "write a literal, as `place = false;`",
    });
  }
}

/** Every use of every state stated `Pending` in the file that the proof cannot read, to the sink. */
function scanUses(ctx: FileContext, sink: UncheckedSink): void {
  if (!ctx.types.declaresTrait(PENDING)) return;
  const visit = (node: ts.Node): void => {
    const declared = declaredPending(node, ctx);
    if (
      declared !== undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name)
    ) {
      const second = node.name.elements[1];
      if (second !== undefined && ts.isBindingElement(second) && ts.isIdentifier(second.name)) {
        const running = ctx.types.guaranteeValuesOf(declared.nameNode, PENDING);
        if (running !== undefined && running !== "not-finite") {
          const pending: PendingState = {
            running,
            values: undefined,
            start: undefined,
            readAs: declared.name,
            declaration: node,
          };
          scanSetter(second.name, pending, ctx, sink);
        }
      }
    }
    if (ts.isBinaryExpression(node)) scanAssignment(node, ctx, sink);
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
}

/** The note on a place not checked: what lets the proof read it. */
const UNCHECKED_HINT =
  "write the state with a literal, as a statement of the function that runs it, and keep its setter local, so stateward can prove it settles";

/** What to write instead of a place not checked, after its reason, when the place names none. */
const UNCHECKED_FIX = "write the state with a literal, as a statement of the function that runs it";

/** What to write instead of a setter passed on. */
const SETTER_LOCAL = "call the setter only in the component that declares it";

/** What to write instead of a setter call that is not read. */
const WRITE_LITERAL = "call the setter with one literal, as `setSaving(false)`";

/** A place's reason with what to write instead, as `stateward guarantees` lists it. */
function withFix(one: { reason: string; fix?: string }): string {
  return `${one.reason}: ${one.fix ?? UNCHECKED_FIX}`;
}

function reportUnchecked(ctx: FileContext): UncheckedSink {
  return ({ node, reason, fix }) => {
    ctx.unknown({ message: `not checked: ${reason}`, hint: fix ?? UNCHECKED_HINT, node });
  };
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
  /** What the proof cannot read, each with the id of the state's declaration. */
  unchecked?: (Place & { id: string; reason: string })[];
};

function placeOf(node: ts.Node): Place {
  const sourceFile = node.getSourceFile();
  return { file: sourceFile.fileName, start: node.getStart(sourceFile), end: node.end };
}

/**
 * Where a stated declaration is, as the reference ledger names it: a property at its name (after
 * `private`, `readonly`), anything else where it starts.
 */
function declarationPlace(node: ts.Node): Place {
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    return { ...placeOf(node), start: node.name.getStart(node.getSourceFile()) };
  }
  return placeOf(node);
}

function idOf(node: ts.Node): string {
  const place = declarationPlace(node);
  return `${place.file}#${String(place.start)}`;
}

/**
 * The types written on a declaration itself: its annotation, and the type arguments of the call
 * that makes its value (`useState<Pending<boolean>>(false)`). A type it gets from another value
 * (`const loading = isSubmitting`) is not written there.
 */
function writtenTypes(
  node: ts.VariableDeclaration | ts.PropertyDeclaration | ts.PropertySignature,
): readonly ts.TypeNode[] {
  const written: ts.TypeNode[] = node.type === undefined ? [] : [node.type];
  let initializer = ts.isPropertySignature(node) ? undefined : node.initializer;
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
): { name: string; running: string[]; nameNode: ts.Node } | undefined {
  let name: ts.Node | undefined;
  let setterAlone = false;
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)) {
    // `const [, setSaving] = useState<Pending<boolean>>(false)`: the setter alone names it.
    const [first, second] = node.name.elements;
    setterAlone = first === undefined || !ts.isBindingElement(first);
    name =
      first !== undefined && ts.isBindingElement(first)
        ? first.name
        : second !== undefined && ts.isBindingElement(second)
          ? second.name
          : undefined;
  } else if (
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node)
  ) {
    name = node.name;
  }
  // A field, `#field` or a member of an object type (`{ saving: Pending<boolean> }`).
  if (
    name === undefined ||
    !(ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name))
  ) {
    return undefined;
  }
  if (
    !(
      ts.isVariableDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node)
    ) ||
    !writtenTypes(node).some((type) => ctx.types.guaranteesOf(type).includes(PENDING))
  ) {
    return undefined;
  }
  // The setter's type holds the state's in its parameter: read the running values off the
  // written `Pending<…>` instead.
  const typeNode = writtenTypes(node).find((type) =>
    ctx.types.guaranteesOf(type).includes(PENDING),
  );
  const running = ctx.types.guaranteeValuesOf(
    setterAlone && typeNode !== undefined ? typeNode : name,
    PENDING,
  );
  if (running === undefined || running === "not-finite") return undefined;
  return { name: name.text, running: running.map((one) => one.label), nameNode: name };
}

function pendingSummary(ctx: FileContext<Settings>): PendingSummary | undefined {
  if (!ctx.types.declaresTrait(PENDING)) return undefined;
  const tracked = trackedWith(ctx.options, ctx, false);
  const summary: PendingSummary = { pending: [], starts: [], unchecked: [] };
  const found = (one: Unchecked): void => {
    if (one.declaration === undefined) return;
    summary.unchecked?.push({
      ...placeOf(one.node),
      id: idOf(one.declaration),
      reason: withFix(one),
    });
  };
  // The same walk as `check`, with its findings dropped: what it cannot follow is listed.
  const quiet: FileContext = { ...ctx, report: () => undefined };
  const rejects = rejectionsOf(ctx);
  const everyState = trackedWith(ctx.options, ctx, false);
  scanUses(ctx, found);
  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      analyze(node, quiet, everyState, everyState, [], rejects, found, true);
    }
    const declared = declaredPending(node, ctx);
    if (declared !== undefined) {
      summary.pending.push({
        name: declared.name,
        running: declared.running,
        ...declarationPlace(node),
      });
    }
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
  return summary.pending.length > 0 || summary.starts.length > 0 || summary.unchecked?.length
    ? summary
    : undefined;
}

/** The setter of a `useState` pair a name refers to: `setSaving` of `const [saving, setSaving] = …`. */
function isSetterName(node: ts.Node, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(node);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const element = declared?.node;
  return (
    element !== undefined &&
    ts.isBindingElement(element) &&
    ts.isArrayBindingPattern(element.parent) &&
    element.parent.elements.indexOf(element) > 0
  );
}

/** The expression a name is the value of: `this.saving` for `saving`, `store["saving"]` for the key. */
function accessOf(node: ts.Node): ts.Node {
  const parent = node.parent;
  let at: ts.Node =
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)
      ? parent
      : node;
  while (
    ts.isParenthesizedExpression(at.parent) ||
    ts.isAsExpression(at.parent) ||
    ts.isSatisfiesExpression(at.parent) ||
    ts.isNonNullExpression(at.parent)
  ) {
    at = at.parent;
  }
  return at;
}

/** What the proof says of one reference to a state stated `Pending` that no place not checked lies on. */
function pendingOutcome(
  ref: LedgerRef,
  node: ts.Node,
  ctx: FileContext,
  tracked: Tracked,
): ReadOutcome {
  const text = `\`${ref.text}\``;
  if (isSetterName(node, ctx)) {
    if (ref.form === "call") return { kind: "decided" };
    if (isDependencyList(node)) return { kind: "irrelevant" };
    return {
      kind: "unchecked",
      reason: `${text} passes the setter on, so its writes are not followed: ${SETTER_LOCAL}`,
    };
  }
  if (ref.form !== "write") {
    // Reading the state changes nothing, unless a copy of it shares what can be changed.
    const value = accessOf(node);
    return ctx.types.literalsOf(value) !== "not-finite" || ctx.types.holdsOnlyPrimitives(value)
      ? { kind: "irrelevant" }
      : {
          kind: "unchecked",
          reason: `${text} passes the value on, and what it holds can be changed where it goes: pass a copy`,
        };
  }
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    const running = ctx.types.guaranteeValuesOf(parent.initializer, PENDING, true);
    const written = ctx.types.literalsOf(parent.initializer);
    const resting =
      running !== undefined &&
      running !== "not-finite" &&
      written !== "not-finite" &&
      written.length > 0 &&
      written.every((one) => !running.some((run) => run.label === one.label));
    return resting
      ? { kind: "decided" }
      : {
          kind: "unchecked",
          reason: `${text} writes it in an object literal, which stateward does not follow: write it as \`place = value;\`, with a literal`,
        };
  }
  const access = accessOf(node);
  const assignment = access.parent;
  if (
    ts.isBinaryExpression(assignment) &&
    assignment.left === access &&
    flagUse(assignment, ctx.sourceFile, tracked) !== undefined &&
    (ts.isIdentifier(access) || ts.isPropertyAccessExpression(access))
  ) {
    return { kind: "decided" };
  }
  return {
    kind: "unchecked",
    reason: `${text} writes it in a way stateward does not follow: write it as \`place = value;\`, by its own name, with a literal`,
  };
}

/**
 * Why an object holding a state stated `Pending` written past every reference to the state (an
 * `escaped` flow of the reference ledger) is not checked: what writes it is not a form the proof
 * reads.
 */
function escapedReason(ref: LedgerRef): string {
  const code = `\`${ref.text}\``;
  const state = `\`${ref.name}\``;
  return ref.via === "reflect"
    ? `${code} writes ${state} by reflection or a computed key, which stateward does not follow: write it as \`place = value;\`, by its own name`
    : ref.via === "literal"
      ? `${code} writes ${state} in a new object for the state (a \`useState\` or reducer object), which stateward does not follow: keep ${state} in its own \`useState\`, and set it with a literal`
      : `${code} writes ${state} in a way stateward does not follow: write it as \`place = value;\`, by its own name, with a literal`;
}

/**
 * Marks every reference to a state stated `Pending` (the reference ledger): a reference a place
 * not checked lies on is not checked, with that place's reason; a setter called with a value is
 * read (the walk above reads the call), and listed in a dependency list is irrelevant; a write the
 * walk reads (a plain assignment to a place it tracks, `this.saving = true`, or a resting value in
 * an object literal) is read; a read of a value that holds only primitives is irrelevant. Anything
 * else is not checked: the setter passed on, a write through another name for the object (`const
 * self = this`) or a computed key (`store["saving"]`), `++`, a value passed on that can be changed.
 */
function markPendingReferences(
  ctx: FileContext,
  tracked: Tracked,
  seen: readonly Unchecked[],
): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === PENDING);
  if (refs.length === 0) return;
  const nodes = new Map<number, ts.Node>();
  const index = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node)) {
      nodes.set(node.getStart(ctx.sourceFile), node);
    }
    ts.forEachChild(node, index);
  };
  index(ctx.sourceFile);
  const places = seen.map((one) => ({
    id: one.declaration === undefined ? undefined : idOf(one.declaration),
    start: one.node.getStart(ctx.sourceFile),
    end: one.node.getEnd(),
    reason: withFix(one),
  }));
  for (const ref of refs) {
    if (ref.form === "import" || ref.form === "export" || ref.form === "type") {
      ctx.read(ref, { kind: "irrelevant" });
      continue;
    }
    if (ref.form === "escaped" || ref.form === "produced" || ref.form === "decided") {
      ctx.read(ref, { kind: "unchecked", reason: escapedReason(ref) });
      continue;
    }
    const at = ref.location.start;
    const place = places.find(
      (one) =>
        (one.id === undefined || one.id === ref.declaration) && one.start <= at && at < one.end,
    );
    if (place !== undefined) {
      ctx.read(ref, { kind: "unchecked", reason: place.reason });
      continue;
    }
    const node = nodes.get(at);
    ctx.read(
      ref,
      node === undefined
        ? {
            kind: "unchecked",
            reason: `\`${ref.text}\` is a use of \`${ref.name}\` that stateward does not read: use the state by its own name`,
          }
        : pendingOutcome(ref, node, ctx, tracked),
    );
  }
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
    proves: { traits: [PENDING], holders: [PENDING], flows: { escaped: [PENDING] } },
    options: OPTIONS,
    explain: EXPLAIN,
    // `@neverRejects` is read from the project's JSDoc.
    needsJsDoc: true,
  },
  check(ctx) {
    const tracked = trackedWith(ctx.options, ctx);
    const everyState = trackedWith(ctx.options, ctx, false);
    const rejects = rejectionsOf(ctx);
    const stated = ctx.types.declaresTrait(PENDING);
    const report = reportUnchecked(ctx);
    // What the proof cannot follow, kept to mark the references it lies on.
    const seen: Unchecked[] = [];
    const sink: UncheckedSink = (one) => {
      seen.push(one);
      report(one);
    };
    scanUses(ctx, sink);
    const visit = (node: ts.Node): void => {
      if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
        analyze(node, ctx, tracked, everyState, ctx.options.ignore, rejects, sink);
      }
      if (stated && ts.isTypeReferenceNode(node)) checkRunningValues(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
    markPendingReferences(ctx, everyState, seen);
  },
  summarize(ctx): Json | undefined {
    return pendingSummary(ctx);
  },
});
