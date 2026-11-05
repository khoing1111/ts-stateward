import ts from "@stateward/core/typescript";
import { defineRule } from "@stateward/core";
import type { FileContext, Fix, Json, Location, RelatedLocation } from "@stateward/core";
import { catchName, className } from "./inference/format.js";
import { summarizeOnce } from "./inference/project.js";
import { analyse, evaluated, relation } from "./inference/solve.js";
import type { Analysis, FunctionEntry, Thrown } from "./inference/solve.js";
import { ANONYMOUS, classIdOf } from "./inference/summarize.js";
import { each, fieldsOf, isString, spanOf } from "./inference/summary.js";
import type { Effect, Handler, Leaf, Span, ThrowsSummary } from "./inference/summary.js";
import { throwsOf } from "./react/boundaries.js";
import { stripParentheses } from "./syntax.js";
import { fitted, oneLine, shorten, withExample } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "callers";

const EXPLAIN = `# errors/must-handle-error

An error class marked \`@mustHandle\` is named in a \`catch\` or passed on with \`@throws\` by every call that can throw it.

## Why

Some errors need a decision from the code that meets them. A declined card is not a crash: the user should be told and offered another card. If \`checkout\` lets \`PaymentDeclinedError\` fall into a generic \`catch\` that shows "Something went wrong", the user never learns why, and tries the same card again. TypeScript cannot say which errors a call can throw, so nothing reminds the author of \`checkout\` that this one needs handling.

Write the decision once, on the class:

\`\`\`ts
/** @mustHandle Tell the user the card was declined and let them pick another card. */
export class PaymentDeclinedError extends Error {}
\`\`\`

and stateward checks every call that can throw it, in any file, and shows your sentence where it is missed.

## When to use it

For the few errors that callers must act on: a declined payment, an expired session, a conflict the user must resolve. It is a core rule, an error in every preset, and reports nothing until you mark a class: you choose, error by error, what is checked. For new code, returning the failure as a value (a \`Result\` or a union) makes TypeScript itself check it; \`@mustHandle\` is for errors that are already thrown.

## What it catches

A call that can throw or reject with a marked class (or a class that extends it), when nothing between the call and the function's callers handles it on purpose:

- **handled on purpose:** a \`catch\` around the call has a branch \`e instanceof PaymentDeclinedError\` (or a marked class it extends) that does not rethrow it; a guard \`if (!(e instanceof PaymentDeclinedError)) throw e;\` followed by the handling, a \`?:\` or \`&&\` that tests \`e instanceof PaymentDeclinedError\`, and a \`switch (true)\` case count the same;
- **handed to a helper that handles it:** the \`catch\` passes its error to a function of yours whose first statement is \`if (error instanceof PaymentDeclinedError) …\` (or a marked class it extends) and does not rethrow it there, like \`showPaymentError(e)\`; only that function is read, not the ones it calls;
- **handled where it is called:** a helper declared inside a function and called only inside a handling \`try\` is judged at those calls, not in its own body;
- **passed on on purpose:** the function's JSDoc has \`@throws {PaymentDeclinedError}\` (or a marked class it extends); then its own callers must handle it, and are checked the same way. An \`await\`ed promise counts as a call.

Everything else is reported at the call: no \`try\`, a \`catch\` that treats every error alike (no branch, or only \`instanceof Error\`), a \`catch\` that rethrows everything (\`report(e); throw e;\`) in a function without \`@throws\`. The message gives your sentence from \`@mustHandle\` and links to the tag.

### Bad

\`\`\`ts
export async function reorder(order: Order, card: Card): Promise<Receipt> {
  return await pay(order, card); // pay can throw PaymentDeclinedError
}
\`\`\`

### Good

\`\`\`ts
export async function reorder(order: Order, card: Card): Promise<ReorderResult> {
  try {
    return { kind: "paid", receipt: await pay(order, card) };
  } catch (e) {
    if (e instanceof PaymentDeclinedError) return { kind: "declined", reason: e.reason };
    throw e;
  }
}
\`\`\`

or pass it on, so the caller of \`reorder\` decides:

\`\`\`ts
/** @throws {PaymentDeclinedError} */
export async function reorder(order: Order, card: Card): Promise<Receipt> {
  return await pay(order, card);
}
\`\`\`

### Fix

Name the class in the \`catch\` and do what the sentence says, pass it on with \`@throws\`, or change the throwing function to return the failure as a value. The quick fix "Pass it on" adds \`@throws\` to the function's JSDoc (and creates the JSDoc when there is none); what to do in a \`catch\` branch is your call, so there is no fix that writes one.

## What it does not catch

- Where stateward cannot follow the error, it says so, and these places are listed by \`stateward check\` (not only counted), since you asked for this error: a callback whose caller it cannot see (an event handler, a function passed to another), a \`catch\` that tests a class whose \`extends\` it cannot follow, a test inside the called function it cannot read.
- \`promise.catch(handler)\`: the handler is taken to handle every rejection.
- A \`@mustHandle\` on a type alias or an interface (plain-object errors such as \`{ kind: "declined" }\`): not checked yet, and reported as a place not checked. That is the next step.
- Errors from packages: only classes of your project can be marked.
- A \`throw new PaymentDeclinedError()\` itself: the function that throws it is where it starts; its callers are checked.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "errors/must-handle-error": "off" } // or "warning"
groups: { "errors/catch": "off" } // the whole group
\`\`\`
`;

