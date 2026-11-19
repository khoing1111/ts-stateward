import ts from "@stateward/core/typescript";
import {
  declarationId,
  defineRule,
  describeRelease,
  isSafePlatformCall,
  iteratesPlainly,
  matchesName,
  neverRejectsFactOf,
  option,
  releaseCandidates,
  releaseTraitOf,
  type FileContext,
  type Json,
  type OptionsOf,
  type ReleaseTrait,
  type ReleaseWay,
  type TraitSource,
} from "@stateward/core";
import { fitted, withFix } from "./text.js";

const EXPLAIN = `# ownership/resource-not-released

A value with the release trait (a subscription, a listener, a connection) that a function starts and never releases keeps running, and the leak shows far from its cause.

\`\`\`ts example-bad file=prices.ts
import type { Release } from "./guarantees.js";

export function watchPrices(onPrice: (price: number) => void): Release<() => void> {
  const id = setInterval(() => onPrice(Math.random()), 1000);
  return () => clearInterval(id);
}
\`\`\`

\`\`\`ts example-bad file=guarantees.ts
export type Release<T = unknown> = T & { readonly "__guarantee:release"?: true };
\`\`\`

\`\`\`ts example-bad file=ticker.ts
import { watchPrices } from "./prices.js";

export function showFirstPrice(show: (price: number) => void): void {
  const stop = watchPrices((price) => show(price));
}
\`\`\`

Release it when it is no longer needed, or return it so the caller does:

\`\`\`ts example-good file=ticker.ts
import { watchPrices } from "./prices.js";

export function showFirstPrice(show: (price: number) => void): () => void {
  const stop = watchPrices((price) => show(price));
  return stop;
}
\`\`\`

## Why it matters

A subscription that is never released keeps calling its listener, and a connection keeps its socket open. Each call of the function adds one more, and the symptom (memory that grows, a listener that fires twice) shows far from the line that started it.

## What it does not catch

It checks every value whose release trait is stated (see below), on every way out of the function that holds it: a \`return\`, a \`throw\` and a failed \`await\`. For a value stated with the marker, every piece of code between the start and the release is a way out unless it is one of these, which cannot throw or leave (names, literals, reads of members declared as properties (as far as the declared types say: a class that gives an interface's property as a getter is not seen), assignments to local names, comparisons and arithmetic of plain values, \`typeof\`, \`instanceof\`, \`if\`, \`switch\` and loops over arrays and over a \`Map\` or \`Set\`, and the platform's calls that cannot throw on the platform's own types, such as \`console.log\` or \`push\` on an array, \`String(x)\` on a primitive): a call of the project or a package (\`JSON.parse(text)\`), \`new\`, \`yield\`, a getter, an element read further (\`items[0].length\`) and a labelled \`break\` that skips the release are ways out, unless a \`try\` with a \`catch\` around them, after the start, catches what they throw and the release comes after that \`try\`. A release in a callback given to a call (\`done.then(() => stop())\`) is not checked, unless the call always runs it (\`setTimeout\`, \`queueMicrotask\`, the executor of \`new Promise\`). An \`await\` of a promise that a \`facts\` line states \`neverRejects: true\` is not a way out: RTK Query's \`cacheEntryRemoved\` only resolves, so the release after \`await cacheEntryRemoved\` in \`onCacheEntryAdded\` runs. Released means:

- calling it (a release function), calling the stated method, or \`using\`, \`await using\` or \`[Symbol.dispose]()\` (a \`Disposable\`); a call in \`finally\` covers every way out;
- calling it in a function written inside, such as a cleanup or a callback, on every path of that function;
- returning it, or passing it to a parameter typed \`Release\`: the caller now owns it, if that parameter is proven in its function (it releases, hands on or returns it on every way out; a parameter that does not is reported there, and the caller with it);
- storing it in a place the file releases (\`this.stop = …\` and \`this.stop()\` in another method). A place stated \`Owned\` says who changes it, not that anyone releases it: it is not read as a release.

A release only in a function that nothing calls (\`const later = () => stop()\`) is not read as a release: the place is not checked, and the guarantee reads "not checked". For a value stated with the marker kept in a module \`let\` or a field, the file releases it only by a release on every path of a function something can call: a release under an \`if\` is an error, and one only in a function nothing calls is not checked; a value pushed to a list is released by a loop that releases each item. A release on one branch only (an \`if\` in the function, or in a cleanup or callback written inside), only inside a loop (\`for\`, \`for…of\`, \`while\`), or only in a \`forEach\` or \`map\` callback (zero times for an empty list) is not on every way out: an error.

Every reference to a function stated \`Release\`, and to a parameter typed \`Release\`, is read or listed as "not checked" at its place (stateward lists each one as the editor's "find all references" does). A call the rule traces, an import and a type are read; the function given as a value (\`["a"].map(on)\`) or copied to another name, and a call whose result the rule cannot release (a promise of a \`Release\`, a value taken apart), are not checked. So are a value kept in an instance field (\`private stop = watchPrices(…)\`), returned from a callback (\`[1, 2].map(() => watchPrices(…))\`) or from a getter (reading it is not followed), or given to a rest parameter. A function of the project that returns the value with no return type of its own (a function, an object's method, a static method) passes the trait on: a caller that drops its result is an error against the function stated \`Release\`. The guarantee reads "unused" only when nothing refers to the function.

A place it cannot follow is an error that says why: the value passed to a function whose parameter is not typed \`Release\`, or stored in an array or an object. It does not report:

- a value started at the top of a module: it lives as long as the program;
- a value started in a React effect whose trait the code does not state with the \`Release\` marker: \`react/effect-missing-cleanup\` reads it there. A \`Release\` value started in an effect is proven here: the cleanup the effect returns releases it, or a ref it is stored in that the file releases;
- a value whose trait nobody states: a function with no marker, no \`facts\` line and no \`Disposable\` type.

## Getting the best from it

State the trait in the plainest way that fits:

- a class or type of the project with \`[Symbol.dispose]\` or \`[Symbol.asyncDispose]\` (\`Disposable\`, \`AsyncDisposable\`) has it with nothing more to write. A \`Disposable\` from TypeScript's own library or a package does not: they add these methods to values that never need a release (iterators, generators, test mocks, Node's timers and streams). A package's value has the trait through a \`facts\` line. A method that returns its own object (\`stream.on(…)\`) starts nothing new;
- the \`Release<T>\` marker on the return type of the project's own function, as \`watchPrices\` above;
- a \`facts\` line in the config for a package: \`facts: { "firebase/firestore": { onSnapshot: { returns: "release" } } }\` (call the returned function) or \`{ returns: { release: "unsubscribe" } }\` (call that method on it).

The ownership pack ships facts for Firebase \`onSnapshot\`, RxJS \`Observable.subscribe\` (\`unsubscribe\`), Redux \`Store.subscribe\`, zustand \`StoreApi.subscribe\`, and RTK Query's \`cacheEntryRemoved\` (\`neverRejects\`); a config line for the same function wins. Each finding's note says where its trait comes from, and \`stateward guarantees\` lists every source in use.

A value meant to live as long as the app (a store subscription started once at startup) is never released on purpose. At the top of a module it is not reported; started in a function, say so on the line above with the reason: \`// stateward-ignore ownership/resource-not-released: lives as long as the app\`. The comment hides the finding, but the guarantee reads "not proven: 1 ignored", never proven.

## Turn it on or off

\`\`\`ts
rules: { "ownership/resource-not-released": "off" } // or "warning"
rules: { "ownership/resource-not-released": ["error", { ignore: ["Observable.subscribe"] }] } // not checked for these functions
\`\`\`
`;

/**
 * Packages whose `Disposable` types do not state the trait: Node's types add `[Symbol.dispose]` to
 * child processes, streams and timers, which end by themselves.
 */
const PLATFORM: readonly string[] = ["@types/node"];

const OPTIONS = {
  ignore: option.strings({
    default: [],
    description:
      "Functions whose results are not checked, as the note names them (globs like `Observable.*`); only for the facts stateward ships. A function the code states (a `Release` marker, a `Disposable` type, a `facts` line) is always checked: no setting silences a stated guarantee.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

/** A place in a file, kept in a summary (JSON). */
type Place = { file: string; start: number; end: number };

/**
 * What the rule keeps of a file for `stateward guarantees`, hover and code lens: the functions it
 * declares with a `Release` return type, and its calls whose result has the release trait, each
 * with where the trait is stated (`declaration`: the marked function's place, for a marker).
 */
export type ReleaseSummary = {
  markers: (Place & { name: string })[];
  calls: (Place & {
    callee: string;
    source: TraitSource;
    declaration: Place | null;
    /** What the rule cannot follow in the call's value, after "not checked: "; null when it can. */
    unchecked: string | null;
  })[];
  /** The parameters typed `Release`, each with the function that must release it. */
  params?: (Place & {
    name: string;
    fn: Place & { name: string };
    unchecked: string | null;
  })[];
};

function placeOf(node: ts.Node): Place {
  const sourceFile = node.getSourceFile();
  return { file: sourceFile.fileName, start: node.getStart(sourceFile), end: node.end };
}

function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The outermost expression that is the call's value: through `(…)`, `await`, `!` and `as`. */
function valueOf(call: ts.Expression): ts.Expression {
  let node: ts.Expression = call;
  while (
    ts.isParenthesizedExpression(node.parent) ||
    ts.isAwaitExpression(node.parent) ||
    ts.isNonNullExpression(node.parent) ||
    ts.isAsExpression(node.parent) ||
    ts.isSatisfiesExpression(node.parent)
  ) {
    node = node.parent;
  }
  return node;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let at = node.parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionLike(at)) return at;
  }
  return undefined;
}

const EFFECT_HOOKS: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

/** A function passed to `useEffect`: `react/effect-missing-cleanup` checks what it starts. */
function isEffectCallback(fn: ts.SignatureDeclaration): boolean {
  const call = fn.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== fn) return false;
  const callee = unwrapped(call.expression);
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : "";
  return EFFECT_HOOKS.has(name);
}

