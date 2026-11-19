import ts from "@stateward/core/typescript";
import type { Fix, SignalParameter, TextEdit, TypeQueries } from "@stateward/core";
import {
  cleanupCalls,
  declarationNode,
  isFunctionNode,
  setterCall,
  within,
  type Cleanups,
  type Effect,
} from "./effects.js";
import { contains, type StateWrite } from "./late-writes.js";
import { unwrapped } from "./react.js";

/**
 * Packages whose requests manage their own cancellation (TanStack Query, SWR, RTK Query): a call
 * into them is not this effect's to abort.
 */
const MANAGED_PACKAGES: readonly RegExp[] = [
  /^@tanstack\//,
  /^react-query$/,
  /^swr$/,
  /^@reduxjs\/toolkit$/,
  /^@rtk-query\//,
];

/**
 * A call in an effect whose callee takes an abort signal (a loader that states it can be
 * cancelled), and the state writes that wait for its answer. A call to a function of the component
 * that sets state is its own write (`load(controller.signal)`).
 */
export type Loader = {
  readonly call: ts.CallExpression;
  readonly at: SignalParameter;
  readonly writes: readonly ts.Node[];
  /** The writes are the callee's own (a function of the component): no flag can guard them here. */
  readonly writesInCallee: boolean;
};

/** What is missing for a loader's late answer to be dropped, or that it is. */
export type Verdict =
  | { readonly kind: "proven" }
  /** No signal is passed to the call. */
  | { readonly kind: "pass" }
  /** The signal comes from the effect's controller, which the cleanup never aborts. */
  | { readonly kind: "abort"; readonly controller: ts.VariableDeclaration; readonly name: string }
  /** The cleanup aborts the effect's controller only on some paths (`if (keep) c.abort()`). */
  | {
      readonly kind: "conditional";
      readonly controller: ts.VariableDeclaration;
      readonly name: string;
    }
  /** The signal comes from something the effect does not create, or stateward cannot follow it. */
  | { readonly kind: "foreign" }
  /** The effect returns a cleanup stateward cannot read. */
  | { readonly kind: "unreadable" };

function calledFromManagedPackage(types: TypeQueries, call: ts.CallExpression): boolean {
  const callee = unwrapped(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : types.declarationOf(symbol);
  const owner = declaration === undefined ? undefined : types.packageOf(declaration.file);
  return owner !== undefined && MANAGED_PACKAGES.some((pattern) => pattern.test(owner));
}

/** The function a name declares, written in the component around the effect (not in the effect). */
function componentFunction(
  types: TypeQueries,
  effect: Effect,
  callee: ts.Expression,
): ts.SignatureDeclaration | undefined {
  if (!ts.isIdentifier(callee)) return undefined;
  const declaration = declarationNode(types, callee);
  if (
    declaration === undefined ||
    !within(declaration, effect.owner) ||
    within(declaration, effect.callback)
  ) {
    return undefined;
  }
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
    return undefined;
  }
  const init = unwrapped(declaration.initializer);
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  // `const load = useCallback(async (signal) => { … }, [id])`
  const [first] = ts.isCallExpression(init) ? init.arguments : [];
  const wrapped = first === undefined ? undefined : unwrapped(first);
  return wrapped !== undefined && (ts.isArrowFunction(wrapped) || ts.isFunctionExpression(wrapped))
    ? wrapped
    : undefined;
}

function setsState(types: TypeQueries, fn: ts.SignatureDeclaration): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (setterCall(types, node) !== undefined) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return found;
}

