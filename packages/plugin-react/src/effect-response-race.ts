import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { TypeQueries } from "@stateward/core";
import {
  bindingOf,
  cleanupsOf,
  declarationNode,
  enclosingFunction,
  effectsIn,
  isFunctionNode,
  setterCall,
  textOf,
  type Effect,
} from "./effects.js";
import { calleeName, reactName, unwrapped } from "./react.js";
import { fitted } from "./text.js";
import { bindingPath, isFunctionLike, RenderScope } from "./value.js";

const EXPLAIN = `# react/effect-response-race

An effect that loads data ignores a response that arrives after its inputs have changed.

## Why

\`useEffect(() => { fetchUser(userId).then(setUser); }, [userId])\` starts a request every time \`userId\` changes, and nothing stops the old ones. When the user clicks from profile 1 to profile 2 and the request for 1 is slower, it answers last and \`setUser\` shows profile 1 under the heading for 2. The bug depends on timing, so it shows up on slow networks and almost never in development.

## When to use it

Use it in an app that loads data in effects. It is off until you add its add-on (below), then a warning in every preset: it guesses that the awaited call is a request whose answer can arrive late. It stays on with the React Compiler, which does not change effects. Turn it off if you load data with a library that already handles this (TanStack Query, SWR, a router loader) and the effects it finds are not requests.

## What it catches

An effect with dependencies (or none listed, so it runs after every render) that sets state after an \`await\` or in a \`.then\`/\`.catch\` callback, with no cleanup that sets a flag or aborts the request.

### Bad

\`\`\`tsx
useEffect(() => {
  fetchUser(userId).then((user) => setUser(user));
}, [userId]);
\`\`\`

### Good

\`\`\`tsx
useEffect(() => {
  let ignore = false;
  fetchUser(userId).then((user) => {
    if (!ignore) setUser(user);
  });
  return () => {
    ignore = true;
  };
}, [userId]);
\`\`\`

An \`AbortController\` whose \`abort()\` the cleanup calls works too, and also cancels the request.

### Fix

Keep a flag that the cleanup sets, and set state only while it is not set; or abort the request in the cleanup. When the project uses \`@tanstack/react-query\` or \`swr\`, the fix line suggests loading the data with it instead, since it ignores late responses for you. There is no quick fix.

## What it does not catch

- An effect with an empty dependency list, or whose dependencies all keep their identity between renders: it runs once, so no newer request can be overtaken. Setters and \`dispatch\` from React, react-redux's \`dispatch\`, react-router's \`navigate\`, RTK Query's triggers and \`refetch\`, and the values of the hooks named in \`stableHooks\` (functions or objects, such as a store read from context: \`stableHooks: ["useStores"]\`; the setting of \`react/dependency-changes-every-render\`, read here too) keep their identity; the message never names one of them as the input that changed.
- A request started in a function the effect calls but does not declare.
- A cleanup that sets a flag the write does not check: any assignment in the cleanup counts as a guard.
- A write after \`if (…) return;\` whose test reads a ref (\`if (request !== latest.current) return;\`, or a function of the effect that does, \`if (isStale()) return;\`), or an update that keeps the previous state in one branch (\`setLib((prev) => (prev.api === api ? next : prev))\`): the code already drops a late response.

## Turn it on or off

Turn it on in \`stateward.config.ts\`:

\`\`\`ts
addons: ["react/effect-race"]
\`\`\`

Then change or turn off the rule itself:

\`\`\`ts
rules: { "react/effect-response-race": "off" } // or "error"
groups: { "react/effects": "off" } // the whole group
rules: { "react/effect-response-race": ["warning", { notRequests: ["sleep", "delay"] }] } // awaited calls that are not requests
\`\`\`
`;

const LATE_CALLBACKS: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

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

/** A state set after a response arrives, and the request it waits for. */
type LateWrite = { node: ts.Node; setter: string; request: ts.Expression };