/** The callee as a headline shows it: `onSnapshot(…)`, `store.subscribe(…)`. */
function shownCall(call: ts.CallExpression | ts.NewExpression, sourceFile: ts.SourceFile): string {
  const text = call.expression.getText(sourceFile).replace(/\s+/g, " ");
  return `${ts.isNewExpression(call) ? "new " : ""}${text}(…)`;
}

/** How a release is written in code: `stop()`, `subscription.unsubscribe()`, `using`. */
function releaseCode(trait: ReleaseTrait, name: string, optional = false): string {
  const q = optional ? "?." : ".";
  switch (trait.way.kind) {
    case "call":
      return optional ? `${name}?.()` : `${name}()`;
    case "method":
      return `${name}${q}${trait.way.name}()`;
    case "dispose":
      return trait.way.async
        ? `await ${name}${optional ? "?." : ""}[Symbol.asyncDispose]()`
        : `${name}${optional ? "?." : ""}[Symbol.dispose]()`;
  }
}

/** Whether a call releases `name` the way the trait says. */
function isReleaseCall(
  node: ts.Node,
  trait: ReleaseTrait,
  matches: (expression: ts.Expression) => boolean,
): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrapped(node.expression);
  switch (trait.way.kind) {
    case "call":
      return matches(callee);
    case "method":
      return (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === trait.way.name &&
        matches(callee.expression)
      );
    case "dispose":
      return (
        ts.isElementAccessExpression(callee) &&
        matches(callee.expression) &&
        /^Symbol\.(?:async)?[dD]ispose$/.test(callee.argumentExpression.getText())
      );
  }
}

/** What a function does with the value it holds. */
type Use =
  | { kind: "release"; node: ts.Node; nested: boolean }
  | { kind: "handed"; node: ts.Node }
  | {
      kind: "passed";
      node: ts.Node;
      to: string;
      /** The parameter is typed `Release`, but its function does not release it (`parameterProblem`). */
      unproven?: true;
    }
  | {
      kind: "stored";
      node: ts.Node;
      place: string;
      released: boolean;
      /** The place can hold `undefined` or `null`: releasing it needs `?.`. */
      optional: boolean;
      /** For a value stated `Release`: the file releases the place only on some paths. */
      partly?: true;
      /** For a value stated `Release`: the file releases it only where nothing runs (the reason). */
      never?: string;
    }
  | { kind: "kept"; node: ts.Node; where: string }
  /**
   * It goes where the rule does not follow it: `what` says where, after the value's name; `fix`
   * is what to write instead, when there is more to say than keeping it in a variable.
   */
  | { kind: "unfollowed"; node: ts.Node; what: string; fix?: string };

function isNestedIn(node: ts.Node, fn: ts.SignatureDeclaration): boolean {
  for (let at = node.parent; at !== fn; at = at.parent) {
    if (ts.isFunctionLike(at)) return true;
  }
  return false;
}

function isAsync(fn: ts.SignatureDeclaration): boolean {
  return (
    ts.canHaveModifiers(fn) &&
    ts.getModifiers(fn)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
  );
}

/** The text of a call's callee, for "passed to `register()`". */
function calleeText(call: ts.CallExpression | ts.NewExpression, sourceFile: ts.SourceFile): string {
  return `${call.expression.getText(sourceFile).replace(/\s+/g, "")}()`;
}