/** The calls in an effect (not in its cleanup) that take a signal and whose answer sets state. */
export function loadersIn(
  types: TypeQueries,
  effect: Effect,
  writes: readonly StateWrite[],
  cleanups: Cleanups,
): readonly Loader[] {
  const loaders: Loader[] = [];
  const visit = (node: ts.Node): void => {
    if (cleanups.functions.some((fn) => fn === node)) return;
    if (ts.isCallExpression(node)) {
      const at = types.signalParameterOf(node);
      if (at !== undefined && !calledFromManagedPackage(types, node)) {
        const waiting = writes
          .filter(
            (write) =>
              (write.then !== undefined && contains(write.then, node)) ||
              write.awaited.some((awaited) => contains(awaited, node)),
          )
          .map((write) => write.node);
        const own = componentFunction(types, effect, unwrapped(node.expression));
        if (waiting.length > 0) {
          loaders.push({ call: node, at, writes: waiting, writesInCallee: false });
        } else if (own !== undefined && setsState(types, own)) {
          loaders.push({ call: node, at, writes: [node], writesInCallee: true });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(effect.callback, visit);
  return loaders;
}

/** The signal a call is given, by where the callee takes it; "none" when it is given none. */
function signalArgument(
  types: TypeQueries,
  effect: Effect,
  call: ts.CallExpression,
  at: SignalParameter,
): ts.Expression | "none" | "unreadable" {
  const argument = call.arguments[at.index];
  if (argument === undefined || ts.isSpreadElement(argument)) {
    return call.arguments.some(ts.isSpreadElement) ? "unreadable" : "none";
  }
  const value = unwrapped(argument);
  if (ts.isIdentifier(value) && value.text === "undefined") return "none";
  if (at.property === undefined) return value;
  return signalProperty(types, effect, value, 0);
}

/** The `signal` of an options object written in the effect: `{ signal }`, `{ signal: c.signal }`. */
function signalProperty(
  types: TypeQueries,
  effect: Effect,
  options: ts.Expression,
  depth: number,
): ts.Expression | "none" | "unreadable" {
  if (ts.isIdentifier(options) && depth === 0) {
    const declaration = declarationNode(types, options);
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      within(declaration, effect.callback) &&
      declaration.initializer !== undefined
    ) {
      return signalProperty(types, effect, unwrapped(declaration.initializer), depth + 1);
    }
    return "unreadable";
  }
  if (!ts.isObjectLiteralExpression(options)) return "unreadable";
  for (const property of options.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "signal") {
      return property.name;
    }
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "signal"
    ) {
      return unwrapped(property.initializer);
    }
  }
  return options.properties.some(ts.isSpreadAssignment) ? "unreadable" : "none";
}

/** The names a binding declares: `a`, or each name in `{ a, b: [c] }`. */
function declaredNames(name: ts.BindingName): (ts.Identifier & { parent: ts.Node })[] {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : declaredNames(element.name),
  );
}

/**
 * The declaration a name written as `{ signal }` reads, found by scope: the symbol at a shorthand
 * property is the property's, not the variable's. Looks from `from` up to `stop`, in the blocks
 * and parameter lists around it.
 */
function lexicalDeclaration(name: string, from: ts.Node, stop: ts.Node): ts.Node | undefined {
  for (let current = from.parent; ; current = current.parent) {
    const candidates: ts.BindingName[] = [];
    if (ts.isBlock(current)) {
      for (const statement of current.statements) {
        if (statement.pos >= from.pos || !ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          candidates.push(declaration.name);
        }
      }
    }
    if (isFunctionNode(current)) {
      for (const parameter of current.parameters) candidates.push(parameter.name);
    }
    const found = candidates.flatMap(declaredNames).find((identifier) => identifier.text === name);
    if (found !== undefined) return found.parent;
    if (current === stop || ts.isSourceFile(current)) return undefined;
  }
}

/** Where a signal comes from: a controller the effect creates, or a parameter of its own function. */
type Source =
  | {
      readonly kind: "controller";
      readonly declaration: ts.VariableDeclaration;
      readonly name: string;
    }
  | { readonly kind: "parameter"; readonly fn: ts.SignatureDeclaration; readonly index: number }
  | { readonly kind: "foreign" };

function isNewAbortController(expression: ts.Expression): boolean {
  const value = unwrapped(expression);
  return (
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "AbortController"
  );
}

/** The `const c = new AbortController()` an identifier names, declared in the effect. */
function controllerOf(
  types: TypeQueries,
  effect: Effect,
  node: ts.Expression,
): ts.VariableDeclaration | undefined {
  if (!ts.isIdentifier(node)) return undefined;
  const declaration = declarationNode(types, node);
  return declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    within(declaration, effect.callback) &&
    declaration.initializer !== undefined &&
    isNewAbortController(declaration.initializer)
    ? declaration
    : undefined;
}