/** The `.then(…)` call a node is an argument of, or inside an argument of. */
function lateCallback(node: ts.Node, effect: Effect): ts.CallExpression | undefined {
  for (let current = node; current !== effect.callback; current = current.parent) {
    const parent = current.parent;
    if (
      ts.isCallExpression(parent) &&
      parent.arguments.some((argument) => argument === current) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      LATE_CALLBACKS.has(parent.expression.name.text)
    ) {
      return parent;
    }
  }
  return undefined;
}

/** The first `await` in the same function before a node, not inside another function. */
function awaitBefore(node: ts.Node): ts.AwaitExpression | undefined {
  const fn = enclosingFunction(node);
  if (fn === undefined) return undefined;
  let found: ts.AwaitExpression | undefined;
  const visit = (current: ts.Node): void => {
    if (found !== undefined || current.pos >= node.pos) return;
    if (ts.isAwaitExpression(current) && current.end <= node.pos) {
      found = current;
      return;
    }
    if (!isFunctionNode(current)) ts.forEachChild(current, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/** The call a `.then` chain starts from: `fetchUser(id)` in `fetchUser(id).then(…).then(…)`. */
function chainRoot(call: ts.CallExpression): ts.Expression {
  let current: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
    const next: ts.Expression = current.expression;
    if (
      ts.isCallExpression(current) &&
      !(
        ts.isPropertyAccessExpression(current.expression) &&
        LATE_CALLBACKS.has(current.expression.name.text)
      )
    ) {
      return current;
    }
    current = next;
  }
  return current;
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

function lateWrite(types: TypeQueries, node: ts.Node, effect: Effect): LateWrite | undefined {
  const set = setterCall(types, node);
  // `.then(setUser)` passes the setter itself.
  const passed =
    ts.isIdentifier(node) &&
    ts.isCallExpression(node.parent) &&
    node.parent.arguments.some((argument) => argument === node) &&
    bindingOf(types, node)?.part === "setter"
      ? node.text
      : undefined;
  const setter = set !== undefined ? set.binding.setter : passed;
  if (setter === undefined) return undefined;
  const then = lateCallback(node, effect);
  if (then !== undefined) return { node, setter, request: chainRoot(then) };
  const awaited = awaitBefore(node);
  return awaited === undefined ? undefined : { node, setter, request: awaited.expression };
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

export const effectResponseRace = defineRule({
  kind: "file",
  meta: {
    description:
      "An effect that loads data ignores a response that arrives after its inputs have changed.",
    defaultSeverity: "warning",
    tier: "addon",
    addon: "effect-race",
    group: "effects",
    heuristic: true,
    options: {
      notRequests: option.strings({
        default: [],
        description:
          "Awaited calls that are not requests, so a late answer cannot happen (sleep, delay, wait*; globs on the name as called).",
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
      if (effect.deps === "unreadable" || (effect.deps !== "none" && effect.deps.every(stable))) {
        continue;
      }
      let write: LateWrite | undefined;
      const visit = (node: ts.Node): void => {
        if (write !== undefined) return;
        const found = lateWrite(types, node, effect);
        if (found !== undefined && checkedAtWrite(found.node, effect)) return;
        write = found;
        if (write === undefined) ts.forEachChild(node, visit);
      };
      ts.forEachChild(effect.callback, visit);
      if (write === undefined) continue;
      const late: LateWrite = write;
      const request = unwrappedCall(late.request);
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
          message: "stateward cannot tell whether this effect's cleanup stops a late response",
          hint: "return the cleanup as a function written in the effect (`return () => { ignore = true; }`) to make it checkable",
          node: late.node,
        });
        continue;
      }
      const input = changingInput(effect, late.request, sourceFile, stable);
      ctx.report({
        message: fitted((cut) =>
          input === undefined
            ? "a slow response from an earlier render can overwrite a newer one"
            : `a slow response for an old \`${cut.name(input)}\` can overwrite a newer one`,
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
        related: [{ node: late.request, message: "the request that can answer late" }],
      });
    }
  },
});
