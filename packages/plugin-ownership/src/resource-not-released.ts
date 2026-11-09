import ts from "@stateward/core/typescript";
import {
  defineRule,
  describeRelease,
  matchesName,
  neverRejectsFactOf,
  option,
  releaseCandidates,
  releaseTraitOf,
  type FileContext,
  type Json,
  type OptionsOf,
  type ReleaseTrait,
  type TraitSource,
} from "@stateward/core";
import { fitted } from "./text.js";

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

It checks every value whose release trait is stated (see below), on every way out of the function that holds it: a \`return\`, a \`throw\` and a failed \`await\`. An \`await\` of a promise that a \`facts\` line states \`neverRejects: true\` is not a way out: RTK Query's \`cacheEntryRemoved\` only resolves, so the release after \`await cacheEntryRemoved\` in \`onCacheEntryAdded\` runs. Released means:

- calling it (a release function), calling the stated method, or \`using\`, \`await using\` or \`[Symbol.dispose]()\` (a \`Disposable\`); a call in \`finally\` covers every way out;
- calling it in a function written inside, such as a cleanup or a callback;
- returning it, or passing it to a parameter typed \`Release\`: the caller now owns it;
- storing it in a place the file releases (\`this.stop = …\` and \`this.stop()\` in another method), or in a place stated \`Owned\`, whose module releases it.

A place it cannot follow is an error that says why: the value passed to a function whose parameter is not typed \`Release\`, or stored in an array or an object. It does not report:

- a value started at the top of a module: it lives as long as the program;
- a value started in a React effect: \`react/effect-missing-cleanup\` reads the same trait there;
- a value whose trait nobody states: a function with no marker, no \`facts\` line and no \`Disposable\` type.

## Getting the best from it

State the trait in the plainest way that fits:

- a class or type of the project with \`[Symbol.dispose]\` or \`[Symbol.asyncDispose]\` (\`Disposable\`, \`AsyncDisposable\`) has it with nothing more to write. A \`Disposable\` from TypeScript's own library or a package does not: they add these methods to values that never need a release (iterators, generators, test mocks, Node's timers and streams). A package's value has the trait through a \`facts\` line. A method that returns its own object (\`stream.on(…)\`) starts nothing new;
- the \`Release<T>\` marker on the return type of the project's own function, as \`watchPrices\` above;
- a \`facts\` line in the config for a package: \`facts: { "firebase/firestore": { onSnapshot: { returns: "release" } } }\` (call the returned function) or \`{ returns: { release: "unsubscribe" } }\` (call that method on it).

The ownership pack ships facts for Firebase \`onSnapshot\`, RxJS \`Observable.subscribe\` (\`unsubscribe\`), Redux \`Store.subscribe\`, zustand \`StoreApi.subscribe\`, and RTK Query's \`cacheEntryRemoved\` (\`neverRejects\`); a config line for the same function wins. Each finding's note says where its trait comes from, and \`stateward guarantees\` lists every source in use.

A value meant to live as long as the app (a store subscription started once at startup) is never released on purpose. At the top of a module it is not reported; started in a function, say so on the line above with the reason: \`// stateward-ignore ownership/resource-not-released: lives as long as the app\`.

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
      "Functions whose results are not checked, as the note names them (globs like `Observable.*`).",
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
function releaseCode(trait: ReleaseTrait, name: string): string {
  switch (trait.way.kind) {
    case "call":
      return `${name}()`;
    case "method":
      return `${name}.${trait.way.name}()`;
    case "dispose":
      return trait.way.async ? `await ${name}[Symbol.asyncDispose]()` : `${name}[Symbol.dispose]()`;
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
  | { kind: "passed"; node: ts.Node; to: string }
  | { kind: "stored"; node: ts.Node; place: string; released: boolean }
  | { kind: "kept"; node: ts.Node; where: string };

function isNestedIn(node: ts.Node, fn: ts.SignatureDeclaration): boolean {
  for (let at = node.parent; at !== fn; at = at.parent) {
    if (ts.isFunctionLike(at)) return true;
  }
  return false;
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

/** What happens to a value at `node`, an expression that holds it. */
function useAt(node: ts.Expression, trait: ReleaseTrait, ctx: FileContext): Use | undefined {
  const value = valueOf(node);
  const parent = value.parent;
  if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === value)) {
    return { kind: "handed", node: value };
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== value) {
    if (ctx.types.contextualGuaranteesOf(value).includes("release")) {
      return { kind: "handed", node: value };
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
    const owned = ctx.types.guaranteesOf(parent.left).includes("owned");
    return {
      kind: "stored",
      node: value,
      place,
      released: owned || fileReleases(ctx.sourceFile, place, trait),
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
    } else if (ts.isIdentifier(node) && node !== name && same(node)) {
      const parent = node.parent;
      const callee =
        (ts.isCallExpression(parent) && parent.expression === node) ||
        (ts.isPropertyAccessExpression(parent) && parent.expression === node);
      const use = callee ? undefined : useAt(node, trait, ctx);
      if (use !== undefined) uses.push(use);
    }
    ts.forEachChild(node, visit);
  };
  const body = "body" in fn ? fn.body : undefined;
  if (body !== undefined) visit(body);
  return uses;
}

/** Whether `node` runs on only some paths of `fn`: under an `if`, a `case`, a `catch`, `?:` or `&&`. */
function isConditional(node: ts.Node, fn: ts.SignatureDeclaration): boolean {
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

type Problem = { node: ts.Node; message: string; hint: string };

/** The last way out of a "never released" finding: a value meant to live as long as the app. */
const LIVES_WITH_APP =
  "- or, if it lives as long as the app, say so on the line above: `// stateward-ignore ownership/resource-not-released: lives as long as the app`";

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
  const value = valueOf(call);
  const parent = value.parent;
  const shown = shownCall(call, ctx.sourceFile);
  if (ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)) {
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
    return variableProblem(parent.name, call, fn, trait, ctx);
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
  const subject = name === "it" ? `the result of \`${shown}\`` : `\`${name}\` from \`${shown}\``;
  switch (use.kind) {
    case "release":
    case "handed":
      return undefined;
    case "passed":
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
      return use.released
        ? undefined
        : {
            node: use.node,
            message: fitted(
              (cut) =>
                `${cut.name(subject)} is stored in \`${cut.name(use.place)}\`, which the file never releases`,
            ),
            hint: [
              "one of",
              `- release it where it is stored: \`${releaseCode(trait, use.place)}\``,
              `- or state \`${use.place}\` \`Owned\`, so its module releases it`,
            ].join("\n"),
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

function variableProblem(
  name: ts.Identifier,
  call: ts.CallExpression | ts.NewExpression,
  fn: ts.SignatureDeclaration,
  trait: ReleaseTrait,
  ctx: FileContext,
): Problem | undefined {
  const shown = shownCall(call, ctx.sourceFile);
  const uses = usesOf(name, fn, trait, ctx);
  // A place it cannot follow, or a store nothing releases, is the finding: the trait was stated.
  for (const use of uses) {
    if (use.kind === "passed" || use.kind === "kept" || (use.kind === "stored" && !use.released)) {
      return useProblem(use, shown, name.text, trait);
    }
  }
  if (uses.some((use) => use.kind === "handed" || use.kind === "stored")) return undefined;
  const releases = uses.filter((use) => use.kind === "release");
  if (releases.length === 0) {
    return {
      node: name,
      message: fitted(
        (cut) => `\`${cut.name(name.text)}\` from \`${cut.name(shown)}\` is never released`,
      ),
      hint: neverHint(trait, name.text, shown),
    };
  }
  // In a function written inside (a cleanup, a callback), it is released when that one runs.
  if (releases.some((use) => use.nested)) return undefined;
  const sure = releases.find(
    (use) =>
      inFinally(use.node, fn) ||
      (!isConditional(use.node, fn) &&
        exitBetween(fn, call.end, use.node.getStart(), ctx) === undefined),
  );
  if (sure !== undefined) return undefined;
  return {
    node: name,
    message: fitted(
      (cut) =>
        `\`${cut.name(name.text)}\` from \`${cut.name(shown)}\` is not released on every way out`,
    ),
    hint: [
      "one of",
      `- release it in \`finally\`: \`try { … } finally { ${releaseCode(trait, name.text)}; }\``,
      "- or return it, so the caller releases it",
    ].join("\n"),
  };
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

function isCall(node: ts.Node): node is ts.CallExpression | ts.NewExpression {
  return ts.isCallExpression(node) || ts.isNewExpression(node);
}

/** The functions the file declares with a `Release` return type: `watchPrices(): Release<() => void>`. */
function markersIn(ctx: FileContext): ReleaseSummary["markers"] {
  if (!ctx.types.declaresTrait("release")) return [];
  const found: ReleaseSummary["markers"] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name !== undefined &&
      node.type !== undefined &&
      ctx.types.guaranteesOf(node.type).includes("release")
    ) {
      found.push({ name: node.name.getText(ctx.sourceFile), ...placeOf(node) });
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      node.initializer.type !== undefined &&
      ctx.types.guaranteesOf(node.initializer.type).includes("release")
    ) {
      found.push({ name: node.name.text, ...placeOf(node) });
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
      if (trait !== undefined && !matchesName(trait.callee, settings?.ignore ?? [])) {
        found.push({ call: node, trait });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

function releaseSummary(ctx: FileContext<Settings>): ReleaseSummary | undefined {
  const markers = markersIn(ctx);
  const calls = tracedCalls(ctx, ctx.options).map(({ call, trait }) => {
    const declaration = trait.source.kind === "marker" ? markedDeclaration(call, ctx) : undefined;
    return {
      ...placeOf(call),
      callee: ts.isNewExpression(call) ? `new ${trait.callee}` : trait.callee,
      source: trait.source,
      declaration: declaration === undefined ? null : placeOf(declaration),
    };
  });
  return markers.length > 0 || calls.length > 0 ? { markers, calls } : undefined;
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
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    for (const { call, trait } of tracedCalls(ctx, ctx.options)) {
      const fn = enclosingFunction(call);
      // At the top of a module it lives as long as the program; in an effect it is React's rule's.
      if (fn === undefined || isEffectCallback(fn)) continue;
      const problem = problemOf(call, fn, trait, ctx);
      if (problem === undefined) continue;
      const declaration = trait.source.kind === "marker" ? markedDeclaration(call, ctx) : undefined;
      ctx.report({
        ...problem,
        related: [
          { node: call, message: describeRelease(trait) },
          ...(declaration === undefined
            ? []
            : [{ node: declaration, message: `\`${trait.callee}\` is stated \`Release\` here` }]),
        ],
      });
    }
  },
  summarize(ctx): Json | undefined {
    return releaseSummary(ctx);
  },
});