function sourceOf(
  types: TypeQueries,
  effect: Effect,
  signal: ts.Expression,
  depth: number,
): Source {
  const value = unwrapped(signal);
  if (depth > 3) return { kind: "foreign" };
  // `controller.signal`
  if (ts.isPropertyAccessExpression(value) && value.name.text === "signal") {
    const controller = controllerOf(types, effect, unwrapped(value.expression));
    return controller !== undefined && ts.isIdentifier(controller.name)
      ? { kind: "controller", declaration: controller, name: controller.name.text }
      : { kind: "foreign" };
  }
  if (!ts.isIdentifier(value)) return { kind: "foreign" };
  const declaration = ts.isShorthandPropertyAssignment(value.parent)
    ? lexicalDeclaration(value.text, value, effect.callback)
    : declarationNode(types, value);
  if (declaration === undefined || !within(declaration, effect.callback))
    return { kind: "foreign" };
  // `const signal = controller.signal`
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    return sourceOf(types, effect, declaration.initializer, depth + 1);
  }
  // `const { signal } = controller`
  if (
    ts.isBindingElement(declaration) &&
    ts.isObjectBindingPattern(declaration.parent) &&
    ts.isVariableDeclaration(declaration.parent.parent)
  ) {
    const key = declaration.propertyName ?? declaration.name;
    const init = declaration.parent.parent.initializer;
    const controller =
      init === undefined ? undefined : controllerOf(types, effect, unwrapped(init));
    return ts.isIdentifier(key) &&
      key.text === "signal" &&
      controller !== undefined &&
      ts.isIdentifier(controller.name)
      ? { kind: "controller", declaration: controller, name: controller.name.text }
      : { kind: "foreign" };
  }
  // `async function load(signal: AbortSignal) { … }` in the effect: a signal it receives.
  if (ts.isParameter(declaration) && isFunctionNode(declaration.parent)) {
    const fn = declaration.parent;
    return fn === effect.callback
      ? { kind: "foreign" }
      : { kind: "parameter", fn, index: fn.parameters.indexOf(declaration) };
  }
  return { kind: "foreign" };
}

/**
 * Whether the effect's cleanup calls `controller.abort()` on every path (`"always"`), only on some
 * (`"some"`: under an `if`, a `?:`, `&&`, `||`, `??`, a loop, a `switch` case or a `catch`), or
 * not at all.
 */
function abortsInCleanup(
  types: TypeQueries,
  effect: Effect,
  cleanups: Cleanups,
  controller: ts.VariableDeclaration,
): "always" | "some" | "none" {
  const aborts = cleanupCalls(types, effect, cleanups).filter((call) => {
    const callee = unwrapped(call.expression);
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "abort" &&
      controllerOf(types, effect, unwrapped(callee.expression)) === controller
    );
  });
  if (aborts.length === 0) return "none";
  return aborts.some((call) => !onSomePaths(call)) ? "always" : "some";
}

/** Whether a call runs only on some paths of the function it is written in. */
function onSomePaths(call: ts.Node): boolean {
  for (let child = call; !isFunctionNode(child.parent); child = child.parent) {
    const parent = child.parent;
    if (ts.isSourceFile(parent)) return false;
    if (ts.isIfStatement(parent) && parent.expression !== child) return true;
    if (ts.isConditionalExpression(parent) && parent.condition !== child) return true;
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === child &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return true;
    }
    if (
      ts.isIterationStatement(parent, false) ||
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent) ||
      ts.isCatchClause(parent)
    ) {
      return true;
    }
    // `c?.abort()`: the call runs only when `c` is there.
    if (ts.isCallExpression(child) && child.questionDotToken !== undefined) return true;
  }
  return false;
}

/** The node that names a function declared in the effect, by which calls to it are found. */
function declaredName(fn: ts.SignatureDeclaration): ts.Node | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn;
  const parent = fn.parent;
  return ts.isVariableDeclaration(parent) && parent.initializer === fn ? parent : undefined;
}

