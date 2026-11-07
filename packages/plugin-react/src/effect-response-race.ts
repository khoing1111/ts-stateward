import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { TypeQueries } from "@stateward/core";
import {
  cleanupsOf,
  declarationNode,
  enclosingFunction,
  effectsIn,
  isFunctionNode,
  propOf,
  textOf,
  type Effect,
} from "./effects.js";
import { stateWrites } from "./late-writes.js";
import {
  abortFix,
  guardedByStaleFlag,
  loadersIn,
  proveAborted,
  type Loader,
  type Verdict,
} from "./latest-wins.js";
import { calleeName, reactName, unwrapped } from "./react.js";
import { fitted, shorten } from "./text.js";
import { bindingPath, isFunctionLike, RenderScope } from "./value.js";

const EXPLAIN = `# react/effect-response-race

Without an abort in the cleanup, the response to an old request can arrive after a newer one and replace the newer data on screen.

\`\`\`tsx example-bad
import { useEffect, useState } from "react";

declare function fetchUser(id: string, options?: { signal?: AbortSignal }): Promise<{ name: string }>;

export function Profile({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  useEffect(() => {
    fetchUser(userId).then((user) => setName(user.name));
  }, [userId]);
  return <h1>{name}</h1>;
}
\`\`\`

Create an \`AbortController\` in the effect, pass its signal, and abort it in the cleanup. The quick fix writes all three:

\`\`\`tsx example-good
import { useEffect, useState } from "react";

declare function fetchUser(id: string, options?: { signal?: AbortSignal }): Promise<{ name: string }>;

export function Profile({ userId }: { userId: string }) {
  const [name, setName] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetchUser(userId, { signal: controller.signal }).then((user) => setName(user.name));
    return () => controller.abort();
  }, [userId]);
  return <h1>{name}</h1>;
}
\`\`\`

A flag that the cleanup sets, checked before each write, is proven too (the React docs' pattern): \`let ignore = false;\`, \`if (!ignore) setName(…)\`, \`return () => { ignore = true; };\`. It drops the late answer but lets the request run to the end.

## Why it matters

The effect starts a request every time \`userId\` changes, and nothing stops the old ones. When the user clicks from profile 1 to profile 2 and the request for 1 is slower, it answers last, and profile 1's name shows on profile 2's page. The bug depends on timing, so it shows up on slow networks and almost never in development.

## What it does not catch

A function whose parameters take an \`AbortSignal\`, directly or as \`signal\` in an options object (\`fetch(url, { signal })\`, axios's \`signal\`, your own \`fetchUser(id, signal)\`), says it can be cancelled. For every call to one in an effect whose answer sets state (after an \`await\`, in a \`.then\`, or through a function of the component that sets state), the rule proves that the call gets the signal of an \`AbortController\` the effect creates and aborts in its cleanup, or that every write checks a flag the cleanup sets. What it cannot prove is an error that names the missing step. A signal received by a function written in the effect (\`async function load(signal)\`) counts when every call of it passes the effect's signal. It is silent on:

- an effect that runs once (an empty dependency list, or dependencies that keep their identity): no newer request can overtake it;
- the calls of TanStack Query, SWR and RTK Query, which manage their own cancellation;
- a \`catch\` that sets state when the request is aborted: test \`signal.aborted\` there;
- calls that take no signal, unless you list the add-on below.

It stays on with the React Compiler, which does not change effects.

## Getting the best from it

Give your loaders a \`signal\` parameter and pass it on to \`fetch\`: the rule then proves every effect that calls them. Name your hooks whose values keep their identity in \`stableHooks\` (shared with \`react/dependency-changes-every-render\`).

### Calls that cannot be cancelled

With the \`react/effect-race\` add-on the rule also warns, as a guess, about an effect that sets state after an \`await\` of a call that takes no signal, when a prop or a route parameter in its dependencies can change while the request runs and no cleanup sets a flag. A write after \`if (…) return;\` whose test reads a ref, or an update that keeps the previous state in one branch, already drops a late response and is not reported. Name the awaited calls that are not requests in \`notRequests\` (\`sleep\`, \`delay\`).

## Turn it on or off

It is on in \`recommended\` and \`strict\`. The add-on adds the guesses about calls that cannot be cancelled.

\`\`\`ts
addons: ["react/effect-race"]
rules: { "react/effect-response-race": ["error", { notRequests: ["sleep", "delay"] }] } // awaited calls that are not requests
rules: { "react/effect-response-race": "off" }
\`\`\`
`;