/** Whether the file releases the place a value is stored in: `this.stop()` for `this.stop = …`. */
function fileReleases(sourceFile: ts.SourceFile, place: string, trait: ReleaseTrait): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      isReleaseCall(
        node,
        trait,
        (expression) =>
          expression
            .getText(sourceFile)
            .replace(/\s+/g, "")
            .replace(/\?\.?$/, "") === place,
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isExported(node: ts.Node): boolean {
  const statement = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/**
 * Why a function of the file may never run, or undefined when something can call it: a method or
 * accessor of a class, an exported function, a function the file calls, passes on, returns or
 * stores, a callback given to a call, a function returned.
 */
function neverCalledBecause(fn: ts.SignatureDeclaration, ctx: FileContext): string | undefined {
  if (
    ts.isMethodDeclaration(fn) ||
    ts.isConstructorDeclaration(fn) ||
    ts.isGetAccessorDeclaration(fn) ||
    ts.isSetAccessorDeclaration(fn)
  ) {
    return undefined;
  }
  const named = (name: ts.Identifier, declaration: ts.Node): string | undefined =>
    isExported(declaration) || isUsedOnwardIn(name, ctx.sourceFile, ctx)
      ? undefined
      : `in \`${name.text}\`, which nothing calls`;
  if (ts.isFunctionDeclaration(fn)) {
    return fn.name === undefined ? undefined : named(fn.name, fn);
  }
  let at: ts.Node = fn;
  while (isWrapper(at.parent)) at = at.parent;
  const parent = at.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return named(parent.name, parent);
  }
  if (
    ts.isCallExpression(parent) ||
    ts.isNewExpression(parent) ||
    ts.isReturnStatement(parent) ||
    (ts.isArrowFunction(parent) && parent.body === at) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isJsxExpression(parent) ||
    ts.isExportAssignment(parent)
  ) {
    return undefined;
  }
  return "in a function stored where stateward does not follow it";
}

/**
 * Whether the file surely releases a place a value stated `Release` is stored in: a release of it
 * that is on every path of its function, in functions that something can call. `"some-paths"` when
 * the releases are all under a condition; a reason when the only releases are in a function
 * nothing calls.
 */
function storedRelease(
  /** A release of the place; for a release of each item, the `for…of` over the list. */
  matches: (node: ts.Node) => boolean | ts.ForOfStatement,
  ctx: FileContext,
): "released" | "some-paths" | "never" | { why: string } {
  // What each release found does: runs surely, runs on some paths, or runs where nothing calls.
  const outcomes: ("released" | "some-paths" | { why: string })[] = [];
  const visit = (node: ts.Node): void => {
    const match = matches(node);
    if (match !== false) {
      const fn = enclosingFunction(node);
      // Each item is released once per turn of the loop over the list: the loop is not a condition.
      const conditional =
        match === true
          ? fn !== undefined && isConditional(node, fn)
          : isConditional(node, match) || (fn !== undefined && isConditional(match, fn));
      const chain: ts.SignatureDeclaration[] = [];
      for (let at: ts.Node = node.parent; !ts.isSourceFile(at); at = at.parent) {
        if (ts.isFunctionLike(at)) chain.push(at);
      }
      const never = chain
        .map((closure) => neverCalledBecause(closure, ctx))
        .find((reason) => reason !== undefined);
      outcomes.push(conditional ? "some-paths" : never !== undefined ? { why: never } : "released");
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  if (outcomes.includes("released")) return "released";
  if (outcomes.includes("some-paths")) return "some-paths";
  const [first] = outcomes;
  return typeof first === "object" ? first : "never";
}

/** A place's text, as `fileReleases` compares it: no spaces, no trailing `?.`. */
function placeText(expression: ts.Node, sourceFile: ts.SourceFile): string {
  return expression
    .getText(sourceFile)
    .replace(/\s+/g, "")
    .replace(/\?\.?$/, "");
}

/** Matches a release of `place`: `this.stop()`, `stopAll?.()`. */
function releasesPlace(
  place: string,
  trait: ReleaseTrait,
  ctx: FileContext,
): (node: ts.Node) => boolean {
  return (node) =>
    isReleaseCall(node, trait, (expression) => placeText(expression, ctx.sourceFile) === place);
}

/** The list a call pushes the value onto: `this.stops` in `this.stops.push(value)`. */
function pushedTo(
  call: ts.CallExpression | ts.NewExpression,
  value: ts.Expression,
  sourceFile: ts.SourceFile,
): string | undefined {
  const callee = unwrapped(call.expression);
  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "push" ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== value
  ) {
    return undefined;
  }
  return placeText(callee.expression, sourceFile);
}

/**
 * Matches the release of each item of a list: `stop()` in `for (const stop of this.stops)` or in
 * `this.stops.forEach((stop) => stop())`.
 */
function releasesEach(
  list: string,
  trait: ReleaseTrait,
  sourceFile: ts.SourceFile,
): (node: ts.Node) => boolean | ts.ForOfStatement {
  return (node) => {
    if (!isReleaseCall(node, trait, () => true) || !ts.isCallExpression(node)) return false;
    const callee = unwrapped(node.expression);
    const held =
      trait.way.kind === "call"
        ? callee
        : ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? unwrapped(callee.expression)
          : callee;
    if (!ts.isIdentifier(held)) return false;
    for (let at: ts.Node = node.parent; !ts.isSourceFile(at); at = at.parent) {
      if (
        ts.isForOfStatement(at) &&
        ts.isVariableDeclarationList(at.initializer) &&
        at.initializer.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === held.text,
        )
      ) {
        return placeText(at.expression, sourceFile) === list && at;
      }
      if (
        (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
        at.parameters.some((param) => ts.isIdentifier(param.name) && param.name.text === held.text)
      ) {
        const call = at.parent;
        const each = ts.isCallExpression(call) ? unwrapped(call.expression) : undefined;
        return (
          each !== undefined &&
          ts.isPropertyAccessExpression(each) &&
          each.name.text === "forEach" &&
          placeText(each.expression, sourceFile) === list
        );
      }
    }
    return false;
  };
}

/** A value stored in `place`, with how the file releases it (`storedRelease`). */
function storedUse(
  node: ts.Node,
  place: string,
  optional: boolean,
  release: ReturnType<typeof storedRelease>,
): Use {
  const use: Use = { kind: "stored", node, place, released: release === "released", optional };
  if (release === "some-paths") return { ...use, partly: true };
  if (typeof release === "object") return { ...use, never: release.why };
  return use;
}

/** Whether the function around `node` returns `place` (its text, without spaces). */
function returnsPlace(node: ts.Node, place: string, sourceFile: ts.SourceFile): boolean {
  const fn = ts.findAncestor(node.parent, ts.isFunctionLike);
  if (fn === undefined) return false;
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    // A function inside returns to its own caller.
    if (child !== fn && ts.isFunctionLike(child)) return;
    if (
      ts.isReturnStatement(child) &&
      child.expression !== undefined &&
      unwrapped(child.expression).getText(sourceFile).replace(/\s+/g, "") === place
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/**
 * The call a function is given to, when the function whose value `at` returns (a `return`, or an
 * arrow's body) is a callback: what it returns goes to that call, which the rule does not follow.
 */
function callbackOf(at: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const fn = ts.isArrowFunction(at) ? at : ts.findAncestor(at.parent, ts.isFunctionLike);
  if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
    return undefined;
  }
  // What an effect returns is its cleanup: React calls it.
  if (isEffectCallback(fn)) return undefined;
  let held: ts.Node = fn;
  while (isWrapper(held.parent)) held = held.parent;
  const call = held.parent;
  if (!(ts.isCallExpression(call) || ts.isNewExpression(call)) || call.expression === held) {
    return undefined;
  }
  return calleeText(call, sourceFile);
}

/** The name of the rest parameter of the project's function that an argument goes to, if it does. */
function restParameterOf(
  call: ts.CallExpression | ts.NewExpression,
  argument: ts.Expression,
  ctx: FileContext,
): string | undefined {
  const index = call.arguments?.indexOf(argument) ?? -1;
  const callee = unwrapped(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  const fn = declared === undefined ? undefined : functionOfDeclaration(declared.node);
  if (fn === undefined || index < 0) return undefined;
  const param = fn.parameters[Math.min(index, fn.parameters.length - 1)];
  return param?.dotDotDotToken === undefined ? undefined : param.name.getText(fn.getSourceFile());
}

/** What happens to a value at `node`, an expression that holds it. */
function useAt(node: ts.Expression, trait: ReleaseTrait, ctx: FileContext): Use | undefined {
  const value = valueOf(node);
  const parent = value.parent;
  if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === value)) {
    const getter = ts.isReturnStatement(parent)
      ? ts.findAncestor(parent.parent, ts.isFunctionLike)
      : undefined;
    if (getter !== undefined && ts.isGetAccessorDeclaration(getter)) {
      return {
        kind: "unfollowed",
        node: value,
        what: `is returned from the getter \`${getter.name.getText(ctx.sourceFile)}\`, whose reads are not followed`,
        fix: `make \`${getter.name.getText(ctx.sourceFile)}\` a method, so its callers release what it returns`,
      };
    }
    const given = callbackOf(parent, ctx.sourceFile);
    // An async function or a generator gives the value inside a promise or an iterator, which the
    // rule does not follow at its callers: for a value stated `Release`, not checked.
    const holder = ts.findAncestor(parent, ts.isFunctionLike);
    if (
      given === undefined &&
      trait.source.kind === "marker" &&
      holder !== undefined &&
      (isAsync(holder) || ("asteriskToken" in holder && holder.asteriskToken !== undefined))
    ) {
      const what = isAsync(holder) ? "the async function" : "the generator";
      return {
        kind: "unfollowed",
        node: value,
        what: `is returned from ${what} \`${functionName(holder, ctx.sourceFile)}\`, whose callers are not followed`,
        fix: isAsync(holder)
          ? `release it inside \`${functionName(holder, ctx.sourceFile)}\`, or remove \`async\` so its callers get the release function`
          : `release it inside \`${functionName(holder, ctx.sourceFile)}\`, or return it from a function that is not a generator`,
      };
    }
    return given === undefined
      ? { kind: "handed", node: value }
      : {
          kind: "unfollowed",
          node: value,
          what: `is returned from a callback given to \`${given}\`, which is not followed`,
          fix: "start it outside the callback, keep it in a `const`, and release it in the same function, or return a function that releases it",
        };
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== value) {
    // `this.stops.push(watchPrices(…))`, released by `for (const stop of this.stops) stop()`.
    const list = pushedTo(parent, value, ctx.sourceFile);
    if (list !== undefined && trait.source.kind === "marker") {
      const each = storedRelease(releasesEach(list, trait, ctx.sourceFile), ctx);
      if (each !== "never") return storedUse(value, list, false, each);
    }
    if (ctx.types.contextualGuaranteesOf(value).includes("release")) {
      const rest = restParameterOf(parent, value, ctx);
      if (rest !== undefined) {
        return {
          kind: "unfollowed",
          node: value,
          what: `is given to the rest parameter \`${rest}\` of \`${calleeText(parent, ctx.sourceFile)}\`, which is not followed`,
          fix: "give it to a parameter typed `Release` that is not a rest parameter, so that function releases it",
        };
      }
      // The parameter states `Release`: the caller is done only if its function proves it.
      const unproven = parameterProblem(parent, value, ctx) !== undefined;
      return unproven
        ? { kind: "passed", node: value, to: calleeText(parent, ctx.sourceFile), unproven: true }
        : { kind: "handed", node: value };
    }
    return { kind: "passed", node: value, to: calleeText(parent, ctx.sourceFile) };
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === value
  ) {
    const place = parent.left.getText(ctx.sourceFile).replace(/\s+/g, "");
    // `this.sub = source.subscribe(…); return this.sub;`: the caller gets it, as with a `return`.
    if (returnsPlace(parent, place, ctx.sourceFile)) return { kind: "handed", node: value };
    const optional = ctx.types.canBeUndefined(parent.left) || ctx.types.canBeNull(parent.left);
    // For a value stated `Release`, the release must run: not under a condition, not only in a
    // function nothing calls.
    if (trait.source.kind === "marker") {
      return storedUse(
        value,
        place,
        optional,
        storedRelease(releasesPlace(place, trait, ctx), ctx),
      );
    }
    // A place stated `Owned` is not read as released: nothing says its module calls it.
    return {
      kind: "stored",
      node: value,
      place,
      released: fileReleases(ctx.sourceFile, place, trait),
      optional,
    };
  }
  if (
    ts.isArrayLiteralExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isShorthandPropertyAssignment(parent) ||
    ts.isSpreadElement(parent)
  ) {
    const where = ts.isArrayLiteralExpression(parent) ? "an array" : "an object";
    return { kind: "kept", node: value, where };
  }
  return undefined;
}

/** The uses of a variable that holds the value, in the function that declares it. */
function usesOf(
  name: ts.Identifier,
  fn: ts.SignatureDeclaration,
  trait: ReleaseTrait,
  ctx: FileContext,
  /** Collects the names that refer to the value at each use read (a release, a hand-over, …). */
  read?: Set<ts.Node>,
): Use[] {
  const symbol = ctx.types.symbolAt(name);
  if (symbol === undefined) return [];
  const same = (expression: ts.Expression): boolean => {
    const inner = unwrapped(expression);
    return (
      ts.isIdentifier(inner) &&
      inner.text === name.text &&
      ctx.types.symbolAt(inner)?.id === symbol.id
    );
  };
  const uses: Use[] = [];
  const visit = (node: ts.Node): void => {
    if (isReleaseCall(node, trait, same)) {
      uses.push({ kind: "release", node, nested: isNestedIn(node, fn) });
      if (read !== undefined && ts.isCallExpression(node)) {
        const mark = (inner: ts.Node): void => {
          if (ts.isIdentifier(inner) && same(inner)) read.add(inner);
          ts.forEachChild(inner, mark);
        };
        mark(node.expression);
      }
    } else if (ts.isIdentifier(node) && node !== name && same(node)) {
      const parent = node.parent;
      const callee =
        (ts.isCallExpression(parent) && parent.expression === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.expression === node);
      const use = callee ? undefined : useAt(node, trait, ctx);
      if (use !== undefined) {
        uses.push(use);
        read?.add(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined) visit(body);
  return uses;
}

/** An assignment that gives the variable `name` another value in `fn`: `stop = …`, `stop ??= …`. */
function writeOf(
  name: ts.Identifier,
  fn: ts.SignatureDeclaration,
  ctx: FileContext,
): ts.Node | undefined {
  const symbol = ctx.types.symbolAt(name);
  if (symbol === undefined) return undefined;
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      let left: ts.Expression = node.left;
      while (
        ts.isParenthesizedExpression(left) ||
        ts.isNonNullExpression(left) ||
        ts.isAsExpression(left) ||
        ts.isSatisfiesExpression(left)
      ) {
        left = left.expression;
      }
      if (
        ts.isIdentifier(left) &&
        left.text === name.text &&
        ctx.types.symbolAt(left)?.id === symbol.id
      ) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined) visit(body);
  return found;
}

/**
 * Whether `node` is in the body of a loop of `fn` that can run zero times: `for`, `for…of`,
 * `for…in` or `while` (a `do…while` body runs once at least).
 */
function inLoop(node: ts.Node, fn: ts.Node): boolean {
  for (let at: ts.Node = node; at.parent !== fn && !ts.isSourceFile(at.parent); at = at.parent) {
    const parent = at.parent;
    if (
      ((ts.isForOfStatement(parent) ||
        ts.isForInStatement(parent) ||
        ts.isWhileStatement(parent)) &&
        parent.statement === at) ||
      (ts.isForStatement(parent) && (parent.statement === at || parent.incrementor === at))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `node` runs on only some paths of `fn`: under an `if`, a `case`, a `catch`, `?:`, `&&`,
 * or in a loop that can run zero times.
 */
function isConditional(node: ts.Node, fn: ts.Node): boolean {
  if (inLoop(node, fn)) return true;
  for (let at: ts.Node = node; at.parent !== fn && !ts.isSourceFile(at.parent); at = at.parent) {
    const parent = at.parent;
    if (ts.isTryStatement(parent) && parent.finallyBlock === at) return false;
    if (
      ts.isIfStatement(parent) ||
      ts.isCaseClause(parent) ||
      ts.isDefaultClause(parent) ||
      ts.isCatchClause(parent) ||
      ts.isConditionalExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        parent.right === at &&
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(parent.operatorToken.kind))
    ) {
      return true;
    }
  }
  return false;
}

function inFinally(node: ts.Node, fn: ts.SignatureDeclaration): boolean {
  for (let at: ts.Node = node; at !== fn && !ts.isSourceFile(at); at = at.parent) {
    if (ts.isTryStatement(at.parent) && at.parent.finallyBlock === at) return true;
  }
  return false;
}

/**
 * A way out of `fn` between `from` and `to` that skips a release at `to`: a `return`, a `throw` or
 * an `await` that can fail, not in a nested function. An `await` of a promise the facts say never
 * rejects (RTK Query's `cacheEntryRemoved`) is not one.
 */
function exitBetween(
  fn: ts.SignatureDeclaration,
  from: number,
  to: number,
  ctx: FileContext,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || (node !== fn && ts.isFunctionLike(node))) return;
    if (
      node.getStart() >= from &&
      node.getStart() < to &&
      (ts.isReturnStatement(node) ||
        ts.isThrowStatement(node) ||
        (ts.isAwaitExpression(node) && neverRejectsFactOf(node.expression, ctx) === undefined))
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined) visit(body);
  return found;
}

/** The operators that combine values the closed list already reads, and never throw themselves. */
const SAFE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.CommaToken,
]);

/** The operators that never throw on two plain values (a string, a number, a boolean, …). */
const PLAIN_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
]);

/** The operators that never throw on two numbers, though they do on a `bigint` (`1n / 0n`). */
const NUMBER_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
]);