/** The calls in the effect to a function declared in it. */
function callsTo(
  types: TypeQueries,
  effect: Effect,
  fn: ts.SignatureDeclaration,
): ts.CallExpression[] {
  const declared = declaredName(fn);
  if (declared === undefined) return [];
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapped(node.expression);
      if (ts.isIdentifier(callee) && declarationNode(types, callee) === declared) calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(effect.callback, visit);
  return calls;
}

const ORDER: Readonly<Record<Verdict["kind"], number>> = {
  proven: 0,
  conditional: 1,
  abort: 2,
  pass: 3,
  foreign: 4,
  unreadable: 5,
};

function worst(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>(
    (found, verdict) => (ORDER[verdict.kind] > ORDER[found.kind] ? verdict : found),
    { kind: "proven" },
  );
}

/** Whether a signal is the effect's own, aborted in its cleanup. */
function proveSignal(
  types: TypeQueries,
  effect: Effect,
  cleanups: Cleanups,
  signal: ts.Expression,
  depth: number,
): Verdict {
  const source = sourceOf(types, effect, signal, depth);
  switch (source.kind) {
    case "controller":
      if (cleanups.unreadable) return { kind: "unreadable" };
      {
        const aborts = abortsInCleanup(types, effect, cleanups, source.declaration);
        if (aborts === "always") return { kind: "proven" };
        return {
          kind: aborts === "some" ? "conditional" : "abort",
          controller: source.declaration,
          name: source.name,
        };
      }
    case "parameter": {
      // Every call of the function in the effect hands it the effect's signal.
      const calls = callsTo(types, effect, source.fn);
      if (calls.length === 0) return { kind: "foreign" };
      return worst(
        calls.map((call) => {
          const argument = call.arguments[source.index];
          return argument === undefined || ts.isSpreadElement(argument)
            ? { kind: "pass" }
            : proveSignal(types, effect, cleanups, argument, depth + 1);
        }),
      );
    }
    case "foreign":
      return { kind: "foreign" };
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

/** Whether the call is given the effect's signal, aborted in the cleanup. */
export function proveAborted(
  types: TypeQueries,
  effect: Effect,
  cleanups: Cleanups,
  loader: Loader,
): Verdict {
  const signal = signalArgument(types, effect, loader.call, loader.at);
  if (signal === "none") return { kind: "pass" };
  if (signal === "unreadable") return { kind: "foreign" };
  return proveSignal(types, effect, cleanups, signal, 0);
}

/** A `let` flag of the effect with a boolean start (`let ignore = false`) that the cleanup flips. */
type Flag = { readonly declaration: ts.VariableDeclaration; readonly start: boolean };

function booleanLiteral(expression: ts.Expression): boolean | undefined {
  const value = unwrapped(expression);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** The flags the cleanup sets to the opposite of their start. */
function flagsOf(types: TypeQueries, effect: Effect, cleanups: Cleanups): readonly Flag[] {
  const body = effect.callback.body;
  if (!ts.isBlock(body)) return [];
  const flags: Flag[] = [];
  for (const statement of body.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Let) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const start =
        declaration.initializer === undefined ? undefined : booleanLiteral(declaration.initializer);
      if (start === undefined || !ts.isIdentifier(declaration.name)) continue;
      const flipped = cleanups.functions.some((fn) => {
        let found = false;
        const visit = (node: ts.Node): void => {
          if (found) return;
          if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(node.left) &&
            declarationNode(types, node.left) === declaration &&
            booleanLiteral(node.right) === !start
          ) {
            found = true;
            return;
          }
          ts.forEachChild(node, visit);
        };
        visit(fn);
        return found;
      });
      if (flipped && !writtenOutside(types, effect, cleanups, declaration)) {
        flags.push({ declaration, start });
      }
    }
  }
  return flags;
}

/**
 * Whether the effect writes the flag anywhere but its declaration and its cleanups: a write such as
 * `active = true` after the `await` sets it back before its test, so the test no longer tells a
 * late answer.
 */