/** The data-loading hooks the fix suggests, by the package that provides them. */
const DATA_HOOKS: readonly { readonly pkg: string; readonly hook: string }[] = [
  { pkg: "@tanstack/react-query", hook: "useQuery" },
  { pkg: "react-query", hook: "useQuery" },
  { pkg: "swr", hook: "useSWR" },
];

/** The call an awaited expression makes, through parentheses: `fetchUser(id)`. */
function unwrappedCall(expression: ts.Expression): ts.CallExpression | undefined {
  if (ts.isParenthesizedExpression(expression)) return unwrappedCall(expression.expression);
  return ts.isCallExpression(expression) ? expression : undefined;
}

/** Whether a node reads `x.current` (a ref), not inside a nested function. */
function readsRef(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "current") return true;
  if (isFunctionNode(node)) return false;
  return ts.forEachChild(node, readsRef) === true;
}

/**
 * Whether a condition tells a late response from the current one: it reads a ref (`request !==
 * latest.current`) or calls a function of the effect that does (`isStale()`).
 */
function testsStaleness(condition: ts.Expression, effect: Effect): boolean {
  if (readsRef(condition)) return true;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const callee = ts.isCallExpression(node) ? unwrapped(node.expression) : undefined;
    if (callee !== undefined && ts.isIdentifier(callee)) {
      const local = localFunction(effect.callback, callee.text);
      if (local !== undefined && readsRef(local)) found = true;
    }
    if (!isFunctionNode(node)) ts.forEachChild(node, visit);
  };
  visit(condition);
  return found;
}

/** The body of `const name = () => …` or `function name() {…}` declared in the effect. */
function localFunction(scope: ts.Node, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer.body;
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body !== undefined) {
      found = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

/**
 * Whether the code already drops a late response at this write (real-world corpus, excalidraw): an
 * `if (…) return;` before it in the same function tests a ref for staleness, or the setter is
 * given an update that keeps the previous state in one branch
 * (`setLib((prev) => (prev.api === api ? next : prev))`).
 */
function checkedAtWrite(node: ts.Node, effect: Effect): boolean {
  if (ts.isCallExpression(node)) {
    const [update] = node.arguments;
    const fn = update === undefined ? undefined : unwrapped(update);
    if (fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
      const [previous] = fn.parameters;
      if (previous !== undefined && ts.isIdentifier(previous.name)) {
        const name = previous.name.text;
        const keepsPrevious = (current: ts.Node): boolean => {
          if (
            ts.isConditionalExpression(current) &&
            [current.whenTrue, current.whenFalse].some((branch) => {
              const value = unwrapped(branch);
              return ts.isIdentifier(value) && value.text === name;
            })
          ) {
            return true;
          }
          return !isFunctionNode(current) && ts.forEachChild(current, keepsPrevious) === true;
        };
        if (keepsPrevious(fn.body)) return true;
      }
    }
  }
  const fn = enclosingFunction(node);
  if (fn === undefined) return false;
  let checked = false;
  const visit = (current: ts.Node): void => {
    if (checked || current.pos >= node.pos) return;
    if (
      ts.isIfStatement(current) &&
      current.end <= node.pos &&
      exits(current.thenStatement) &&
      testsStaleness(current.expression, effect)
    ) {
      checked = true;
      return;
    }
    if (!isFunctionNode(current)) ts.forEachChild(current, visit);
  };
  ts.forEachChild(fn, visit);
  return checked;
}

/** `return;`, `return x;`, or a block that ends with one. */
function exits(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (!ts.isBlock(statement)) return false;
  const last = statement.statements[statement.statements.length - 1];
  return last !== undefined && ts.isReturnStatement(last);
}

/** Whether a cleanup stops a late write: it sets a flag, or aborts or cancels the request. */
function guarded(types: TypeQueries, effect: Effect): boolean | "unreadable" {
  const cleanups = cleanupsOf(types, effect);
  if (cleanups.unreadable) return "unreadable";
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
      (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ["abort", "cancel"].includes(node.expression.name.text))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const fn of cleanups.functions) visit(fn);
  return found;
}

/** React hooks whose result, or one part of it, keeps its identity: `[, setX]`, `[, dispatch]`. */
const REACT_STABLE: Readonly<Record<string, string | null>> = {
  useState: "1",
  useReducer: "1",
  useTransition: "1",
  useActionState: "1",
  useOptimistic: "1",
  useRef: null,
  useEffectEvent: null,
};

