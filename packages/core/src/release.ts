/**
 * The release trait: a value that must be released once it is no longer used (a subscription, a
 * listener, a connection). Core reads where the trait is stated, in the plainest form first, and
 * knows no library: a standard `Disposable` type, the project's `Release<T>` marker, a `facts`
 * line in the config, or the facts a plugin ships (`Plugin.facts`).
 */
import ts from "typescript";
import {
  calleeName,
  importedFrom,
  packageFactOf,
  packageFunctionOf,
  pathOf,
  rootName,
  type FactContext,
} from "./package-facts.js";
import type { ReleaseFact, TraitSource } from "./types.js";

/** The trait name the `Release<T>` marker states: `"__guarantee:release"?: true`. */
export const RELEASE = "release";

/**
 * How a value with the release trait is released: calling it (`unsubscribe()`), calling a method
 * on it (`subscription.unsubscribe()`), or disposing of it (`using`, `[Symbol.dispose]()`).
 */
export type ReleaseWay =
  | { readonly kind: "call" }
  | { readonly kind: "method"; readonly name: string }
  | { readonly kind: "dispose"; readonly async: boolean };

/** The release trait of a call's result, and where it is stated. */
export type ReleaseTrait = {
  readonly way: ReleaseWay;
  readonly source: TraitSource;
  /** The function called, as the note names it: `onSnapshot`, `Observable.subscribe`. */
  readonly callee: string;
};

/**
 * What a rule tells `releaseTraitOf`: `platformPackages`, packages whose `Disposable` types do not
 * state the trait (Node's types add `[Symbol.dispose]` to child processes, streams and timers,
 * which end by themselves).
 */
export type ReleaseOptions = { readonly platformPackages?: readonly string[] };

function unwrapped(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    node = node.expression;
  }
  return node;
}

function wayOf(fact: ReleaseFact): ReleaseWay {
  return fact === "release" ? { kind: "call" } : { kind: "method", name: fact.release };
}

/**
 * The release trait of what a call returns, from the plainest statement of it: the project's
 * `Release<T>` marker on the return type, the config's `facts` line for the package function, the
 * facts a plugin ships for it, then a standard `Disposable` or `AsyncDisposable` type. Undefined
 * when nothing states it. A `Disposable` declared in one of `options.platformPackages` is left
 * out, and so is a method that returns its own receiver (`stream.on(…)`).
 */
export function releaseTraitOf(
  call: ts.CallExpression | ts.NewExpression,
  ctx: FactContext,
  options: ReleaseOptions = {},
): ReleaseTrait | undefined {
  const { types } = ctx;
  const name = calleeName(call);
  const symbol = name === undefined ? undefined : types.symbolAt(name);
  const declared = symbol === undefined ? undefined : types.declarationOf(symbol);
  const path = declared === undefined ? [] : pathOf(declared.node);
  const calleeText = path.length > 0 ? path.join(".") : (name?.text ?? "the call");
  if (types.guaranteesOf(call).includes(RELEASE)) {
    const kind = types.disposeOf(call)?.kind;
    const way: ReleaseWay | undefined = types.isCallable(call)
      ? { kind: "call" }
      : kind === undefined
        ? undefined
        : { kind: "dispose", async: kind === "async" };
    if (way !== undefined) return { way, source: { kind: "marker" }, callee: calleeText };
  }
  // A name the project gives a package function (`const listen = onSnapshot`) is followed to it.
  const aliased =
    declared !== undefined && types.isOwnFile(declared.file) && ts.isIdentifier(call.expression)
      ? packageFunctionOf(call.expression, ctx)
      : undefined;
  const found =
    aliased !== undefined
      ? packageFactOf(aliased.declared, aliased.through, ctx)
      : declared === undefined
        ? undefined
        : packageFactOf(declared, call.expression, ctx);
  if (found?.fact.returns !== undefined) {
    return {
      way: wayOf(found.fact.returns),
      source: { kind: found.source, package: found.package },
      callee: calleeText,
    };
  }
  const disposed = types.disposeOf(call);
  if (disposed === undefined) return undefined;
  // Only a dispose method the project declares states the trait. TypeScript's own library and
  // packages add `[Symbol.dispose]` to values that never need a release (iterators, generators,
  // test mocks, Node's timers and streams): a package's value has the trait only through `facts`.
  if (!types.isOwnFile(disposed.file)) return undefined;
  const platform = types.packageOf(disposed.file);
  if (platform !== undefined && (options.platformPackages ?? []).includes(platform)) {
    return undefined;
  }
  // `stream.on(…)`, `hash.update(…)`: a method that returns its receiver starts nothing new.
  const callee = unwrapped(call.expression);
  if (
    ts.isPropertyAccessExpression(callee) &&
    types.typeTextOf(callee.expression) === types.typeTextOf(call)
  ) {
    return undefined;
  }
  const kind = disposed.kind;
  return {
    way: { kind: "dispose", async: kind === "async" },
    source: { kind: "type", name: kind === "async" ? "AsyncDisposable" : "Disposable" },
    callee: calleeText,
  };
}