function writtenOutside(
  types: TypeQueries,
  effect: Effect,
  cleanups: Cleanups,
  declaration: ts.VariableDeclaration,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || cleanups.functions.some((fn) => fn === node)) return;
    const target =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? node.left
        : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken ||
              node.operator === ts.SyntaxKind.MinusMinusToken)
          ? node.operand
          : undefined;
    const inner = target === undefined ? undefined : unwrapped(target);
    if (
      inner !== undefined &&
      ts.isIdentifier(inner) &&
      declarationNode(types, inner) === declaration
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(effect.callback.body);
  return found;
}

/** The value of the flag under which a test is true (`!ignore`: false), or undefined. */
function testedValue(types: TypeQueries, test: ts.Expression, flag: Flag): boolean | undefined {
  const value = unwrapped(test);
  const isFlag = (node: ts.Expression): boolean => {
    const inner = unwrapped(node);
    return ts.isIdentifier(inner) && declarationNode(types, inner) === flag.declaration;
  };
  if (isFlag(value)) return true;
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    return isFlag(value.operand) ? false : undefined;
  }
  if (ts.isBinaryExpression(value)) {
    const kind = value.operatorToken.kind;
    const equal =
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken;
    const notEqual =
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsToken;
    if (!equal && !notEqual) return undefined;
    const literal = isFlag(value.left)
      ? booleanLiteral(value.right)
      : isFlag(value.right)
        ? booleanLiteral(value.left)
        : undefined;
    return literal === undefined ? undefined : equal ? literal : !literal;
  }
  return undefined;
}

/** The parts of a `&&` chain (or of a `||` chain), or the test itself. */
function parts(test: ts.Expression, operator: ts.SyntaxKind): ts.Expression[] {
  const value = unwrapped(test);
  return ts.isBinaryExpression(value) && value.operatorToken.kind === operator
    ? [...parts(value.left, operator), ...parts(value.right, operator)]
    : [value];
}

/** A test true only while the flag still has its start value: the write runs only then. */
function runsOnlyFresh(types: TypeQueries, test: ts.Expression, flag: Flag): boolean {
  return parts(test, ts.SyntaxKind.AmpersandAmpersandToken).some(
    (part) => testedValue(types, part, flag) === flag.start,
  );
}

/** A test true whenever the flag is flipped: an exit under it leaves before the write. */
function exitsWhenStale(types: TypeQueries, test: ts.Expression, flag: Flag): boolean {
  return parts(test, ts.SyntaxKind.BarBarToken).some(
    (part) => testedValue(types, part, flag) === !flag.start,
  );
}

/** `return;`, `return x;`, or a block that ends with one. */
function exits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  const last = statement.statements[statement.statements.length - 1];
  return last !== undefined && ts.isReturnStatement(last);
}

/** Whether `node` has an `await` (or `for await`) that starts before `end`, not in a function inside it. */
function awaitsIn(node: ts.Node, end: number): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found || child.getStart() >= end || isFunctionNode(child)) return;
    if (
      ts.isAwaitExpression(child) ||
      (ts.isForOfStatement(child) && child.awaitModifier !== undefined)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * Whether a write runs only while the flag is fresh: inside `if (!ignore)`, after `!ignore &&`,
 * or after an `if (ignore) return;` in a block around it, all in the write's own function.
 */
function guardedByFlag(types: TypeQueries, write: ts.Node, flag: Flag, stop: ts.Node): boolean {
  for (
    let child = write, current = write.parent;
    child !== stop;
    child = current, current = current.parent
  ) {
    // A test outside the write's own function runs when the request starts, not when it answers.
    if (isFunctionNode(current)) break;
    if (ts.isIfStatement(current) && current.thenStatement === child) {
      if (runsOnlyFresh(types, current.expression, flag)) return true;
    }
    if (ts.isConditionalExpression(current) && current.whenTrue === child) {
      if (runsOnlyFresh(types, current.condition, flag)) return true;
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      current.right === child &&
      runsOnlyFresh(types, current.left, flag)
    ) {
      return true;
    }
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      const all = current.statements.slice(
        0,
        current.statements.findIndex((s) => s === child),
      );
      // A check before an `await` runs when the request starts, not when it answers: only the
      // checks after the last `await` before the write count.
      const lastAwait = all.findLastIndex((statement) => awaitsIn(statement, statement.end));
      const before = awaitsIn(child, write.getStart()) ? [] : all.slice(lastAwait + 1);
      if (
        before.some(
          (statement) =>
            ts.isIfStatement(statement) &&
            exits(statement.thenStatement) &&
            exitsWhenStale(types, statement.expression, flag),
        )
      ) {
        return true;
      }
    }
    if (current === stop) break;
  }
  return false;
}