/** RTK Query's generated hooks and the part of their result that keeps its identity. */
const RTK_STABLE: readonly { readonly hook: RegExp; readonly part: string }[] = [
  { hook: /^useLazy\w*Query$/, part: "0" },
  { hook: /^use\w*Mutation$/, part: "0" },
  { hook: /^use\w*Query$/, part: "refetch" },
];

/**
 * Whether a dependency keeps its identity between renders, so a change of it cannot start a newer
 * request: a setter or `dispatch` from React, a package's stable function (react-redux's
 * `dispatch`, react-router's `navigate`, an RTK Query trigger or `refetch`), or a value of one of
 * the config's `stableHooks`.
 */
function keepsIdentity(
  types: TypeQueries,
  scope: RenderScope | undefined,
  dep: ts.Expression,
  rtk: boolean,
  stableHooks: readonly string[],
): boolean {
  const node = unwrapped(dep);
  if (!ts.isIdentifier(node) || types.isPrimitive(node)) return false;
  // An object is stable only as a value of a hook in `stableHooks` (a store from context, real-world corpus:
  // outline's `useStores()`); a memoized object changes with its inputs.
  if (!types.isCallable(node)) return fromStableHook(types, node, stableHooks);
  const declaration = declarationNode(types, node);
  if (declaration === undefined) return false;
  const found = ts.isBindingElement(declaration)
    ? bindingPath(declaration)
    : ts.isVariableDeclaration(declaration)
      ? { declaration, path: [] }
      : undefined;
  const init =
    found === undefined || !ts.isVariableDeclaration(found.declaration)
      ? undefined
      : found.declaration.initializer;
  const call = init === undefined ? undefined : unwrapped(init);
  if (found === undefined || call === undefined || !ts.isCallExpression(call)) return false;
  const name = calleeName(call.expression);
  const react = reactName(types, name);
  if (react !== undefined) {
    const part = REACT_STABLE[react];
    return part !== undefined && (part === null ? found.path.length === 0 : found.path[0] === part);
  }
  if (
    rtk &&
    ts.isIdentifier(name) &&
    found.path.length === 1 &&
    RTK_STABLE.some((entry) => entry.hook.test(name.text) && entry.part === found.path[0]) &&
    !isFunctionNode(declarationNode(types, name) ?? name)
  ) {
    return true;
  }
  return scope?.valueOf(node).kind === "stable";
}

/** Whether `node` is declared from a call of a hook in `stableHooks` (`const store = useStore()`). */
function fromStableHook(
  types: TypeQueries,
  node: ts.Identifier,
  stableHooks: readonly string[],
): boolean {
  const declaration = declarationNode(types, node);
  const found =
    declaration === undefined
      ? undefined
      : ts.isBindingElement(declaration)
        ? bindingPath(declaration)?.declaration
        : declaration;
  if (found === undefined || !ts.isVariableDeclaration(found) || found.initializer === undefined) {
    return false;
  }
  const call = unwrapped(found.initializer);
  if (!ts.isCallExpression(call)) return false;
  const name = calleeName(call.expression);
  return ts.isIdentifier(name) && matchesName(name.text, stableHooks);
}

/** The dependency a request reads (by name), else the first dependency that can change. */
function changingInput(
  effect: Effect,
  request: ts.Expression,
  sourceFile: ts.SourceFile,
  stable: (dep: ts.Expression) => boolean,
): string | undefined {
  if (effect.deps === "none" || effect.deps === "unreadable") return undefined;
  const deps = effect.deps.filter((dep) => !stable(dep)).map((dep) => textOf(dep, sourceFile));
  const read = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node))
      read.add(textOf(node, sourceFile));
    ts.forEachChild(node, visit);
  };
  visit(request);
  return deps.find((dep) => read.has(dep)) ?? deps[0];
}

/** The hooks whose values are route parameters: a new page, a new value. */
const ROUTE_HOOKS: ReadonlySet<string> = new Set([
  "useParams",
  "useSearchParams",
  "useLocation",
  "useRouter",
  "useMatch",
  "useRouteMatch",
  "useSearch",
  "usePathname",
]);

/** The variable declaration a name is declared in, through destructuring. */
function variableOf(types: TypeQueries, node: ts.Identifier): ts.VariableDeclaration | undefined {
  let declaration: ts.Node | undefined = declarationNode(types, node);
  while (declaration !== undefined && ts.isBindingElement(declaration)) {
    declaration = declaration.parent.parent;
  }
  return declaration !== undefined && ts.isVariableDeclaration(declaration)
    ? declaration
    : undefined;
}

