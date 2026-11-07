import ts from "@stateward/core/typescript";
import { defineRule, option } from "@stateward/core";
import type { Fix, TypeQueries } from "@stateward/core";
import {
  bindingOf,
  effectsIn,
  isFunctionNode,
  isRead,
  setterCall,
  textOf,
  type Effect,
  type StateBinding,
} from "./effects.js";
import { reactName, calleeName, unwrapped } from "./react.js";
import { fitted } from "./text.js";

const EXPLAIN = `# react/closure-reads-stale-state

A timer or listener created in an earlier render reads the state of that render; setting state from it overwrites newer values, which an updater avoids.

\`\`\`tsx example-bad
import { useEffect, useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <p>{count}</p>;
}
\`\`\`

Pass an updater function, which React calls with the latest value:

\`\`\`tsx example-good
import { useEffect, useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <p>{count}</p>;
}
\`\`\`

The quick fix writes it for you. \`check --fix\` does not apply it, because the callback can read other values from the old render too, which only you can judge.

## Why it matters

The interval keeps the function it was given for as long as it runs, and that function read \`count\` once, from the first render. \`count\` is 0 every time the interval fires, so it sets 1 again and again and the counter stops at 1. The same happens to a chat listener that does \`setMessages([...messages, message])\`: every message replaces the list with the first render's messages plus one. Nothing fails at run time, and the code reads correctly.

## When it says “not checked”

When the effect's or callback's dependencies are not written as an array in the call, which render's value the function keeps is not known, and the rule lists the place as not checked. Write the array in the call.

## What it does not catch

It reports a setter called with an expression that reads its own state (\`setCount(count + 1)\`, \`setItems([...items, item])\`, \`setFilters({ ...filters, page })\`), inside a function that outlives its render: the callback of \`setInterval\` or \`setTimeout\` started in an effect whose dependencies do not list the state (or an interval started anywhere else); a listener added in such an effect with \`addEventListener\`, \`on\`, \`once\`, \`subscribe\` or \`addListener\`; or a \`useCallback\` whose dependencies do not list the state. It is silent on:

- a plain event handler written in JSX (\`onClick={() => setCount(count + 1)}\`): React makes a new one on every render;
- a \`setTimeout\` started in an event handler: it runs once, soon after the click;
- a value computed first and set after (\`const next = count + 1; setCount(next)\`);
- a setter that reads the state inside an updater function (\`setCount((c) => c + count)\`);
- a state set after an \`await\` in an effect: a late response is the case of the \`react/effect-response-race\` add-on;
- a timer or listener started in a function the effect only calls.

It stays on with the React Compiler: the compiler memoizes values, but it does not change which render's value a timer or listener keeps.

## Turn it on or off

\`\`\`ts
rules: { "react/closure-reads-stale-state": "off" } // or "error"
rules: { "react/closure-reads-stale-state": ["warning", { listenerMethods: ["addEventListener", "on", "listen"] }] } // your event bus
\`\`\`
`;

const OPTIONS = {
  listenerMethods: option.strings({
    default: ["addEventListener", "on", "once", "subscribe", "addListener"],
    description:
      "Methods that keep a function to call later, like a listener (add your event bus's `listen`…).",
  }),
};

type Kind = "interval" | "timeout" | "listener" | "callback";

/** What keeps a function alive after its render, and which render's values it holds. */
type Holder = {
  kind: Kind;
  /** The dependencies that decide whether it is made again: the effect's or the callback's. */
  deps: readonly ts.Expression[] | "none" | "unreadable" | "outside";
};

/** What a call registers: `setInterval(…)`, `window.setTimeout(…)`, `socket.on(…)`; else undefined. */
function registrar(call: ts.CallExpression, listeners: readonly string[]): Kind | undefined {
  const callee = unwrapped(call.expression);
  if (ts.isIdentifier(callee)) {
    if (callee.text === "setInterval") return "interval";
    return callee.text === "setTimeout" ? "timeout" : undefined;
  }
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const owner = unwrapped(callee.expression);
  const global = ts.isIdentifier(owner) && ["window", "globalThis", "self"].includes(owner.text);
  if (global && callee.name.text === "setInterval") return "interval";
  if (global && callee.name.text === "setTimeout") return "timeout";
  return listeners.includes(callee.name.text) ? "listener" : undefined;
}