/** Nodes that only hold others, or name a value: the closed list reads what is inside them. */
const HOLDERS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.Block,
  ts.SyntaxKind.EmptyStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseBlock,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.LabeledStatement,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.TypeAssertionExpression,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.TypeOfExpression,
  ts.SyntaxKind.VoidExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.ShorthandPropertyAssignment,
  ts.SyntaxKind.ObjectBindingPattern,
  ts.SyntaxKind.ArrayBindingPattern,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
]);

/** Whether a `break` or `continue` lands outside `from`…`to`: on a statement that is not all inside. */
function jumpsOut(node: ts.BreakOrContinueStatement, from: number, to: number): boolean {
  const label = node.label?.text;
  let target: ts.Node | undefined;
  for (let at = node.parent; !ts.isFunctionLike(at) && !ts.isSourceFile(at); at = at.parent) {
    if (label !== undefined) {
      if (ts.isLabeledStatement(at) && at.label.text === label) target = at;
    } else if (
      ts.isIterationStatement(at, false) ||
      (ts.isBreakStatement(node) && ts.isSwitchStatement(at))
    ) {
      target = at;
    }
    if (target !== undefined) break;
  }
  return target === undefined || target.getStart() < from || target.end > to;
}

/**
 * Whether a node is in the `try` block of a `try` with a `catch` that starts after `from` and ends
 * before `to`: a throw there is caught, and the release at `to` after the `try` still runs. A
 * release inside that `try` block is skipped by the throw, so the throw is a way out for it.
 */
function caughtAfter(node: ts.Node, from: number, to: number): boolean {
  for (
    let at: ts.Node = node;
    !ts.isFunctionLike(at.parent) && !ts.isSourceFile(at.parent);
    at = at.parent
  ) {
    const parent = at.parent;
    if (
      ts.isTryStatement(parent) &&
      parent.tryBlock === at &&
      parent.catchClause !== undefined &&
      parent.getStart() >= from &&
      parent.end <= to
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a call or `new` cannot throw: it is on the platform's closed list, is not the project's
 * own function, and is given no function (a callback runs inside it).
 */
function callCannotThrow(call: ts.CallExpression | ts.NewExpression, ctx: FileContext): boolean {
  if (!isSafePlatformCall(call, ctx.types)) return false;
  const callee = unwrapped(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared !== undefined && ctx.types.isOwnFile(declared.file)) return false;
  // A function written in place is read as running inside the call (`xs.forEach((x) => …)`); any
  // other function given to it is not followed.
  return (call.arguments ?? []).every((argument) => {
    const inner = unwrapped(argument);
    if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return bodyStays(inner, ctx);
    return !ctx.types.isCallable(argument);
  });
}

/** The declaration or parameter a binding element is part of. */
function bindingRoot(node: ts.BindingElement): ts.Node {
  let at: ts.Node = node;
  while (ts.isBindingElement(at) || ts.isObjectBindingPattern(at) || ts.isArrayBindingPattern(at)) {
    at = at.parent;
  }
  return at;
}

/** Whether a function written in place runs only code on the closed list (its own `return` is its own). */
function bodyStays(fn: ts.ArrowFunction | ts.FunctionExpression, ctx: FileContext): boolean {
  if (fn.asteriskToken !== undefined || isAsync(fn)) return false;
  return statedWayOutBetween(fn, fn.body.getStart(), fn.body.end, ctx, true) === undefined;
}

/**
 * What a node does on its own (not what is inside it) when it is on the closed list of code that
 * cannot throw or leave the function: `"stays"`; `"throws"` for code that can throw (a `try` with
 * a `catch` around it catches that); `"leaves"` for code that leaves whatever is around it.
 */
function ownEffect(
  node: ts.Node,
  from: number,
  to: number,
  ctx: FileContext,
): "stays" | "throws" | "leaves" {
  // A token (`?`, `:`, `===`, a keyword) is part of the node around it.
  if (node.kind <= ts.SyntaxKind.LastToken || HOLDERS.has(node.kind) || ts.isTypeNode(node)) {
    return "stays";
  }
  // `for`, `while`, `do` and `for…in` only repeat what is in them; `for…of` runs an iterator,
  // which cannot throw for an array, a string, or an iterator of a `Map` or `Set`.
  if (
    ts.isForStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isForInStatement(node)
  ) {
    return "stays";
  }
  if (ts.isForOfStatement(node)) {
    return node.awaitModifier === undefined && iteratesPlainly(node.expression, ctx.types)
      ? "stays"
      : "throws";
  }
  // `[...xs]`: spreading an array of primitives runs no code of the project.
  if (ts.isSpreadElement(node)) {
    return ctx.types.arrayElementsOf(node.expression) === "primitives" ? "stays" : "throws";
  }
  if (ts.isReturnStatement(node) || ts.isYieldExpression(node)) return "leaves";
  if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
    return jumpsOut(node, from, to) ? "leaves" : "stays";
  }
  if (ts.isAwaitExpression(node)) {
    return neverRejectsFactOf(node.expression, ctx) === undefined ? "throws" : "stays";
  }
  // A destructured name is read by its binding element.
  if (ts.isVariableDeclaration(node)) return "stays";
  if (ts.isBindingElement(node)) {
    return ts.isVariableDeclaration(bindingRoot(node)) && ctx.types.readIsPlain(node)
      ? "stays"
      : "throws";
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    // What a call is made on: the call decides (`list.push(…)`).
    if (ts.isCallExpression(node.parent) && node.parent.expression === node) return "stays";
    return ctx.types.readIsPlain(node) ? "stays" : "throws";
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return callCannotThrow(node, ctx) ? "stays" : "throws";
  }
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.every((span) => ctx.types.isPrimitive(span.expression))
      ? "stays"
      : "throws";
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const operand = unwrapped(node.operand);
    const plain = ctx.types.isPrimitive(operand);
    if (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      return plain && ts.isIdentifier(operand) ? "stays" : "throws";
    }
    return node.operator === ts.SyntaxKind.ExclamationToken || plain ? "stays" : "throws";
  }
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (SAFE_OPERATORS.has(kind)) return "stays";
    if (kind === ts.SyntaxKind.InstanceOfKeyword) {
      return ctx.types.isPlainClass(node.right) ? "stays" : "throws";
    }
    if (NUMBER_OPERATORS.has(kind)) {
      const numbers = ctx.types.isNumber(node.left) && ctx.types.isNumber(node.right);
      const assigns = kind >= ts.SyntaxKind.FirstCompoundAssignment;
      return numbers && (!assigns || ts.isIdentifier(unwrapped(node.left))) ? "stays" : "throws";
    }
    if (kind === ts.SyntaxKind.EqualsToken) {
      return ts.isIdentifier(unwrapped(node.left)) ? "stays" : "throws";
    }
    const plain = ctx.types.isPrimitive(node.left) && ctx.types.isPrimitive(node.right);
    if (!plain || !PLAIN_OPERATORS.has(kind)) return "throws";
    const assigns =
      kind >= ts.SyntaxKind.FirstCompoundAssignment && kind <= ts.SyntaxKind.LastCompoundAssignment;
    return !assigns || ts.isIdentifier(unwrapped(node.left)) ? "stays" : "throws";
  }
  return "throws";
}