/** Whether a dependency is read from a route hook: `const { id } = useParams()`, `params.id`. */
function isRouteValue(types: TypeQueries, dep: ts.Expression, depth = 0): boolean {
  if (depth > 2) return false;
  let node = unwrapped(dep);
  while (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
    node = unwrapped(node.expression);
  }
  if (!ts.isIdentifier(node)) return false;
  const declaration = variableOf(types, node);
  const init =
    declaration?.initializer === undefined ? undefined : unwrapped(declaration.initializer);
  if (init === undefined) return false;
  if (ts.isCallExpression(init)) {
    const name = calleeName(init.expression);
    if (ts.isIdentifier(name) && ROUTE_HOOKS.has(name.text)) return true;
  }
  return isRouteValue(types, init, depth + 1);
}

/** The prop or route parameter in the dependencies, compared by value, that a new render can change. */
function changingIdentity(
  types: TypeQueries,
  effect: Effect,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (effect.deps === "none" || effect.deps === "unreadable") return undefined;
  const dep = effect.deps.find(
    (candidate) =>
      types.isPrimitive(candidate) &&
      (propOf(types, candidate, effect.owner) !== undefined || isRouteValue(types, candidate)),
  );
  return dep === undefined ? undefined : textOf(dep, sourceFile);
}

/** How a call is named in a message: `fetchUser(…)`. */
function callText(call: ts.CallExpression, sourceFile: ts.SourceFile): string {
  return `${call.expression.getText(sourceFile).replace(/\s+/g, "")}(…)`;
}

function proofMessage(verdict: Verdict, call: string, input: string | undefined): string {
  return fitted((cut) => {
    const late =
      input === undefined
        ? "an old answer can overwrite a newer one"
        : `an answer for an old \`${cut.name(input)}\` can overwrite a newer one`;
    switch (verdict.kind) {
      case "pass":
        return `\`${cut.name(call)}\` takes an AbortSignal the effect never passes: ${late}`;
      case "abort":
        return `effect never aborts \`${cut.name(verdict.name)}\` in its cleanup: ${late}`;
      case "foreign":
        return `\`${cut.name(call)}\` gets a signal the effect does not abort: ${late}`;
      case "unreadable":
        return `\`${cut.name(call)}\` is not proven aborted: the cleanup is not written in the effect`;
      case "proven":
        return "";
      default: {
        const unreachable: never = verdict;
        return unreachable;
      }
    }
  });
}

/** The call with the signal where its callee takes it: `fetchUser(…, { signal: controller.signal })`. */
function withSignal(loader: Loader, sourceFile: ts.SourceFile): string {
  const callee = loader.call.expression.getText(sourceFile).replace(/\s+/g, "");
  const signal =
    loader.at.property === undefined ? "controller.signal" : "{ signal: controller.signal }";
  return `${shorten(callee, 40)}(${loader.at.index === 0 ? "" : "…, "}${signal})`;
}

function proofHint(verdict: Verdict, call: string, passed: string): string {
  switch (verdict.kind) {
    case "abort":
      return fitted(
        (cut) =>
          `abort it when the effect is cleaned up: \`return () => ${cut.name(verdict.name)}.abort();\``,
      );
    case "unreadable":
      return "return the cleanup as a function written in the effect, so it can be checked: `return () => controller.abort();`";
    case "pass":
    case "foreign":
    case "proven":
      return [
        fitted(
          (cut) =>
            `create a controller in the effect, pass its signal to \`${cut.name(call)}\`, and abort it in the cleanup:`,
        ),
        "    const controller = new AbortController();",
        `    ${passed}`,
        "    return () => controller.abort();",
      ].join("\n");
    default: {
      const unreachable: never = verdict;
      return unreachable;
    }
  }
}

function fixTitle(call: string): string {
  return `Abort ${call} when the effect is cleaned up`;
}