/** Whether every write of the loader is guarded by one flag the cleanup flips (the React docs' `ignore`). */
export function guardedByStaleFlag(
  types: TypeQueries,
  effect: Effect,
  cleanups: Cleanups,
  loader: Loader,
): boolean {
  if (loader.writesInCallee || cleanups.unreadable) return false;
  return flagsOf(types, effect, cleanups).some((flag) =>
    loader.writes.every((write) => guardedByFlag(types, write, flag, effect.callback)),
  );
}

/** The `const c = new AbortController()` written at the top level of the effect, if any. */
function topController(effect: Effect): ts.VariableDeclaration | undefined {
  const body = effect.callback.body;
  if (!ts.isBlock(body)) return undefined;
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer !== undefined &&
        isNewAbortController(declaration.initializer)
      ) {
        return declaration;
      }
    }
  }
  return undefined;
}

/** A name not yet written in the effect: `controller`, else `abortController`, `controller2`, … */
function freeName(effect: Effect): string {
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) used.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(effect.owner);
  const candidates = ["controller", "abortController"];
  for (const name of candidates) if (!used.has(name)) return name;
  for (let index = 2; ; index += 1) {
    const name = `controller${String(index)}`;
    if (!used.has(name)) return name;
  }
}

function indentAt(sourceFile: ts.SourceFile, position: number): string {
  const lineStart = sourceFile.text.lastIndexOf("\n", position - 1) + 1;
  const prefix = sourceFile.text.slice(lineStart, position);
  return /^\s*$/.test(prefix) ? prefix : "";
}

function edit(sourceFile: ts.SourceFile, start: number, end: number, newText: string): TextEdit {
  return { location: { file: sourceFile.fileName, start, end }, newText };
}

/** The edit that hands a call the controller's signal where its callee takes it. */
function passEdit(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  at: SignalParameter,
  name: string,
): TextEdit | undefined {
  const signal = `${name}.signal`;
  const value = at.property === undefined ? signal : `{ signal: ${signal} }`;
  const args = call.arguments;
  if (args.length === at.index) {
    const previous = args[at.index - 1];
    return previous === undefined
      ? edit(sourceFile, args.pos, args.pos, value)
      : edit(sourceFile, previous.end, previous.end, `, ${value}`);
  }
  const argument = args[at.index];
  if (argument === undefined || args.length < at.index) return undefined;
  const start = argument.getStart(sourceFile);
  const inner = unwrapped(argument);
  if (ts.isIdentifier(inner) && inner.text === "undefined") {
    return edit(sourceFile, start, argument.end, value);
  }
  if (at.property === undefined) return undefined;
  if (ts.isObjectLiteralExpression(inner)) {
    const last = inner.properties[inner.properties.length - 1];
    return last === undefined
      ? edit(sourceFile, start, argument.end, value)
      : edit(sourceFile, last.end, last.end, `, signal: ${signal}`);
  }
  return edit(
    sourceFile,
    start,
    argument.end,
    `{ ...${argument.getText(sourceFile)}, signal: ${signal} }`,
  );
}