/**
 * For a value stated `Release`: the first place between `from` and `to` that can throw or leave
 * `fn`, so the release at `to` may not run. Every node there is one, unless it is on a closed list
 * of code that cannot throw or leave (`ownEffect`): names, literals, plain reads (`readIsPlain`),
 * assignments to local names, comparisons and arithmetic of plain values, `typeof`, `instanceof`,
 * `!`, objects and arrays of such values, and the platform's calls that cannot throw on the
 * platform's own types. A function written there does not run there. Code that can throw inside a
 * `try` with a `catch`, both after `from` and ending before `to`, is caught; a `return`, a `yield`
 * and a `break` or `continue` out of the span are not.
 */
function statedWayOutBetween(
  fn: ts.SignatureDeclaration,
  from: number,
  to: number,
  ctx: FileContext,
  /** A callback read in place: its own `return` ends the callback, not `fn`. */
  callback = false,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || (node !== fn && ts.isFunctionLike(node))) return;
    if (node.end <= from || node.getStart() >= to) return;
    if (node.getStart() >= from && node.end <= to) {
      const effect =
        callback && ts.isReturnStatement(node) ? "stays" : ownEffect(node, from, to, ctx);
      if (effect === "leaves" || (effect === "throws" && !caughtAfter(node, from, to))) {
        found = node;
        return;
      }
    }
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, visit);
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined) visit(body);
  return found;
}

/** A way out between `from` and `to`: the closed list for a value stated `Release`, the known exits for the others. */
function wayOutBetween(
  fn: ts.SignatureDeclaration,
  from: number,
  to: number,
  trait: ReleaseTrait,
  ctx: FileContext,
): ts.Node | undefined {
  return trait.source.kind === "marker"
    ? statedWayOutBetween(fn, from, to, ctx)
    : exitBetween(fn, from, to, ctx);
}

/**
 * What a function does wrong with the value, or (`unchecked`) what the rule cannot follow:
 * `message` then reads after "not checked: " and `hint` says what would let it be read.
 */
type Problem = { node: ts.Node; message: string; hint: string; unchecked?: true };

/** The last way out of a "never released" finding: a value meant to live as long as the app. */
const LIVES_WITH_APP =
  "- or, if it lives as long as the app, say so on the line above; the guarantee then reads not proven, ignored:\n    // stateward-ignore ownership/resource-not-released: lives as long as the app";

function neverHint(trait: ReleaseTrait, name: string, call: string): string {
  if (trait.way.kind === "dispose") {
    return [
      "one of",
      `- declare it with \`${trait.way.async ? "await using" : "using"}\`, so it is released on every way out:`,
      `    ${trait.way.async ? "await using" : "using"} ${name} = ${call};`,
      "- or return it, so the caller releases it",
      LIVES_WITH_APP,
    ].join("\n");
  }
  return [
    "one of",
    `- call \`${releaseCode(trait, name)}\` when it is no longer needed`,
    "- or return it, so the caller releases it",
    LIVES_WITH_APP,
  ].join("\n");
}

/** What a function does wrong with the value a call gives it, or undefined when it releases it. */
function problemOf(
  call: ts.CallExpression | ts.NewExpression,
  fn: ts.SignatureDeclaration,
  trait: ReleaseTrait,
  ctx: FileContext,
): Problem | undefined {
  // `on ? watch(…) : undefined`: the value goes where the whole `?:` goes.
  let value = valueOf(call);
  while (ts.isConditionalExpression(value.parent) && value.parent.condition !== value) {
    value = valueOf(value.parent);
  }
  const parent = value.parent;
  const shown = shownCall(call, ctx.sourceFile);
  if (
    ts.isExpressionStatement(parent) ||
    ts.isVoidExpression(parent) ||
    // `(watchPrices(…), 1)`: the value of the left side is dropped.
    (ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.CommaToken &&
      parent.left === value)
  ) {
    const name = trait.way.kind === "call" ? "release" : "subscription";
    return {
      node: call,
      message: fitted((cut) => `the result of \`${cut.name(shown)}\` is never released`),
      hint: neverHint(trait, name, shown).replace(
        "- call",
        `- keep it (\`const ${name} = ${shown}\`) and call`,
      ),
    };
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === value) {
    if (!ts.isIdentifier(parent.name)) {
      return {
        node: call,
        message: fitted(
          (cut) => `the result of \`${cut.name(shown)}\` is taken apart and never released`,
        ),
        hint: `keep it whole (\`const value = ${shown}\`) and release it`,
      };
    }
    const list = parent.parent;
    if (ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Using) !== 0) {
      return undefined;
    }
    return variableProblem(
      parent.name,
      { shown: shownCall(call, ctx.sourceFile), after: call.end },
      fn,
      trait,
      ctx,
    );
  }
  const use = useAt(value, trait, ctx);
  return use === undefined ? undefined : useProblem(use, shown, "it", trait);
}

function useProblem(
  use: Use,
  shown: string,
  name: string,
  trait: ReleaseTrait,
): Problem | undefined {
  const subject =
    name === "it"
      ? `the result of \`${shown}\``
      : shown === ""
        ? `\`${name}\``
        : `\`${name}\` from \`${shown}\``;
  switch (use.kind) {
    case "release":
    case "handed":
      return undefined;
    case "passed":
      if (use.unproven === true) {
        return {
          node: use.node,
          message: fitted(
            (cut) =>
              `${cut.name(subject)} is passed to \`${cut.name(use.to)}\`, whose \`Release\` parameter is not released there`,
          ),
          hint: `release the parameter in \`${use.to.slice(0, -2)}\`, pass it to a function that releases it, or return it; or release it here: \`${releaseCode(trait, name === "it" ? "value" : name)}\``,
        };
      }
      return {
        node: use.node,
        message: fitted(
          (cut) =>
            `${cut.name(subject)} is passed to \`${cut.name(use.to)}\`, whose parameter is not typed \`Release\``,
        ),
        hint: [
          "one of",
          `- type the parameter of \`${use.to.slice(0, -2)}\` \`Release\`, so its function releases it`,
          `- or release it here: \`${releaseCode(trait, name === "it" ? "value" : name)}\``,
        ].join("\n"),
      };
    case "stored":
      if (use.released) return undefined;
      if (use.partly === true) {
        return {
          node: use.node,
          message: fitted(
            (cut) =>
              `${cut.name(subject)} is stored in \`${cut.name(use.place)}\`, which the file releases only on some paths`,
          ),
          hint: `release it where it is stored, on every path: \`${releaseCode(trait, use.place, use.optional)}\``,
        };
      }
      if (use.never !== undefined) {
        const never = use.never;
        return {
          node: use.node,
          unchecked: true,
          message: fitted(
            (cut) =>
              `${cut.name(subject)} is stored in \`${cut.name(use.place)}\`, released only ${cut.name(never)}`,
          ),
          hint: "call the function that releases it, or release it where it is stored",
        };
      }
      return {
        node: use.node,
        message: fitted(
          (cut) =>
            `${cut.name(subject)} is stored in \`${cut.name(use.place)}\`, which the file never releases`,
        ),
        hint: `release it where it is stored: \`${releaseCode(trait, use.place, use.optional)}\``,
      };
    case "unfollowed":
      return {
        node: use.node,
        unchecked: true,
        message: fitted((cut) => `${cut.name(subject)} ${use.what}`),
        hint:
          use.fix ??
          `keep it in a variable and release it: \`${releaseCode(trait, name === "it" ? "value" : name)}\`, or return it`,
      };
    case "kept":
      return {
        node: use.node,
        message: fitted(
          (cut) =>
            `${cut.name(subject)} is stored in ${use.where}, where its release cannot be followed`,
        ),
        hint: `keep it in a variable and release it: \`${releaseCode(trait, name === "it" ? "value" : name)}\``,
      };
  }
}