// ---- summary -------------------------------------------------------------------------------------

/** A class marked `@mustHandle`: its id, its name, the author's sentence and the tag's span. */
type Tag = { readonly id: string; readonly name: string; readonly how: string; readonly at: Span };

/**
 * Where `@throws` goes for a function, by the start of its name: the start of its statement (after
 * any JSDoc), that line's indentation, and its last JSDoc block when it has one.
 */
type Anchor = {
  readonly name: number;
  readonly start: number;
  readonly indent: string;
  readonly doc: { readonly start: number; readonly end: number; readonly text: string } | null;
};

/**
 * A function whose body starts by testing a parameter with `instanceof` and does not rethrow it
 * there: `function showError(error) { if (error instanceof Declined) return toast(…); … }`. A
 * `catch` that hands its error to it names those classes.
 */
type ErrorHelper = {
  readonly id: string;
  readonly parameter: number;
  readonly classes: readonly string[];
};

/** A call in a `catch` (by the start of its `catch` keyword) that passes the caught error on. */
type Pass = { readonly at: number; readonly callee: string; readonly argument: number };

type MustHandleFacts = {
  readonly tags: readonly Tag[];
  /** `@mustHandle` on something other than a class declaration: not checked yet. */
  readonly untracked: readonly Span[];
  readonly anchors: readonly Anchor[];
  readonly helpers: readonly ErrorHelper[];
  readonly passes: readonly Pass[];
};

export type MustHandleSummary = {
  readonly throws: ThrowsSummary;
  readonly mustHandle: MustHandleFacts;
};

const TAG = "mustHandle";

function mustHandleTag(node: ts.Node): ts.JSDocTag | undefined {
  return ts.getJSDocTags(node).find((tag) => tag.tagName.text === TAG);
}

function functionValue(node: ts.Expression | undefined): boolean {
  if (node === undefined) return false;
  const value = stripParentheses(node);
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value);
}

/** The statement a function's JSDoc belongs to, and its name; undefined for any other node. */
function documented(node: ts.Node): { host: ts.Node; name: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name === undefined || node.body === undefined
      ? undefined
      : { host: node, name: node.name };
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) {
    return functionValue(node.initializer) ? { host: node, name: node.name } : undefined;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    functionValue(node.initializer) &&
    ts.isVariableDeclarationList(node.parent) &&
    node.parent.declarations.length === 1 &&
    ts.isVariableStatement(node.parent.parent)
  ) {
    return { host: node.parent.parent, name: node.name };
  }
  return undefined;
}

/** The function a declaration names: a function or method, or a `const` holding an arrow or function. */
function namedFunction(
  node: ts.Node,
): { name: ts.Node; fn: ts.FunctionLikeDeclaration } | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name !== undefined) {
    return { name: node.name, fn: node };
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const value = stripParentheses(node.initializer);
    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      return { name: node.name, fn: value };
    }
  }
  return undefined;
}

/** The names `test` checks with `instanceof` on `variable`, joined by `||`; undefined for any other test. */
function instanceofNames(test: ts.Expression, variable: string): ts.Expression[] | undefined {
  const node = stripParentheses(test);
  if (!ts.isBinaryExpression(node)) return undefined;
  if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = instanceofNames(node.left, variable);
    const right = instanceofNames(node.right, variable);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  if (node.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword) return undefined;
  const tested = stripParentheses(node.left);
  return ts.isIdentifier(tested) && tested.text === variable ? [node.right] : undefined;
}