/** The edit that aborts the controller in the effect's cleanup, adding the cleanup if it has none. */
function abortEdit(sourceFile: ts.SourceFile, body: ts.Block, name: string): TextEdit | undefined {
  const abort = `${name}.abort();`;
  const returns = body.statements.filter(ts.isReturnStatement);
  const last = body.statements[body.statements.length - 1];
  if (last === undefined) return undefined;
  const indent = indentAt(sourceFile, last.getStart(sourceFile));
  const returnsIn = (node: ts.Node): boolean =>
    ts.isReturnStatement(node) ||
    (!isFunctionNode(node) && ts.forEachChild(node, returnsIn) === true);
  // A return inside a branch leaves the effect without the cleanup on that path.
  if (
    body.statements.some((statement) => !ts.isReturnStatement(statement) && returnsIn(statement))
  ) {
    return undefined;
  }
  if (returns.length === 0) {
    return edit(sourceFile, last.end, last.end, `\n${indent}return () => ${abort.slice(0, -1)};`);
  }
  const [only] = returns;
  if (returns.length !== 1 || only !== last || only.expression === undefined) return undefined;
  const cleanup = unwrapped(only.expression);
  if (!ts.isArrowFunction(cleanup) && !ts.isFunctionExpression(cleanup)) return undefined;
  if (ts.isBlock(cleanup.body)) {
    const first = cleanup.body.statements[0];
    if (first === undefined) {
      return edit(sourceFile, cleanup.body.getStart(sourceFile), cleanup.body.end, `{ ${abort} }`);
    }
    const start = first.getStart(sourceFile);
    return edit(sourceFile, start, start, `${abort}\n${indentAt(sourceFile, start)}`);
  }
  const text = cleanup.body.getText(sourceFile);
  return edit(
    sourceFile,
    cleanup.body.getStart(sourceFile),
    cleanup.body.end,
    `{\n${indent}  ${abort}\n${indent}  ${text};\n${indent}}`,
  );
}

/** The call as the quick fix writes it, with the controller's signal passed: `fetchUser(userId, controller.signal)`. */
export function withSignalText(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  at: SignalParameter,
  name: string,
): string | undefined {
  const start = call.getStart(sourceFile);
  const { text } = sourceFile;
  const pass = passEdit(sourceFile, call, at, name);
  if (pass === undefined) {
    // A signal from elsewhere in a plain argument (`ref.current.signal`) is replaced by the controller's.
    const argument = at.property === undefined ? call.arguments[at.index] : undefined;
    return argument === undefined
      ? undefined
      : (
          text.slice(start, argument.getStart(sourceFile)) +
          `${name}.signal` +
          text.slice(argument.end, call.end)
        ).replace(/\s+/g, " ");
  }
  const written =
    text.slice(start, pass.location.start) + pass.newText + text.slice(pass.location.end, call.end);
  return written.replace(/\s+/g, " ");
}

/**
 * What handles the rejection of a request: a `.catch(…)` (or the second argument of `.then`) after
 * the call, or the `catch` of a `try` around its `await`. `block` is a handler with a parameter
 * and a body whose first statement the quick fix can put a line before; `voidReturn` says whether
 * `return;` is a statement that function can end with.
 */
export type RejectionHandler =
  | {
      readonly kind: "block";
      readonly param: string;
      readonly at: number;
      readonly voidReturn: boolean;
    }
  | { readonly kind: "other" };

function returnsValue(fn: ts.FunctionLikeDeclaration): boolean {
  if (fn.type !== undefined && !/^(?:Promise<)?(?:void|undefined)>?$/.test(fn.type.getText())) {
    return true;
  }
  if (fn.body === undefined || !ts.isBlock(fn.body)) return true;
  const visit = (node: ts.Node): boolean =>
    (ts.isReturnStatement(node) && node.expression !== undefined) ||
    (!isFunctionNode(node) && ts.forEachChild(node, visit) === true);
  return ts.forEachChild(fn.body, visit) === true;
}

/** The function that contains `node`, when it is one that has a body. */
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
  }
  return undefined;
}

function handlerOf(sourceFile: ts.SourceFile, handler: ts.Expression): RejectionHandler {
  const fn = unwrapped(handler);
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return { kind: "other" };
  const [first] = fn.parameters;
  const statement = ts.isBlock(fn.body) ? fn.body.statements[0] : undefined;
  if (first === undefined || !ts.isIdentifier(first.name) || statement === undefined) {
    return { kind: "other" };
  }
  return {
    kind: "block",
    param: first.name.text,
    at: statement.getStart(sourceFile),
    voidReturn: !returnsValue(fn),
  };
}