/** Where a value comes from, for the words about it: a call (`shown`, and where it ends), or a parameter (`shown` is empty). */
type Origin = { shown: string; after: number };

/** `stop` from `watchPrices(…)`, or `stop` alone for a parameter. */
function subjectOf(name: string, origin: Origin): string {
  return origin.shown === "" ? `\`${name}\`` : `\`${name}\` from \`${origin.shown}\``;
}

function isWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

/** The functions written inside `fn` that hold `node`, the innermost first. */
function closuresBetween(node: ts.Node, fn: ts.SignatureDeclaration): ts.SignatureDeclaration[] {
  const found: ts.SignatureDeclaration[] = [];
  for (let at = node.parent; at !== fn && !ts.isSourceFile(at); at = at.parent) {
    if (ts.isFunctionLike(at)) found.push(at);
  }
  return found;
}

/** The array methods that call their callback once per item: zero times on an empty array. */
const PER_ITEM: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "reduce",
  "reduceRight",
]);

/** `forEach` when `closure` is the callback of `xs.forEach(…)` (or another per-item method). */
function iterationOf(closure: ts.SignatureDeclaration): string | undefined {
  let at: ts.Node = closure;
  while (isWrapper(at.parent)) at = at.parent;
  const call = at.parent;
  if (!ts.isCallExpression(call) || call.expression === at) return undefined;
  const callee = unwrapped(call.expression);
  return ts.isPropertyAccessExpression(callee) && PER_ITEM.has(callee.name.text)
    ? callee.name.text
    : undefined;
}

/** Whether something is done with a function held by a name: it is called, passed on, returned or stored. */
function isUsedOnward(name: ts.Identifier, fn: ts.SignatureDeclaration, ctx: FileContext): boolean {
  const body = "body" in fn ? fn.body : undefined;
  return body !== undefined && isUsedOnwardIn(name, body, ctx);
}

/** The same, anywhere under `root`; an `export { name }` counts as used. */
function isUsedOnwardIn(name: ts.Identifier, root: ts.Node, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(name);
  if (symbol === undefined) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isIdentifier(node) &&
      node !== name &&
      node.text === name.text &&
      ctx.types.symbolAt(node)?.id === symbol.id
    ) {
      let at: ts.Node = node;
      while (isWrapper(at.parent)) at = at.parent;
      const parent = at.parent;
      found =
        ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          (parent.expression === at ||
            parent.arguments?.some((argument) => argument === at) === true)) ||
        ts.isReturnStatement(parent) ||
        (ts.isArrowFunction(parent) && parent.body === at) ||
        ts.isPropertyAssignment(parent) ||
        ts.isShorthandPropertyAssignment(parent) ||
        ts.isArrayLiteralExpression(parent) ||
        ts.isSpreadElement(parent) ||
        ts.isJsxExpression(parent) ||
        ts.isExportSpecifier(parent) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          parent.right === at);
      if (found) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * The calls that always run the function given to them: the executor of `new Promise(…)` (at
 * once), `queueMicrotask` and `setTimeout` (later, unless the code clears the timer).
 */
function runsCallback(call: ts.CallExpression | ts.NewExpression): boolean {
  const callee = unwrapped(call.expression);
  if (!ts.isIdentifier(callee)) return false;
  return ts.isNewExpression(call)
    ? callee.text === "Promise"
    : callee.text === "queueMicrotask" || callee.text === "setTimeout";
}

/**
 * Why a function written inside, that releases the value, may never run: the reason, after
 * "released only "; undefined when it is given to a call (a callback, an immediately invoked
 * function), returned, or held by a name that is used onward.
 */
function neverRunsBecause(
  closure: ts.SignatureDeclaration,
  fn: ts.SignatureDeclaration,
  ctx: FileContext,
  stated = false,
): string | undefined {
  if (ts.isFunctionDeclaration(closure) && closure.name !== undefined) {
    return isUsedOnward(closure.name, fn, ctx)
      ? undefined
      : `in \`${closure.name.text}\`, which nothing calls`;
  }
  let at: ts.Node = closure;
  while (isWrapper(at.parent)) at = at.parent;
  const parent = at.parent;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    // For a value stated `Release`, a callback runs when the call it is given to decides
    // (`p.then(() => stop())` runs only if `p` resolves), which is not followed. A function
    // called in place, and the executor of `new Promise`, run now.
    if (!stated || parent.expression === at || runsCallback(parent)) return undefined;
    return `in a callback given to \`${calleeText(parent, ctx.sourceFile)}\`, which is not followed`;
  }
  if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === at)) {
    return undefined;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return isUsedOnward(parent.name, fn, ctx)
      ? undefined
      : `in \`${parent.name.text}\`, which nothing calls`;
  }
  return ts.isPropertyAssignment(parent)
    ? "in a function stored in an object, which is not followed"
    : "in a function stored where stateward does not follow it";
}

/**
 * Guards a parameter that is being checked: a `Release` parameter handed to another `Release`
 * parameter that hands it back would ask for itself, and is read as proven while it is open.
 */
const parametersOpen = new Set<ts.Node>();

function variableProblem(
  name: ts.Identifier,
  origin: Origin,
  fn: ts.SignatureDeclaration,
  trait: ReleaseTrait,
  ctx: FileContext,
): Problem | undefined {
  const { shown } = origin;
  const uses = usesOf(name, fn, trait, ctx);
  // A place it cannot follow, or a store nothing releases, is the finding: the trait was stated.
  for (const use of uses) {
    if (
      use.kind === "passed" ||
      use.kind === "kept" ||
      use.kind === "unfollowed" ||
      (use.kind === "stored" && !use.released)
    ) {
      return useProblem(use, shown, name.text, trait);
    }
  }
  if (uses.some((use) => use.kind === "handed" || use.kind === "stored")) return undefined;
  const subject = subjectOf(name.text, origin);
  // `let stop = watch(…); stop = other; stop()`: the name is given another value, so a call of it
  // may release something else.
  const rewritten = writeOf(name, fn, ctx);
  if (rewritten !== undefined) {
    return {
      node: rewritten,
      message: fitted(
        (cut) => `${cut.name(subject)} is lost: \`${cut.name(name.text)}\` is given another value`,
      ),
      hint: `keep the value in a \`const\` and release that, or release it before \`${name.text}\` is given another value`,
    };
  }
  const releases = uses.filter((use) => use.kind === "release");
  if (releases.length === 0) {
    return {
      node: name,
      message: fitted((cut) => `${cut.name(subject)} is never released`),
      hint:
        shown === ""
          ? `release \`${name.text}\`, pass it to a function that releases it, or return it`
          : neverHint(trait, name.text, shown),
    };
  }
  const direct = releases.filter((use) => !use.nested);
  // A release under an `if` runs on some paths only, in `finally` too (`finally { if (c) stop(); }`).
  const sure = direct.find(
    (use) =>
      !isConditional(use.node, fn) &&
      (inFinally(use.node, fn) ||
        wayOutBetween(fn, origin.after, use.node.getStart(), trait, ctx) === undefined),
  );
  if (sure !== undefined) return undefined;
  // In a function written inside (a cleanup, a callback), it is released when that one runs, if it does.
  const doubts: string[] = [];
  // A release that a path skips for sure: on one branch of the function that releases it, or in a
  // callback of `forEach` or `map`, which runs once per item, so zero times on an empty array.
  let partly: string | undefined;
  for (const use of releases.filter((one) => one.nested)) {
    const closures = closuresBetween(use.node, fn);
    const [inner] = closures;
    if (inner === undefined) continue;
    const each = closures.map(iterationOf).find((method) => method !== undefined);
    if (each !== undefined) {
      partly ??= `in a \`${each}\` callback, which runs zero times for an empty list`;
      continue;
    }
    if (isConditional(use.node, inner)) {
      partly ??= "on some paths of the function that releases it";
      continue;
    }
    const never = closures
      .map((closure) => neverRunsBecause(closure, fn, ctx, trait.source.kind === "marker"))
      .find((why) => why !== undefined);
    if (never === undefined) return undefined;
    doubts.push(never);
  }
  const [doubt] = doubts;
  if (partly !== undefined) {
    return {
      node: name,
      message: fitted((cut) => `${cut.name(subject)} is released only ${cut.name(partly)}`),
      hint: "release it in `finally`, or on every path of the function that starts it",
    };
  }
  if (direct.some((use) => inLoop(use.node, fn))) {
    return {
      node: name,
      message: fitted(
        (cut) => `${cut.name(subject)} is released only in a loop, which can run zero times`,
      ),
      hint: `release it after the loop, or in \`finally\`: \`try { … } finally { ${releaseCode(trait, name.text)}; }\``,
    };
  }
  if (direct.length === 0 && doubt !== undefined) {
    return {
      node: name,
      unchecked: true,
      message: fitted((cut) => `${cut.name(subject)} is released only ${cut.name(doubt)}`),
      hint: doubt.endsWith("which nothing calls")
        ? `call the function that releases it, or release it in \`finally\` in the function that starts it: \`try { … } finally { ${releaseCode(trait, name.text)}; }\``
        : doubt.startsWith("in a callback given to")
          ? `\`await\` what the callback waits for, and release it in \`finally\`: \`try { … } finally { ${releaseCode(trait, name.text)}; }\``
          : `release it in \`finally\` in the function that starts it: \`try { … } finally { ${releaseCode(trait, name.text)}; }\``,
    };
  }
  return {
    node: name,
    message: fitted((cut) => `${cut.name(subject)} is not released on every way out`),
    hint: [
      "one of",
      `- release it in \`finally\`: \`try { … } finally { ${releaseCode(trait, name.text)}; }\``,
      "- or return it, so the caller releases it",
    ].join("\n"),
  };
}