/** A call `releaseCandidates` keeps or drops. */
export type ReleaseCandidate = (call: ts.CallExpression | ts.NewExpression) => boolean;

/**
 * A test, from the syntax alone, of whether `releaseTraitOf` can find the trait for a call of the
 * file, so a rule asks no type question about the others. When the program states `Release`
 * somewhere, or a project file declares a `[Symbol.dispose]` or `[Symbol.asyncDispose]` member,
 * every call is kept. Otherwise only a `facts` line with `returns` can state the trait, and a call
 * is kept when its callee's name (`onSnapshot`, `store.subscribe`) is the last part of such a
 * line's name or a name the project gives it with `as`, or when the call is made through a name
 * imported from a package such a line is listed under. Built once per file.
 */
export function releaseCandidates(ctx: FactContext): ReleaseCandidate {
  const { types } = ctx;
  if (types.declaresTrait(RELEASE) || types.declaresDispose()) return () => true;
  const names = new Set<string>();
  const packages = new Set<string>();
  for (const facts of [ctx.facts, ctx.shippedFacts]) {
    for (const [name, functions] of Object.entries(facts)) {
      for (const [key, fact] of Object.entries(functions)) {
        if (fact.returns === undefined) continue;
        packages.add(name);
        names.add(key.slice(key.lastIndexOf(".") + 1));
      }
    }
  }
  if (names.size === 0) return () => false;
  const renamed = types.renamedBindings();
  for (const name of names) {
    // A Set visits what is added while it is iterated: a chain of renames is followed to its end.
    for (const alias of renamed.get(name) ?? []) names.add(alias);
  }
  const imported = new Map<string, boolean>();
  const fromFactsPackage = (root: string): boolean => {
    let known = imported.get(root);
    if (known === undefined) {
      const specifier = importedFrom(ctx.sourceFile, root);
      known = specifier !== undefined && packages.has(specifier);
      imported.set(root, known);
    }
    return known;
  };
  return (call) => {
    const name = calleeName(call);
    if (name !== undefined && names.has(name.text)) return true;
    const root = rootName(call.expression);
    return root !== undefined && fromFactsPackage(root);
  };
}

/** Where a trait is stated, in words, for a note: "stateward's facts for rxjs". */
export function describeTraitSource(source: TraitSource): string {
  switch (source.kind) {
    case "type":
      return `its type, \`${source.name}\``;
    case "marker":
      return "the project's marker";
    case "config":
      return `the config's facts for ${source.package}`;
    case "shipped":
      return `stateward's facts for ${source.package}`;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

/**
 * The note on a finding about a value with the release trait: what the call returns and where
 * that is stated. "`onSnapshot` returns a release function (stateward's facts for
 * firebase/firestore)".
 */
export function describeRelease(trait: ReleaseTrait): string {
  const what =
    trait.way.kind === "call"
      ? "a release function"
      : trait.way.kind === "method"
        ? `a value released with \`${trait.way.name}()\``
        : trait.way.async
          ? "a value released with `await using` or `[Symbol.asyncDispose]()`"
          : "a value released with `using` or `[Symbol.dispose]()`";
  const stated =
    trait.source.kind === "marker"
      ? "its return type is stated `Release`"
      : describeTraitSource(trait.source);
  return `\`${trait.callee}\` returns ${what} (${stated})`;
}