/** The call that receives a function: directly as an argument, or by the name it was declared with. */
function receiver(
  types: TypeQueries,
  fn: ts.SignatureDeclaration,
  owner: ts.Node,
  listeners: readonly string[],
): ts.CallExpression | undefined {
  let parent = fn.parent;
  while (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) parent = parent.parent;
  if (ts.isCallExpression(parent) && parent.arguments.some((a) => unwrapped(a) === fn)) {
    return parent;
  }
  const name = ts.isFunctionDeclaration(fn)
    ? fn.name
    : ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
      ? parent.name
      : undefined;
  const id = name === undefined ? undefined : types.symbolAt(name)?.id;
  if (id === undefined) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      (registrar(node, listeners) !== undefined || isUseCallback(types, node)) &&
      node.arguments.some((argument) => {
        const value = unwrapped(argument);
        return ts.isIdentifier(value) && types.symbolAt(value)?.id === id;
      })
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return found;
}

function isUseCallback(types: TypeQueries, call: ts.CallExpression): boolean {
  return reactName(types, calleeName(call.expression)) === "useCallback";
}

/** The function that keeps a set alive, if any, innermost first. */
function holderOf(
  types: TypeQueries,
  call: ts.CallExpression,
  effects: readonly Effect[],
  listeners: readonly string[],
): Holder | undefined {
  let owner: ts.Node = call;
  for (let current = call.parent; !ts.isSourceFile(current); current = current.parent) {
    if (isFunctionNode(current)) owner = current;
  }
  for (let current = call.parent; !ts.isSourceFile(current); current = current.parent) {
    if (!isFunctionNode(current)) continue;
    const through = receiver(types, current, owner, listeners);
    if (through === undefined) continue;
    if (isUseCallback(types, through)) {
      const list = through.arguments[1];
      const deps = list === undefined ? "none" : unwrapped(list);
      return {
        kind: "callback",
        deps:
          deps === "none"
            ? "none"
            : ts.isArrayLiteralExpression(deps)
              ? [...deps.elements]
              : "unreadable",
      };
    }
    const kind = registrar(through, listeners);
    if (kind === undefined) continue;
    const effect = effects.find(
      (candidate) => through.pos >= candidate.callback.pos && through.end <= candidate.callback.end,
    );
    if (effect !== undefined) return { kind, deps: effect.deps };
    return kind === "interval" ? { kind, deps: "outside" } : undefined;
  }
  return undefined;
}

/** Whether the state is one of the dependencies. */
function listsState(types: TypeQueries, deps: readonly ts.Expression[], binding: StateBinding) {
  return deps.some((dep) => {
    const node = unwrapped(dep);
    const found = ts.isIdentifier(node) ? bindingOf(types, node) : undefined;
    return found?.part === "state" && found.binding.call === binding.call;
  });
}

/** Whether an expression reads the state itself (not through an updater's parameter). */
function readsState(types: TypeQueries, argument: ts.Expression, binding: StateBinding): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && isRead(node)) {
      if (ts.isShorthandPropertyAssignment(node.parent)) {
        found = node.text === binding.state;
      } else {
        const bound = bindingOf(types, node);
        found = bound?.part === "state" && bound.binding.call === binding.call;
      }
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(argument);
  return found;
}

/** The number a `count + 1` sets while the state still holds its initial value, if it is plain. */
function setsAlways(argument: ts.Expression, binding: StateBinding): number | undefined {
  const value = unwrapped(argument);
  if (!ts.isBinaryExpression(value) || binding.initial === undefined) return undefined;
  const operator = value.operatorToken.kind;
  if (operator !== ts.SyntaxKind.PlusToken && operator !== ts.SyntaxKind.MinusToken) {
    return undefined;
  }
  const number = (node: ts.Expression): number | undefined => {
    const inner = unwrapped(node);
    if (ts.isNumericLiteral(inner)) return Number(inner.text);
    if (
      ts.isPrefixUnaryExpression(inner) &&
      inner.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(inner.operand)
    ) {
      return -Number(inner.operand.text);
    }
    return undefined;
  };
  const left = unwrapped(value.left);
  const start = number(binding.initial);
  const step = number(value.right);
  if (
    !ts.isIdentifier(left) ||
    left.text !== binding.state ||
    start === undefined ||
    step === undefined
  ) {
    return undefined;
  }
  return operator === ts.SyntaxKind.PlusToken ? start + step : start - step;
}