export const effectResponseRace = defineRule({
  kind: "file",
  meta: {
    description:
      "Without an abort in the cleanup, the response to an old request can arrive after a newer one and replace the newer data on screen.",
    summary:
      "an effect that calls a loader taking an `AbortSignal` and does not abort it in its cleanup",
    defaultSeverity: "error",
    tier: "core",
    group: "effects",
    widenedBy: ["effect-race"],
    needsTypes: { library: "React", modules: ["react"] },
    options: {
      notRequests: option.strings({
        default: [],
        description:
          "Awaited calls that are not requests, so a late answer cannot happen (sleep, delay, wait*; globs on the name as called). Read by the `react/effect-race` add-on.",
      }),
      stableHooks: option.strings({
        default: [],
        description:
          "Hooks (names or globs) whose values keep their identity; this rule also reads the `stableHooks` of `react/dependency-changes-every-render`, so set it there once.",
      }),
    },
    sharedOptions: { stableHooks: "dependency-changes-every-render" },
    explain: EXPLAIN,
  },
  check(ctx) {
    const { sourceFile, types } = ctx;
    const guessing = ctx.addons.includes("effect-race");
    const dependencies = types.dependenciesOf(ctx.file);
    const dataHook = DATA_HOOKS.find((entry) => dependencies.includes(entry.pkg));
    const rtk = dependencies.includes("@reduxjs/toolkit");
    for (const effect of effectsIn(types, sourceFile)) {
      const scope = isFunctionLike(effect.owner)
        ? new RenderScope(types, sourceFile, effect.owner, ctx.options.stableHooks)
        : undefined;
      const stable = (dep: ts.Expression): boolean =>
        keepsIdentity(types, scope, dep, rtk, ctx.options.stableHooks);
      // With every dependency keeping its identity, the effect runs once: no newer request.
      if (effect.deps !== "none" && effect.deps !== "unreadable" && effect.deps.every(stable)) {
        continue;
      }
      const cleanups = cleanupsOf(types, effect);
      const writes = stateWrites(types, effect);
      const loaders = loadersIn(types, effect, writes, cleanups);
      const missing = loaders.flatMap((loader) => {
        const verdict = proveAborted(types, effect, cleanups, loader);
        return verdict.kind === "proven" || guardedByStaleFlag(types, effect, cleanups, loader)
          ? []
          : [{ loader, verdict }];
      });
      const first = missing[0];
      const fix =
        first === undefined
          ? undefined
          : abortFix(
              types,
              sourceFile,
              effect,
              cleanups,
              missing,
              fixTitle(callText(first.loader.call, sourceFile)),
            );
      for (const { loader, verdict } of missing) {
        const call = callText(loader.call, sourceFile);
        const input = changingInput(effect, loader.call, sourceFile, stable);
        const own = verdict.kind === "pass" || verdict.kind === "abort";
        ctx.report({
          message: proofMessage(verdict, call, input),
          hint: proofHint(verdict, call, withSignal(loader, sourceFile)),
          node: loader.call,
          related: loader.writes
            .filter((write) => write !== loader.call)
            .slice(0, 3)
            .map((write) => ({ node: write, message: "state is set from the answer" })),
          ...(fix === undefined || !own ? {} : { fixes: [{ ...fix, title: fixTitle(call) }] }),
        });
      }
      if (!guessing || effect.deps === "unreadable") continue;
      const covered = new Set(loaders.flatMap((loader) => loader.writes));
      const input = changingIdentity(types, effect, sourceFile);
      if (input === undefined) continue;
      const late = writes.find(
        (write) =>
          !covered.has(write.node) &&
          write.awaited.length > 0 &&
          !checkedAtWrite(write.node, effect),
      );
      const awaited = late?.awaited[0];
      if (late === undefined || awaited === undefined) continue;
      const request = unwrappedCall(awaited);
      if (
        request !== undefined &&
        matchesName(
          request.expression.getText(sourceFile).replace(/\s+/g, ""),
          ctx.options.notRequests,
        )
      ) {
        continue;
      }
      const guard = guarded(types, effect);
      if (guard === true) continue;
      if (guard === "unreadable") {
        ctx.unknown({
          message:
            "not checked: whether the cleanup stops a late response: the cleanup is not written in the effect",
          hint: "return the cleanup as a function written in the effect (`return () => { ignore = true; }`), so it can be checked",
          node: late.node,
        });
        continue;
      }
      ctx.report({
        message: fitted(
          (cut) =>
            `response race: an answer for an old \`${cut.name(input)}\` can overwrite a newer one`,
        ),
        hint: [
          fitted((cut) =>
            dataHook === undefined
              ? "ignore a response that arrives after the effect is cleaned up:"
              : `load it with \`${dataHook.hook}\` from ${cut.name(dataHook.pkg)}, which drops late responses, or ignore them:`,
          ),
          "    let ignore = false;",
          `    … if (!ignore) ${late.setter}(…);`,
          "    return () => { ignore = true; };",
        ].join("\n"),
        node: late.node,
        severity: "warning",
        related: [{ node: awaited, message: "the request that can answer late" }],
      });
    }
  },
});