/** Whether `node` throws the value named `variable` (`throw error`), outside nested functions. */
function throwsVariable(node: ts.Node, variable: string): boolean {
  if (ts.isFunctionLike(node)) return false;
  if (ts.isThrowStatement(node)) {
    const thrown = stripParentheses(node.expression);
    if (ts.isIdentifier(thrown) && thrown.text === variable) return true;
  }
  return ts.forEachChild(node, (child) => throwsVariable(child, variable) || undefined) === true;
}

/**
 * The helper a function is when its first statement is `if (p instanceof X) …` on one of its
 * parameters and that branch does not rethrow `p`: whatever else it does, it handles `X`.
 */
function errorHelperOf(
  fn: ts.FunctionLikeDeclaration,
  id: string,
  types: FileContext["types"],
): ErrorHelper | undefined {
  if (fn.body === undefined || !ts.isBlock(fn.body)) return undefined;
  const [first] = fn.body.statements;
  if (first === undefined || !ts.isIfStatement(first)) return undefined;
  for (const [parameter, declared] of fn.parameters.entries()) {
    if (!ts.isIdentifier(declared.name)) continue;
    const variable = declared.name.text;
    const named = instanceofNames(first.expression, variable);
    if (named === undefined || throwsVariable(first.thenStatement, variable)) continue;
    const classes = named.map((one) => classIdOf(types, one));
    if (classes.some((one) => one === undefined)) return undefined;
    return { id, parameter, classes: classes.filter((one) => one !== undefined) };
  }
  return undefined;
}