export function rejectionHandlerOf(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): RejectionHandler | undefined {
  let current: ts.Node = call;
  let awaited = false;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (ts.isParenthesizedExpression(parent)) {
      current = parent;
    } else if (ts.isAwaitExpression(parent)) {
      awaited = true;
      current = parent;
    } else if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === current &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      const [first, second] = parent.parent.arguments;
      const handler =
        parent.name.text === "catch" ? first : parent.name.text === "then" ? second : undefined;
      if (handler !== undefined) return handlerOf(sourceFile, handler);
      current = parent.parent;
    } else break;
  }
  if (!awaited) return undefined;
  for (let node: ts.Node = current; !ts.isSourceFile(node); node = node.parent) {
    if (isFunctionNode(node)) return undefined;
    const parent: ts.Node = node.parent;
    if (ts.isTryStatement(parent) && parent.tryBlock === node && parent.catchClause !== undefined) {
      const clause = parent.catchClause;
      const name = clause.variableDeclaration?.name;
      const statement = clause.block.statements[0];
      const fn = enclosingFunction(parent);
      if (name === undefined || !ts.isIdentifier(name) || statement === undefined) {
        return { kind: "other" };
      }
      return {
        kind: "block",
        param: name.text,
        at: statement.getStart(sourceFile),
        voidReturn: fn !== undefined && !returnsValue(fn),
      };
    }
  }
  return undefined;
}

/** The line that ignores the abort the cleanup now causes, written for a catch parameter. */
export function ignoreAbortLine(param: string): string {
  return `if (${param} instanceof DOMException && ${param}.name === "AbortError") return;`;
}

/**
 * The quick fix for an effect: one controller for the effect, its signal passed to every loader
 * that is given none, and its `abort()` in the cleanup. Undefined when it cannot be written
 * (an effect written as an expression, a loader whose signal comes from elsewhere).
 */
export function abortFix(
  types: TypeQueries,
  sourceFile: ts.SourceFile,
  effect: Effect,
  cleanups: Cleanups,
  missing: readonly { readonly loader: Loader; readonly verdict: Verdict }[],
  title: string,
): Fix | undefined {
  const body = effect.callback.body;
  if (!ts.isBlock(body) || cleanups.unreadable) return undefined;
  // An abort on some paths is the developer's to move: no edit can tell which path meant it.
  if (
    missing.some(
      ({ verdict }) =>
        verdict.kind === "foreign" ||
        verdict.kind === "unreadable" ||
        verdict.kind === "conditional",
    )
  ) {
    return undefined;
  }
  const first = body.statements[0];
  if (first === undefined) return undefined;
  const existing =
    missing.flatMap(({ verdict }) => (verdict.kind === "abort" ? [verdict.controller] : []))[0] ??
    topController(effect);
  const name =
    existing !== undefined && ts.isIdentifier(existing.name)
      ? existing.name.text
      : freeName(effect);
  const edits: TextEdit[] = [];
  if (existing === undefined) {
    const start = first.getStart(sourceFile);
    edits.push(
      edit(
        sourceFile,
        start,
        start,
        `const ${name} = new AbortController();\n${indentAt(sourceFile, start)}`,
      ),
    );
  }
  for (const { loader, verdict } of missing) {
    if (verdict.kind !== "pass") continue;
    const pass = passEdit(sourceFile, loader.call, loader.at, name);
    if (pass === undefined) return undefined;
    edits.push(pass);
  }
  if (existing === undefined || abortsInCleanup(types, effect, cleanups, existing) === "none") {
    const abort = abortEdit(sourceFile, body, name);
    if (abort === undefined) return undefined;
    edits.push(abort);
  }
  // The abort now rejects the request, so a `catch` that shows an error would run on every change
  // and on unmount: it ignores the abort first (a form without this is kept when that does not compile).
  const catches: TextEdit[] = [];
  for (const { loader, verdict } of missing) {
    if (verdict.kind !== "pass" && verdict.kind !== "abort") continue;
    const handler = rejectionHandlerOf(sourceFile, loader.call);
    if (handler?.kind !== "block" || !handler.voidReturn) continue;
    catches.push(
      edit(
        sourceFile,
        handler.at,
        handler.at,
        `${ignoreAbortLine(handler.param)}\n${indentAt(sourceFile, handler.at)}`,
      ),
    );
  }
  return catches.length === 0
    ? { title, edits }
    : { title, edits: [...edits, ...catches], alternatives: [{ title, edits }] };
}