/** The function a declaration is: a function, a method, or a variable that holds an arrow or function expression. */
function functionOfDeclaration(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node;
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return node.initializer;
  }
  return undefined;
}

/** The release trait a `Release` parameter states: its value is a function to call, or a disposable. */
function parameterTrait(
  param: ts.ParameterDeclaration,
  ctx: FileContext,
): ReleaseTrait | undefined {
  if (!ts.isIdentifier(param.name) || !ctx.types.guaranteesOf(param.name).includes("release")) {
    return undefined;
  }
  const kind = ctx.types.disposeOf(param.name)?.kind;
  const way: ReleaseWay | undefined = ctx.types.isCallable(param.name)
    ? { kind: "call" }
    : kind === undefined
      ? undefined
      : { kind: "dispose", async: kind === "async" };
  return way === undefined
    ? undefined
    : { way, source: { kind: "marker" }, callee: param.name.text };
}

/**
 * What the function does wrong with a parameter typed `Release`: it must release it, hand it on or
 * return it on every way out, like a value it started (a parameter is proven in its own function).
 * Undefined when it does, or when the function has no body to read. A context for the file the
 * function is in.
 */
function checkParameter(
  param: ts.ParameterDeclaration,
  fn: ts.SignatureDeclaration,
  ctx: FileContext,
): Problem | undefined {
  const body = "body" in fn ? fn.body : undefined;
  if (body === undefined || !ts.isIdentifier(param.name) || parametersOpen.has(param)) {
    return undefined;
  }
  const trait = parameterTrait(param, ctx);
  if (trait === undefined) return undefined;
  parametersOpen.add(param);
  try {
    return variableProblem(param.name, { shown: "", after: body.getStart() }, fn, trait, ctx);
  } finally {
    parametersOpen.delete(param);
  }
}

/** The `Release` parameter a call's argument goes to, checked in the function that declares it. */
function parameterProblem(
  call: ts.CallExpression | ts.NewExpression,
  argument: ts.Expression,
  ctx: FileContext,
): Problem | undefined {
  const index = call.arguments?.indexOf(argument) ?? -1;
  const callee = unwrapped(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || index < 0 || !ctx.types.isOwnFile(declared.file)) return undefined;
  const fn = functionOfDeclaration(declared.node);
  const param = fn?.parameters[index];
  if (fn === undefined || param === undefined) return undefined;
  const own: FileContext = {
    ...ctx,
    sourceFile: fn.getSourceFile(),
    file: fn.getSourceFile().fileName,
  };
  return checkParameter(param, fn, own);
}

/** The function a call resolves to, when the project declares it with a `Release` return type. */
function markedDeclaration(
  call: ts.CallExpression | ts.NewExpression,
  ctx: FileContext,
): ts.Node | undefined {
  const callee = unwrapped(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declared !== undefined && ctx.types.isOwnFile(declared.file) ? declared.node : undefined;
}

/**
 * The declaration a call's callee is, when it is one of the project's functions stated `Release`
 * and the callee reaches it by another name: an alias (`const w = watchPrices`), a destructured
 * import (`const { watchPrices } = await import(…)`). The type of the callee says it
 * (`valueOriginOf`); undefined when the callee has no such origin, or it states no `Release`.
 */
function originalMarker(
  call: ts.CallExpression | ts.NewExpression,
  ctx: FileContext,
): ts.Node | undefined {
  const origin = ctx.types.valueOriginOf(unwrapped(call.expression));
  const declared = origin === undefined ? undefined : ctx.types.declarationOf(origin);
  if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return undefined;
  // A function expression is listed by the variable that holds it (`markersIn`).
  let node = declared.node;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    let held: ts.Node = node;
    while (
      ts.isParenthesizedExpression(held.parent) ||
      ts.isAsExpression(held.parent) ||
      ts.isSatisfiesExpression(held.parent)
    ) {
      held = held.parent;
    }
    if (!ts.isVariableDeclaration(held.parent)) return undefined;
    node = held.parent;
  }
  return isReleaseMarker(node, ctx) ? node : undefined;
}

/**
 * The function stated `Release` that a wrapper of the project returns the value of, when the
 * wrapper states nothing itself (`function start() { return watchPrices(…); }`, an object's
 * method, a static method): the trait reaches the wrapper's callers through its inferred return
 * type, and a finding at a caller is against the function that states it. Follows wrappers of
 * wrappers a few levels deep.
 */
function markerBehind(node: ts.Node, ctx: FileContext, depth = 0): ts.Node | undefined {
  if (depth > 3) return undefined;
  if (isReleaseMarker(node, ctx)) return node;
  const fn =
    functionOfDeclaration(node) ??
    ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ? node.initializer
      : ts.isGetAccessorDeclaration(node)
        ? node
        : undefined);
  const body = fn !== undefined && "body" in fn ? fn.body : undefined;
  if (body === undefined) return undefined;
  const returned: ts.Expression[] = [];
  if (!ts.isBlock(body)) returned.push(body);
  const visit = (child: ts.Node): void => {
    if (ts.isFunctionLike(child)) return;
    if (ts.isReturnStatement(child) && child.expression !== undefined) {
      returned.push(child.expression);
    }
    ts.forEachChild(child, visit);
  };
  if (ts.isBlock(body)) ts.forEachChild(body, visit);
  for (const value of returned) {
    const inner = unwrapped(value);
    const call = ts.isAwaitExpression(inner) ? unwrapped(inner.expression) : inner;
    if (!isCall(call)) continue;
    const declared = markedDeclaration(call, ctx) ?? originalMarker(call, ctx);
    const found = declared === undefined ? undefined : markerBehind(declared, ctx, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Whether a declaration is one `markersIn` lists: a function whose return type states `Release`. */
function isReleaseMarker(node: ts.Node, ctx: FileContext): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return (
      node.name !== undefined &&
      node.type !== undefined &&
      ctx.types.guaranteesOf(node.type).includes("release")
    );
  }
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return false;
  const value = node.initializer;
  return (
    value !== undefined &&
    (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) &&
    value.type !== undefined &&
    ctx.types.guaranteesOf(value.type).includes("release")
  );
}

function isCall(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  return ts.isCallExpression(node) || ts.isNewExpression(node);
}