/** The calls in `clause` (not in nested functions) that pass its variable as an argument. */
function passesIn(clause: ts.CatchClause, ctx: FileContext): Pass[] {
  const declaration = clause.variableDeclaration;
  if (declaration === undefined || !ts.isIdentifier(declaration.name)) return [];
  const variable = declaration.name.text;
  const at = clause.getStart(ctx.sourceFile);
  const found: Pass[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = stripParentheses(node.expression);
      const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
      const symbol = ctx.types.symbolAt(name);
      for (const [argument, value] of node.arguments.entries()) {
        const passed = stripParentheses(value);
        if (symbol !== undefined && ts.isIdentifier(passed) && passed.text === variable) {
          found.push({ at, callee: symbol.id, argument });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(clause.block);
  return found;
}

function summarizeMustHandle(ctx: FileContext): MustHandleFacts {
  const { sourceFile, types } = ctx;
  const text = sourceFile.text;
  const tags: Tag[] = [];
  const untracked: Span[] = [];
  const anchors: Anchor[] = [];
  const helpers: ErrorHelper[] = [];
  const passes: Pass[] = [];
  const spanOfNode = (node: ts.Node): Span => [node.getStart(sourceFile), node.getEnd()];

  const visit = (node: ts.Node): void => {
    if (
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isVariableStatement(node)
    ) {
      const tag = mustHandleTag(node);
      const symbol =
        tag !== undefined && ts.isClassDeclaration(node) && node.name !== undefined
          ? types.symbolAt(node.name)
          : undefined;
      if (tag !== undefined && symbol !== undefined) {
        tags.push({
          id: symbol.id,
          name: symbol.name,
          how: oneLine(ts.getTextOfJSDocComment(tag.comment) ?? ""),
          at: spanOfNode(tag),
        });
      } else if (tag !== undefined) {
        untracked.push(spanOfNode(tag));
      }
    }
    const named = namedFunction(node);
    const symbol = named === undefined ? undefined : types.symbolAt(named.name);
    const helper =
      named === undefined || symbol === undefined
        ? undefined
        : errorHelperOf(named.fn, symbol.id, types);
    if (helper !== undefined) helpers.push(helper);
    if (ts.isCatchClause(node)) passes.push(...passesIn(node, ctx));
    const fn = documented(node);
    if (fn !== undefined) {
      const start = fn.host.getStart(sourceFile);
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const before = text.slice(lineStart, start);
      const doc = ts
        .getJSDocCommentsAndTags(ts.isVariableStatement(fn.host) ? fn.name.parent : fn.host)
        .filter((one) => ts.isJSDoc(one))
        .at(-1);
      const docStart = doc === undefined ? -1 : doc.getStart(sourceFile);
      anchors.push({
        name: fn.name.getStart(sourceFile),
        start,
        indent: /^\s*$/.test(before) ? before : "",
        doc:
          doc === undefined
            ? null
            : { start: docStart, end: doc.getEnd(), text: text.slice(docStart, doc.getEnd()) },
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { tags, untracked, anchors, helpers, passes };
}

function readTag(value: Json): Tag | undefined {
  const f = fieldsOf(value);
  const at = spanOf(f?.at);
  if (f === undefined || at === undefined) return undefined;
  return isString(f.id) && isString(f.name) && isString(f.how)
    ? { id: f.id, name: f.name, how: f.how, at }
    : undefined;
}

function readAnchor(value: Json): Anchor | undefined {
  const f = fieldsOf(value);
  if (f === undefined || typeof f.name !== "number" || typeof f.start !== "number") {
    return undefined;
  }
  if (!isString(f.indent)) return undefined;
  if (f.doc === null) return { name: f.name, start: f.start, indent: f.indent, doc: null };
  const doc = f.doc === undefined ? undefined : fieldsOf(f.doc);
  if (doc === undefined || typeof doc.start !== "number" || typeof doc.end !== "number") {
    return undefined;
  }
  if (!isString(doc.text)) return undefined;
  return {
    name: f.name,
    start: f.start,
    indent: f.indent,
    doc: { start: doc.start, end: doc.end, text: doc.text },
  };
}

function readHelper(value: Json): ErrorHelper | undefined {
  const f = fieldsOf(value);
  const classes = each(f?.classes, (one) => (isString(one) ? one : undefined));
  if (f === undefined || classes === undefined || !isString(f.id)) return undefined;
  return typeof f.parameter === "number"
    ? { id: f.id, parameter: f.parameter, classes }
    : undefined;
}

function readPass(value: Json): Pass | undefined {
  const f = fieldsOf(value);
  if (f === undefined || typeof f.at !== "number" || typeof f.argument !== "number") {
    return undefined;
  }
  return isString(f.callee) ? { at: f.at, callee: f.callee, argument: f.argument } : undefined;
}

/** The `@mustHandle` part of a summary as this rule wrote it; undefined for anything else. */
function readFacts(value: Json): MustHandleFacts | undefined {
  const f = fieldsOf(fieldsOf(value)?.mustHandle ?? null);
  const tags = each(f?.tags, readTag);
  const untracked = each(f?.untracked, spanOf);
  const anchors = each(f?.anchors, readAnchor);
  const helpers = each(f?.helpers, readHelper);
  const passes = each(f?.passes, readPass);
  return tags === undefined ||
    untracked === undefined ||
    anchors === undefined ||
    helpers === undefined ||
    passes === undefined
    ? undefined
    : { tags, untracked, anchors, helpers, passes };
}

// ---- deciding --------------------------------------------------------------------------------------

type TagWhere = { readonly file: string; readonly tag: Tag };

/** Where the error leaves the code around the call. */
type Scope =
  | { readonly kind: "function"; readonly entry: FunctionEntry }
  /** A function nothing calls by name (a handler, a callback): its caller cannot be followed. */
  | { readonly kind: "callback" }
  | { readonly kind: "module" };

/** What one `catch` does with the error: handles it by name, rethrows it, swallows it, or cannot tell. */
type Fate = "handled" | "rethrown" | "generic" | "undecided";

type Outcome =
  | { readonly kind: "handled" }
  | {
      readonly kind: "missing";
      /** The catch that treats every error alike, or the last one that rethrows it. */
      readonly by: { readonly fate: "generic" | "rethrown"; readonly handler: Handler } | null;
    }
  | { readonly kind: "callback" }
  | { readonly kind: "undecided" }
  | { readonly kind: "maybe" };

type Model = {
  readonly analysis: Analysis;
  readonly tags: ReadonlyMap<string, TagWhere>;
  readonly anchors: ReadonlyMap<string, ReadonlyMap<number, Anchor>>;
  /** The error helpers of the project, by function id. */
  readonly helpers: ReadonlyMap<string, ErrorHelper>;
  /** The calls that pass a caught error on, by file and the start of their `catch`. */
  readonly passes: ReadonlyMap<string, ReadonlyMap<number, readonly Pass[]>>;
};

/** The tag that makes `cls` must-handle: its own, or the nearest of a class it extends. */
function tagOf(cls: string, model: Model): TagWhere | undefined {
  let current: string | null = cls;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    const tag = model.tags.get(current);
    if (tag !== undefined) return tag;
    seen.add(current);
    const fact = model.analysis.classes.get(current);
    if (fact === undefined || fact.open) return undefined;
    current = fact.parent;
  }
  return undefined;
}

/** Whether naming `named` (in `instanceof` or `@throws`) is a choice about must-handle `cls`. */
function names(named: string, cls: string, model: Model): boolean {
  return (
    relation(named, cls, model.analysis.classes) === "yes" && tagOf(named, model) !== undefined
  );
}

/** Whether `effects` rethrow the variable of the catch declared at `of`. */
function rethrows(effects: readonly Effect[], of: number): boolean {
  return effects.some((effect) => {
    switch (effect.k) {
      case "rethrow":
        return effect.of === of;
      case "try": {
        const handler = effect.handler;
        return (
          rethrows(effect.body, of) ||
          rethrows(effect.fin, of) ||
          (handler !== null &&
            (rethrows(handler.pre, of) ||
              handler.branches.some((branch) => rethrows(branch.body, of)) ||
              rethrows(handler.otherwise ?? [], of) ||
              rethrows(handler.after, of)))
        );
      }
      case "class":
      case "unknown":
      case "maybe":
      case "call":
      case "package":
        return false;
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  });
}

/** Whether the `catch` hands its error to a helper that names `cls` first thing (one level). */
function passesToHelper(handler: Handler, file: string, cls: string, model: Model): boolean {
  const passes = model.passes.get(file)?.get(handler.at[0]) ?? [];
  return passes.some((pass) => {
    const helper = model.helpers.get(pass.callee);
    return (
      helper?.parameter === pass.argument && helper.classes.some((one) => names(one, cls, model))
    );
  });
}

function fateIn(handler: Handler, file: string, cls: string, model: Model): Fate {
  const { classes } = model.analysis;
  const of = handler.of;
  const passed = (escapes: boolean, named: boolean): Fate =>
    rethrows(handler.pre, of) || escapes ? "rethrown" : named ? "handled" : "generic";
  for (const branch of handler.branches) {
    const verdicts = branch.classes.map((named) => relation(named, cls, classes));
    if (verdicts.includes("undecided")) return "undecided";
    if (!verdicts.includes("yes")) continue;
    const named = branch.classes.some((one) => names(one, cls, model));
    // A test that is not only `instanceof` may let a generic branch pass the error on.
    if (!named && !branch.exact) continue;
    const escapes = rethrows(branch.body, of) || (!branch.exits && rethrows(handler.after, of));
    return passed(escapes, named);
  }
  const helped = passesToHelper(handler, file, cls, model);
  if (handler.otherwise !== null) {
    const escapes =
      rethrows(handler.otherwise, of) || (!handler.otherwiseExits && rethrows(handler.after, of));
    return passed(escapes, helped);
  }
  return passed(rethrows(handler.after, of), helped);
}

function decide(
  cls: string,
  certain: boolean,
  stack: readonly Handler[],
  scope: Scope,
  model: Model,
  file: string,
): Outcome {
  if (!certain) return { kind: "maybe" };
  let by: { fate: "rethrown"; handler: Handler } | null = null;
  for (const handler of [...stack].reverse()) {
    const fate = fateIn(handler, file, cls, model);
    switch (fate) {
      case "handled":
        return { kind: "handled" };
      case "undecided":
        return { kind: "undecided" };
      case "generic":
        return { kind: "missing", by: { fate, handler } };
      case "rethrown":
        by = { fate, handler };
        break;
      default: {
        const unreachable: never = fate;
        return unreachable;
      }
    }
  }
  switch (scope.kind) {
    case "callback":
      return { kind: "callback" };
    case "module":
      return { kind: "missing", by };
    case "function": {
      const doc = scope.entry.fact.doc;
      const declared = doc?.entries.some((item) => item.id !== null && names(item.id, cls, model));
      return declared === true ? { kind: "handled" } : { kind: "missing", by };
    }
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

/** One call that can throw a must-handle class, and what happens to it. */
type Met = {
  readonly file: string;
  readonly leaf: Extract<Leaf, { k: "call" }>;
  readonly cls: string;
  readonly scope: Scope;
  readonly outcome: Outcome;
};

function walk(
  effects: readonly Effect[],
  file: string,
  stack: readonly Handler[],
  scope: Scope,
  model: Model,
  meet: (met: Met) => void,
): void {
  for (const effect of effects) {
    switch (effect.k) {
      case "call": {
        const result = model.analysis.results.get(effect.id);
        if (result === undefined) break;
        const found = new Map<string, boolean>();
        const add = (thrown: Thrown): void => {
          for (const [id, certain] of thrown.classes) {
            found.set(id, (found.get(id) ?? false) || certain);
          }
        };
        if (effect.part !== "rejects") add(result.throws);
        if (effect.part !== "throws") add(result.rejects);
        for (const [cls, certain] of found) {
          if (tagOf(cls, model) === undefined) continue;
          const outcome = decide(cls, certain, stack, scope, model, file);
          meet({ file, leaf: effect, cls, scope, outcome });
        }
        break;
      }
      case "maybe":
        // A callback the platform may run during the call, or later: where its errors go is not known.
        walk(effect.body, file, [], { kind: "callback" }, model, meet);
        break;
      case "try": {
        const handler = effect.handler;
        walk(effect.body, file, handler === null ? stack : [...stack, handler], scope, model, meet);
        if (handler !== null) {
          walk(handler.pre, file, stack, scope, model, meet);
          for (const branch of handler.branches) walk(branch.body, file, stack, scope, model, meet);
          walk(handler.otherwise ?? [], file, stack, scope, model, meet);
          walk(handler.after, file, stack, scope, model, meet);
        }
        walk(effect.fin, file, stack, scope, model, meet);
        break;
      }
      case "class":
      case "unknown":
      case "package":
      case "rethrow":
        // What these add reaches a function's callers as its result: met at the calls of it.
        break;
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }
}

// ---- reporting -------------------------------------------------------------------------------------

/** An example line is at most 100 characters: 4 of indent, 5 for `  // `. */
const HOW_MAX = 91;

function locationOf(file: string, at: Span): Location {
  return { file, start: at[0], end: at[1] };
}

function hintLine(met: Met, name: string, model: Model): string {
  const outcome = met.outcome;
  const by = outcome.kind === "missing" ? outcome.by : null;
  const fn =
    met.scope.kind === "function" && met.scope.entry.fact.id !== ANONYMOUS
      ? met.scope.entry.fact.name
      : undefined;
  const tag = catchName(met.cls, model.analysis.classes);
  return fitted((cut) => {
    const passOn = fn === undefined ? undefined : `\`@throws {${cut(tag)}}\``;
    if (by?.fate === "generic") {
      return passOn === undefined || fn === undefined
        ? `name \`${cut(name)}\` in this \`catch\`, which treats every error alike:`
        : `name it in this \`catch\`, which treats every error alike, or rethrow it and add ${passOn} to \`${cut(fn)}\`:`;
    }
    if (by?.fate === "rethrown") {
      return passOn === undefined || fn === undefined
        ? "this `catch` passes it on and nothing above it handles it: handle it in the `catch`:"
        : `this \`catch\` passes it on: add ${passOn} to \`${cut(fn)}\`, or handle it in the \`catch\`:`;
    }
    return passOn === undefined || fn === undefined
      ? "name it in a `catch` around the call, or return it as a failure instead of throwing:"
      : `name it in a \`catch\`, pass it on with ${passOn} on \`${cut(fn)}\`, or return it as a failure instead of throwing:`;
  });
}

function hint(met: Met, how: string, model: Model): string {
  const name = className(met.cls, model.analysis.classes);
  const outcome = met.outcome;
  const variable =
    outcome.kind === "missing" && outcome.by !== null ? (outcome.by.handler.variable ?? "e") : "e";
  return withExample(hintLine(met, name, model), [
    `if (${variable} instanceof ${catchName(met.cls, model.analysis.classes)}) {`,
    how === "" ? "  …" : `  // ${shorten(how, HOW_MAX)}`,
    "}",
  ]);
}

function tagNote(met: Met, where: TagWhere, model: Model): RelatedLocation {
  const classes = model.analysis.classes;
  const name = className(met.cls, classes);
  const marked =
    where.tag.id === met.cls
      ? `\`${name}\` must be handled`
      : `\`${name}\` extends \`${className(where.tag.id, classes)}\`, which must be handled`;
  return {
    location: locationOf(where.file, where.tag.at),
    message: where.tag.how === "" ? `${marked} (\`@mustHandle\`)` : `${marked}: ${where.tag.how}`,
  };
}

/** The `@throws` the fix writes: every class the function surely lets out when it has none yet. */
function throwsText(entry: FunctionEntry, cls: string, model: Model): string {
  const classes = model.analysis.classes;
  const own = catchName(cls, classes);
  if (entry.fact.doc !== null) return own;
  const body = evaluated(entry, model.analysis).body;
  const all = new Set([own]);
  for (const part of [body.throws, body.rejects]) {
    for (const [id, info] of part.classes) if (info.certain) all.add(catchName(id, classes));
  }
  return [...all].sort().join(" | ");
}

/** "Pass it on": `@throws` in the function's JSDoc, which is created when there is none. */
function passOnFix(met: Met, model: Model): Fix | undefined {
  if (met.outcome.kind !== "missing" || met.outcome.by?.fate === "generic") return undefined;
  if (met.scope.kind !== "function" || met.scope.entry.fact.id === ANONYMOUS) return undefined;
  const entry = met.scope.entry;
  const anchor = model.anchors.get(entry.file)?.get(entry.fact.at[0]);
  if (anchor === undefined) return undefined;
  const types = throwsText(entry, met.cls, model);
  const line = `@throws {${types}}`;
  const { indent, doc } = anchor;
  let edit: { start: number; end: number; newText: string } | undefined;
  if (doc === null) {
    edit = { start: anchor.start, end: anchor.start, newText: `/** ${line} */\n${indent}` };
  } else if (doc.text.includes("\n")) {
    const close = doc.text.length - "*/".length;
    const lineStart = doc.text.lastIndexOf("\n", close) + 1;
    // Only a JSDoc whose `*/` stands on its own line: a new line goes just above it.
    if (doc.text.slice(lineStart, close).trim() !== "") return undefined;
    const at = doc.start + lineStart;
    edit = { start: at, end: at, newText: `${indent} * ${line}\n` };
  } else {
    const content = doc.text.slice("/**".length, -"*/".length).trim();
    edit = {
      start: doc.start,
      end: doc.end,
      newText:
        content === ""
          ? `/** ${line} */`
          : `/**\n${indent} * ${content}\n${indent} * ${line}\n${indent} */`,
    };
  }
  return {
    title: `Pass it on: add \`${line}\` to \`${entry.fact.name}\``,
    edits: [
      {
        location: { file: entry.file, start: edit.start, end: edit.end },
        newText: edit.newText,
      },
    ],
  };
}

type Reporter = {
  problem(problem: {
    message: string;
    hint: string;
    location: Location;
    related: readonly RelatedLocation[];
    fixes: readonly Fix[];
  }): void;
  unknown(unknown: { message: string; hint: string; location: Location }): void;
};

function report(met: Met, model: Model, out: Reporter): void {
  const where = tagOf(met.cls, model);
  if (where === undefined) return;
  const classes = model.analysis.classes;
  const name = className(met.cls, classes);
  const tag = catchName(met.cls, classes);
  const call = `${met.leaf.text}(…)`;
  const location = locationOf(met.file, met.leaf.at);
  const { outcome } = met;
  switch (outcome.kind) {
    case "handled":
      return;
    case "missing": {
      const related: RelatedLocation[] = [];
      if (outcome.by !== null) {
        related.push({
          location: locationOf(met.file, outcome.by.handler.at),
          message:
            outcome.by.fate === "generic"
              ? `this \`catch\` does not name \`${name}\`: it handles every error alike`
              : `this \`catch\` rethrows \`${name}\``,
        });
      }
      related.push(tagNote(met, where, model));
      const fix = passOnFix(met, model);
      out.problem({
        message: fitted(
          (cut) => `\`${cut(call)}\` can throw \`${cut(name)}\`, which must be handled`,
        ),
        hint: hint(met, where.tag.how, model),
        location,
        related,
        fixes: fix === undefined ? [] : [fix],
      });
      return;
    }
    case "callback":
      out.unknown({
        message: fitted(
          (cut) =>
            `\`${cut(call)}\` can throw \`${cut(name)}\` out of a callback stateward cannot follow`,
        ),
        hint: fitted(
          (cut) =>
            `name \`${cut(tag)}\` in a \`catch\` here, or make sure the code that calls this callback does: it must be handled`,
        ),
        location,
      });
      return;
    case "undecided":
      out.unknown({
        message: fitted(
          (cut) =>
            `stateward cannot tell whether the \`catch\` around \`${cut(call)}\` handles \`${cut(name)}\``,
        ),
        hint: fitted(
          (cut) =>
            `name it with \`instanceof ${cut(tag)}\`: stateward cannot follow what a class this \`catch\` tests extends`,
        ),
        location,
      });
      return;
    case "maybe":
      out.unknown({
        message: fitted(
          (cut) =>
            `stateward cannot tell whether \`${cut(call)}\` can still throw \`${cut(name)}\`, which must be handled`,
        ),
        hint: fitted(
          (cut) =>
            `name it in a \`catch\`, or pass it on with \`@throws {${cut(tag)}}\`: a test inside \`${cut(met.leaf.text)}\` may handle it`,
        ),
        location,
      });
      return;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

function modelOf(summaries: ReadonlyMap<string, Json>): {
  model: Model;
  untracked: readonly Location[];
} {
  const analysis = analyse(throwsOf(summaries));
  const tags = new Map<string, TagWhere>();
  const anchors = new Map<string, ReadonlyMap<number, Anchor>>();
  const helpers = new Map<string, ErrorHelper>();
  const passes = new Map<string, Map<number, Pass[]>>();
  const untracked: Location[] = [];
  for (const [file, value] of summaries) {
    const facts = readFacts(value);
    if (facts === undefined) continue;
    for (const tag of facts.tags) tags.set(tag.id, { file, tag });
    for (const at of facts.untracked) untracked.push(locationOf(file, at));
    anchors.set(file, new Map(facts.anchors.map((anchor) => [anchor.name, anchor])));
    for (const helper of facts.helpers) helpers.set(helper.id, helper);
    const byCatch = new Map<number, Pass[]>();
    for (const pass of facts.passes) byCatch.set(pass.at, [...(byCatch.get(pass.at) ?? []), pass]);
    passes.set(file, byCatch);
  }
  return { model: { analysis, tags, anchors, helpers, passes }, untracked };
}

export const mustHandleError = defineRule({
  kind: "project",
  meta: {
    description:
      "An error class marked @mustHandle is named in a catch or passed on with @throws by every call that can throw it.",
    defaultSeverity: "error",
    tier: "core",
    group: GROUP,
    needsJsDoc: true,
    listUnknowns: true,
    explain: EXPLAIN,
  },
  summarize: (ctx): MustHandleSummary => ({
    throws: summarizeOnce(ctx),
    mustHandle: summarizeMustHandle(ctx),
  }),
  check(summaries, ctx) {
    const { model, untracked } = modelOf(summaries);
    for (const location of untracked) {
      ctx.unknown({
        message: "stateward does not check `@mustHandle` on a type yet, only on an error class",
        hint: "to have every call checked, throw an error class marked `@mustHandle`; plain-object errors come later",
        location,
      });
    }
    if (model.tags.size === 0) return;
    const decided = new Set<string>();
    const mets: Met[] = [];
    const out: Reporter = {
      problem: (problem) => {
        ctx.report(problem);
      },
      unknown: (unknown) => {
        ctx.unknown(unknown);
      },
    };
    const meet = (met: Met): void => {
      const key = `${met.file}\u0000${String(met.leaf.at[0])}\u0000${met.cls}`;
      if (decided.has(key)) return;
      decided.add(key);
      mets.push(met);
    };
    const anonymous: FunctionEntry[] = [];
    // Named functions and the module first: a callback written inline (`items.forEach(…)`) is
    // also evaluated where it is called, which knows the `try` around it.
    for (const entry of model.analysis.functions.values()) {
      if (entry.fact.id === ANONYMOUS) {
        anonymous.push(entry);
        continue;
      }
      const scope: Scope = { kind: "function", entry };
      walk(entry.fact.body, entry.file, [], scope, model, meet);
      walk(entry.fact.returns, entry.file, [], scope, model, meet);
    }
    for (const { file, effects } of model.analysis.modules) {
      walk(effects, file, [], { kind: "module" }, model, meet);
    }
    for (const entry of anonymous) {
      walk(entry.fact.body, entry.file, [], { kind: "callback" }, model, meet);
      walk(entry.fact.returns, entry.file, [], { kind: "callback" }, model, meet);
    }
    // A helper declared inside a function is judged where it is called: when every call of it
    // sits in a `try` that handles the class, its own body is not reported.
    const calls = new Map<string, Met[]>();
    for (const met of mets) calls.set(met.leaf.id, [...(calls.get(met.leaf.id) ?? []), met]);
    const covered = (met: Met): boolean => {
      if (met.scope.kind !== "function" || !met.scope.entry.fact.local) return false;
      if (met.outcome.kind !== "missing") return false;
      const called = (calls.get(met.scope.entry.fact.id) ?? []).filter(
        (one) => one.cls === met.cls,
      );
      return called.length > 0 && called.every((one) => one.outcome.kind === "handled");
    };
    for (const met of mets) if (!covered(met)) report(met, model, out);
  },
});