const NOUN: Readonly<Record<Kind, string>> = {
  interval: "the interval",
  timeout: "the timeout",
  listener: "the listener",
  callback: "the callback",
};

function whenOf(holder: Holder): string {
  if (holder.deps === "outside") return "when the interval started";
  return Array.isArray(holder.deps) && holder.deps.length === 0
    ? "the first render"
    : "an earlier render";
}

function updaterFix(
  file: string,
  argument: ts.Expression,
  binding: StateBinding,
  sourceFile: ts.SourceFile,
): Fix {
  const text = argument.getText(sourceFile);
  const body = ts.isObjectLiteralExpression(unwrapped(argument)) ? `(${text})` : text;
  return {
    title: `Pass an updater: ${binding.setter}((${binding.state}) => …)`,
    edits: [
      {
        location: { file, start: argument.getStart(sourceFile), end: argument.end },
        newText: `(${binding.state}) => ${body}`,
      },
    ],
  };
}

export const closureReadsStaleState = defineRule({
  kind: "file",
  meta: {
    description:
      "A timer or listener created in an earlier render reads the state of that render; setting state from it overwrites newer values, which an updater avoids.",
    summary: "a timer, listener or callback that sets state from a value captured in an old render",
    defaultSeverity: "warning",
    tier: "core",
    group: "state",
    needsTypes: { library: "React", modules: ["react"] },
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const { sourceFile, types } = ctx;
    const effects = effectsIn(types, sourceFile);
    const visit = (node: ts.Node): void => {
      const set = setterCall(types, node);
      const argument = set?.call.arguments[0];
      if (set !== undefined && argument !== undefined) {
        const { binding, call } = set;
        const value = unwrapped(argument);
        const holder =
          ts.isArrowFunction(value) || ts.isFunctionExpression(value) || ts.isIdentifier(value)
            ? undefined
            : readsState(types, argument, binding)
              ? holderOf(types, call, effects, ctx.options.listenerMethods)
              : undefined;
        if (holder !== undefined && holder.deps !== "none") {
          if (holder.deps === "unreadable") {
            ctx.unknown({
              message: fitted(
                (cut) =>
                  `not checked: whether \`${cut.name(binding.state)}\` is a value from an old render: the call has no dependency array to read`,
              ),
              hint: `write the dependency array in the call (\`[${binding.state}]\`), so it can be checked`,
              node: call,
            });
          } else if (holder.deps === "outside" || !listsState(types, holder.deps, binding)) {
            const always = setsAlways(argument, binding);
            const { state, setter } = binding;
            const shown = textOf(argument, sourceFile);
            const body = ts.isObjectLiteralExpression(unwrapped(argument)) ? `(${shown})` : shown;
            const code = `${setter}((${state}) => ${body})`;
            ctx.report({
              message: fitted((cut) =>
                always === undefined
                  ? `${NOUN[holder.kind]} reads a stale \`${cut.name(state)}\`: the value from ${whenOf(holder)}`
                  : `${NOUN[holder.kind]} always sets ${String(always)}: \`${cut.name(state)}\` is the value from ${whenOf(holder)}`,
              ),
              hint: fitted((cut) =>
                code.length <= 60
                  ? `pass an updater, which gets the latest value: \`${code}\` (quick fix)`
                  : `pass an updater, which gets the latest value: \`${cut.name(setter)}((${cut.name(state)}) => …)\` (quick fix)`,
              ),
              node: call,
              fixes: [updaterFix(ctx.file, argument, binding, sourceFile)],
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  },
});