/** The functions the file declares with a `Release` return type: `watchPrices(): Release<() => void>`. */
function markersIn(ctx: FileContext): ReleaseSummary["markers"] {
  if (!ctx.types.declaresTrait("release")) return [];
  const found: ReleaseSummary["markers"] = [];
  const visit = (node: ts.Node): void => {
    if (isReleaseMarker(node, ctx)) {
      const name =
        ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
          ? node.name?.getText(ctx.sourceFile)
          : ts.isVariableDeclaration(node)
            ? node.name.getText(ctx.sourceFile)
            : undefined;
      if (name !== undefined) found.push({ name, ...placeOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

/** Each call of the file whose result has the release trait, with the trait. */
function tracedCalls(
  ctx: FileContext,
  settings: Settings | undefined,
): { call: ts.CallExpression | ts.NewExpression; trait: ReleaseTrait }[] {
  const found: { call: ts.CallExpression | ts.NewExpression; trait: ReleaseTrait }[] = [];
  // Most calls cannot have the trait: the syntax rules them out before any type question.
  const candidate = releaseCandidates(ctx);
  const visit = (node: ts.Node): void => {
    if (isCall(node) && candidate(node)) {
      const trait = releaseTraitOf(node, ctx, { platformPackages: PLATFORM });
      // `ignore` leaves out the facts stateward ships; what the code states (a `Release` marker, a
      // `Disposable` type, a `facts` line) stays checked, whatever the options say.
      if (
        trait !== undefined &&
        (trait.source.kind !== "shipped" || !matchesName(trait.callee, settings?.ignore ?? []))
      ) {
        found.push({ call: node, trait });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

/**
 * A call in the initializer of an instance field (`private stop = watchPrices(…)`): each instance
 * starts one, and whether something releases it is not followed. A static field lives as long as
 * the program, as a module's top level does.
 */
function fieldProblem(
  call: ts.CallExpression | ts.NewExpression,
  ctx: FileContext,
): Problem | undefined {
  const field = ts.findAncestor(call.parent, ts.isPropertyDeclaration);
  if (
    field === undefined ||
    (field.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
  ) {
    return undefined;
  }
  const owner = ts.isClassLike(field.parent) ? field.parent.name?.text : undefined;
  const shown = shownCall(call, ctx.sourceFile);
  const name = field.name.getText(ctx.sourceFile);
  return {
    node: call,
    unchecked: true,
    message: fitted(
      (cut) =>
        `the result of \`${cut.name(shown)}\` is kept in the field \`${name}\`${owner === undefined ? "" : ` of \`${owner}\``}, which is not followed`,
    ),
    hint: "start it in a method, keep it in the field, and release it in another method: `this.stop?.()`",
  };
}

/** The call's problem, when the function around it does not release what it returns. */
function callProblem(
  call: ts.CallExpression | ts.NewExpression,
  trait: ReleaseTrait,
  ctx: FileContext,
): Problem | undefined {
  const fn = enclosingFunction(call);
  // In a field of each instance it lives as long as the instance, which nothing here follows.
  if (fn === undefined) return fieldProblem(call, ctx);
  // At the top of a module it lives as long as the program. In an effect, a trait the code states
  // with the marker is proven here, as anywhere; the others are React's rule's.
  if (isEffectCallback(fn) && trait.source.kind !== "marker") return undefined;
  return problemOf(call, fn, trait, ctx);
}

/** Each function of the file with a `Release` parameter, with the parameter and what is wrong with it. */
function parametersIn(
  ctx: FileContext,
): { param: ts.ParameterDeclaration; fn: ts.SignatureDeclaration; problem: Problem | undefined }[] {
  if (!ctx.types.declaresTrait("release")) return [];
  const found: ReturnType<typeof parametersIn> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && "body" in node && node.body !== undefined) {
      for (const param of node.parameters) {
        if (parameterTrait(param, ctx) === undefined) continue;
        found.push({ param, fn: node, problem: checkParameter(param, node, ctx) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

function functionName(fn: ts.SignatureDeclaration, sourceFile: ts.SourceFile): string {
  if (fn.name !== undefined) return fn.name.getText(sourceFile);
  const parent = fn.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : "a function";
}

function releaseSummary(ctx: FileContext<Settings>): ReleaseSummary | undefined {
  const markers = markersIn(ctx);
  const calls = tracedCalls(ctx, ctx.options).map(({ call, trait }) => {
    const declaration = trait.source.kind === "marker" ? markedDeclaration(call, ctx) : undefined;
    const problem = callProblem(call, trait, ctx);
    return {
      ...placeOf(call),
      callee: ts.isNewExpression(call) ? `new ${trait.callee}` : trait.callee,
      source: trait.source,
      declaration: declaration === undefined ? null : placeOf(declaration),
      unchecked: problem?.unchecked === true ? withFix(problem.message, problem.hint) : null,
    };
  });
  const params = parametersIn(ctx).map(({ param, fn, problem }) => ({
    ...placeOf(param),
    name: param.name.getText(ctx.sourceFile),
    fn: { ...placeOf(fn), name: functionName(fn, ctx.sourceFile) },
    unchecked: problem?.unchecked === true ? withFix(problem.message, problem.hint) : null,
  }));
  return markers.length > 0 || calls.length > 0 || params.length > 0
    ? { markers, calls, ...(params.length > 0 ? { params } : {}) }
    : undefined;
}

/** The name a call reaches its function by: `watchPrices` in `watchPrices(…)` and `api.watchPrices(…)`. */
function calleeName(call: ts.CallExpression | ts.NewExpression): ts.Node {
  const callee = unwrapped(call.expression);
  return ts.isPropertyAccessExpression(callee) ? callee.name : callee;
}

/**
 * Marks the file's references to what states `Release` (the reference ledger): a call the rule
 * traces is read (its finding, or none, says what it does); an import, an export or a type is
 * irrelevant; in a function with a `Release` parameter, each use of it the rule reads, and a read
 * that does not release it nor hands it on. Anything else (an alias, a function given as a value,
 * a call the rule does not trace) is left unmarked, so the guarantee reads "not checked" there.
 */
function markReferences(ctx: FileContext<Settings>): void {
  const refs = ctx.ledger.filter((ref) => ref.trait === "release");
  if (refs.length === 0) return;
  const traced = new Set(
    tracedCalls(ctx, ctx.options).map(({ call }) => calleeName(call).getStart(ctx.sourceFile)),
  );
  const params = new Set<string>();
  const readOfParams = new Set<number>();
  for (const { param, fn } of parametersIn(ctx)) {
    const trait = parameterTrait(param, ctx);
    if (trait === undefined || !ts.isIdentifier(param.name)) continue;
    params.add(declarationId({ file: ctx.file, start: param.getStart(ctx.sourceFile) }));
    const read = new Set<ts.Node>();
    usesOf(param.name, fn, trait, ctx, read);
    for (const node of read) readOfParams.add(node.getStart(ctx.sourceFile));
  }
  for (const ref of refs) {
    const at = ref.location.start;
    if (ref.form === "import" || ref.form === "export" || ref.form === "type") {
      ctx.read(ref, { kind: "irrelevant" });
    } else if (params.has(ref.declaration)) {
      if (readOfParams.has(at)) ctx.read(ref, { kind: "decided" });
      else if (ref.form === "write") {
        ctx.read(ref, {
          kind: "unchecked",
          reason: `\`${ref.text}\` gives \`${ref.name}\` another value, so the one it held is not followed: keep each value in a \`const\` and release it`,
        });
      } else if (ref.form === "read") ctx.read(ref, { kind: "irrelevant" });
    } else if (ref.form === "call" && traced.has(at)) {
      ctx.read(ref, { kind: "decided" });
    }
  }
}

/** Reports a problem: an error, or a place not checked, with the notes that say where the trait is stated. */
function show(
  { unchecked, ...problem }: Problem,
  related: readonly { node: ts.Node; message: string }[],
  ctx: FileContext,
  /** The declaration that states the trait, when the rule knows it (the finding is linked to it). */
  declaration?: ts.Node,
): void {
  if (unchecked === true) {
    ctx.unknown({
      node: problem.node,
      message: `not checked: ${problem.message}`,
      hint: problem.hint,
      ...(declaration === undefined ? {} : { against: declaration }),
    });
    return;
  }
  ctx.report({ ...problem, against: declaration ?? true, related });
}

export const resourceNotReleased = defineRule({
  kind: "file",
  meta: {
    description:
      "A value with the release trait (a subscription, a listener, a connection) that a function starts and never releases keeps running, and the leak shows far from its cause.",
    summary:
      "a subscription, listener or connection stated to need releasing that is never released",
    defaultSeverity: "error",
    tier: "core",
    group: "owners",
    proves: { traits: ["release"], returns: ["release"] },
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    markReferences(ctx);
    for (const { call, trait } of tracedCalls(ctx, ctx.options)) {
      const problem = callProblem(call, trait, ctx);
      if (problem === undefined) continue;
      const declaration = trait.source.kind === "marker" ? markedDeclaration(call, ctx) : undefined;
      // The finding is against the function that states the trait, whatever name the call uses.
      const stated =
        declaration !== undefined && isReleaseMarker(declaration, ctx)
          ? declaration
          : trait.source.kind === "marker"
            ? (originalMarker(call, ctx) ??
              (declaration === undefined ? undefined : markerBehind(declaration, ctx)))
            : undefined;
      show(
        problem,
        [
          { node: call, message: describeRelease(trait) },
          ...(declaration === undefined
            ? []
            : [{ node: declaration, message: `\`${trait.callee}\` is stated \`Release\` here` }]),
        ],
        ctx,
        stated,
      );
    }
    for (const { param, problem } of parametersIn(ctx)) {
      if (problem === undefined) continue;
      show(
        problem,
        [
          {
            node: param,
            message: `\`${param.name.getText(ctx.sourceFile)}\` is stated \`Release\` here`,
          },
        ],
        ctx,
      );
    }
  },
  summarize(ctx): Json | undefined {
    return releaseSummary(ctx);
  },
});
