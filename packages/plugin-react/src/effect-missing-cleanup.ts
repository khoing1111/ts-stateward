import ts from "@stateward/core/typescript";
import {
  defineRule,
  describeRelease,
  option,
  releaseCandidates,
  releaseTraitOf,
} from "@stateward/core";
import type {
  FileContext,
  OptionsOf,
  ReleaseCandidate,
  ReleaseTrait,
  TypeQueries,
} from "@stateward/core";
import {
  cleanupCalls,
  cleanupsOf,
  declarationNode,
  effectsIn,
  forEachOwn,
  setterCall,
  textOf,
  within,
  type Effect,
} from "./effects.js";
import { globalCallName, isPlatform, unwrapped } from "./react.js";
import { fitted } from "./text.js";

const EXPLAIN = `# react/effect-missing-cleanup

A listener, timer or subscription that an effect starts and never stops keeps running after unmount, and each run of the effect adds another one.

\`\`\`tsx example-bad
import { useEffect, useState } from "react";

export function WindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    window.addEventListener("resize", () => setWidth(window.innerWidth));
  }, []);
  return <p>{width}px</p>;
}
\`\`\`

Keep what the effect starts in a variable, and return a function that stops it:

\`\`\`tsx example-good
import { useEffect, useState } from "react";

export function WindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return <p>{width}px</p>;
}
\`\`\`

The same goes for a timer id, an unsubscribe function or an observer. There is no quick fix.

## Why it matters

React runs an effect's cleanup before it runs the effect again and when the component goes away. Without one, what the effect started keeps going: the listener above keeps calling \`setWidth\` after the component is gone, and an effect with dependencies adds one more on every run; an interval keeps ticking; a chat subscription keeps delivering messages to a closed screen. In development, React's Strict Mode runs every effect twice, so a missing cleanup shows as every event handled twice.

## When it says “not checked”

A cleanup that calls a function declared outside the effect with what was started (\`return () => stopAll(id)\`) is listed as not checked, since stateward cannot see that function's body. Stop it in the cleanup itself.

## What it does not catch

It looks for these, each with what undoes it in a returned cleanup:

- a value whose release trait is stated: a \`Disposable\` type, the \`Release<T>\` marker, a \`facts\` line (\`returns: "release"\`) or the facts the ownership pack ships (Firebase \`onSnapshot\`, RxJS, Redux and zustand \`subscribe\`). It is found whatever the function is called, and the note says where the trait comes from: calling it, its stated method or \`[Symbol.dispose]()\` undoes it. Node's own \`Disposable\` types (child processes, streams, timers) state nothing. The names below are the guess for everything else;
- \`addEventListener(type, handler)\`: \`removeEventListener\` with the same target, type and handler variable, or aborting the \`signal\` passed in its options. A handler written inline cannot be removed, since the cleanup cannot name the same function;
- \`setInterval(…)\`: \`clearInterval\` on the stored id;
- \`setTimeout(…)\`: \`clearTimeout\` on the stored id; reported only when the timeout sets state, or the effect runs more than once (it has dependencies, or no list);
- a timer kept in a ref that the effect clears itself before it starts the next one (a debounce): only unmount is missing, and the fix is an effect of its own, \`useEffect(() => () => clearTimeout(timer.current), [])\`;
- \`subscribe(…)\` or \`.on(…)\` that returns an unsubscribe function (call it, or return the call itself) or a subscription object (its \`unsubscribe()\`), or the emitter's own way with the same arguments: \`bus.off(event, handler)\` for \`bus.on(event, handler)\`, \`removeListener\` for \`addListener\`;
- \`new ResizeObserver\`, \`IntersectionObserver\` or \`MutationObserver\`: \`disconnect()\`;
- \`new WebSocket\` or \`EventSource\`: \`close()\`.

Something kept in a ref or a variable outside the effect may also be stopped by another effect of the same component with an empty dependency list (its cleanup runs on unmount), when this effect runs once or clears the previous one itself. A value created only on some paths (\`supported ? new ResizeObserver(…) : undefined\`) and stopped through \`?.\` counts as stopped. It is silent on:

- something started in a function the effect calls, or in a callback it passes on (\`.then(() => addEventListener(…))\`);
- an \`.on(…)\` that returns the emitter itself rather than an unsubscribe (Node's \`EventEmitter\`): undone by \`.off\`, which this rule does not check;
- libraries' own resources (a map, a chart) other than the ones above; the options add classes and methods to the lists, or leave \`setTimeout\` out.

It stays on with the React Compiler, which does not add cleanups.

## Turn it on or off

\`\`\`ts
rules: { "react/effect-missing-cleanup": "off" } // or "error"
rules: { "react/effect-missing-cleanup": ["warning", { severities: { "inline-handler": "error" } }] } // an inline listener is always a bug
\`\`\`
`;

const OPTIONS = {
  observers: option.strings({
    default: ["ResizeObserver", "IntersectionObserver", "MutationObserver"],
    description:
      "Built-in classes whose instance is stopped with `disconnect()` (add PerformanceObserver…).",
  }),
  connections: option.strings({
    default: ["WebSocket", "EventSource"],
    description:
      "Built-in classes whose instance is stopped with `close()` (add BroadcastChannel…).",
  }),
  subscribeMethods: option.strings({
    default: ["subscribe", "on"],
    description:
      "Methods that start a subscription and return a way to stop it (an unsubscribe function or object).",
  }),
  timeouts: option.boolean({
    default: true,
    description: "Check `setTimeout` too; false checks only intervals, listeners and the rest.",
  }),
  severities: option.severities({
    kinds: {
      "inline-handler":
        "a listener written inline: no cleanup can remove it, even one you add later.",
      "missing-cleanup": "something the effect starts and no cleanup stops.",
    },
    description: "A severity per kind of finding.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

/**
 * Where an effect keeps what it started. `shared` when it outlives the run: a ref or another name
 * declared outside the effect, which a cleanup in another effect can also reach.
 */
type Stored = { text: string; shared: boolean } | undefined;

/** What an effect starts that its cleanup has to stop. */
type Started =
  | {
      kind: "listener";
      node: ts.CallExpression;
      target: string;
      type: string;
      handler: string;
      inline: boolean;
      signal: boolean;
    }
  | {
      kind: "interval" | "timeout";
      node: ts.CallExpression;
      stored: Stored;
      /** The effect clears the previous timer itself before it starts the next (a debounce). */
      refManaged: boolean;
    }
  | {
      kind: "subscription";
      node: ts.CallExpression | ts.NewExpression;
      call: string;
      stored: Stored;
      returns: "function" | "object";
      /** How an object is released: `unsubscribe`, or the method the release trait states. */
      method: string;
      /** The release trait, when it is stated: the finding is then certain, and its note says why. */
      trait: ReleaseTrait | undefined;
    }
  | {
      kind: "observer" | "connection";
      node: ts.NewExpression;
      constructor: string;
      stored: Stored;
    };

/** Whether `node` is one of the values an expression can produce (`a` or `b` in `c ? a : b`, `x ?? a`). */
function isBranchOf(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isConditionalExpression(parent)) return parent.condition !== node;
  if (!ts.isBinaryExpression(parent)) return false;
  const operator = parent.operatorToken.kind;
  if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return parent.right === node;
  return operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken;
}

/**
 * Where the result of an expression is kept: `id` in `const id = …`, `timer.current` in
 * `timer.current = …`, `observer` in `const observer = supported ? new ResizeObserver(…) : undefined`.
 */
function storedIn(
  types: TypeQueries,
  node: ts.Expression,
  effect: Effect,
  sourceFile: ts.SourceFile,
): Stored {
  let current: ts.Node = node;
  while (
    ts.isParenthesizedExpression(current.parent) ||
    ts.isAsExpression(current.parent) ||
    ts.isNonNullExpression(current.parent) ||
    isBranchOf(current, current.parent)
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
    return ts.isIdentifier(parent.name)
      ? { text: parent.name.text, shared: !within(parent, effect.callback) }
      : undefined;
  }
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === current
  ) {
    let root: ts.Expression = parent.left;
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) {
      root = root.expression;
    }
    const declaration = ts.isIdentifier(root) ? declarationNode(types, root) : undefined;
    return {
      text: textOf(parent.left, sourceFile),
      shared: declaration !== undefined && !within(declaration, effect.callback),
    };
  }
  return undefined;
}

const CLEARS: readonly string[] = [
  "clearInterval",
  "clearTimeout",
  "window.clearInterval",
  "window.clearTimeout",
];

/** Whether the effect clears `stored` itself before it starts the timer at `start`. */
function clearedBefore(
  effect: Effect,
  start: ts.CallExpression,
  stored: Stored,
  sourceFile: ts.SourceFile,
): boolean {
  if (stored === undefined) return false;
  let found = false;
  forEachOwn(effect.callback, (node) => {
    if (found || !ts.isCallExpression(node) || node.end > start.pos) return;
    const part = callParts(node, sourceFile);
    found = CLEARS.includes(part.callee) && part.args[0] === stored.text;
  });
  return found;
}

/** Whether a timeout's callback sets state (directly, or through a setter passed as the callback). */
function setsState(types: TypeQueries, call: ts.CallExpression): boolean {
  const first = call.arguments[0];
  if (first === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (setterCall(types, node) !== undefined) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(first);
  return found;
}

/**
 * Node's types add `[Symbol.dispose]` to child processes, streams and timers, which end by
 * themselves: their `Disposable` type states no release.
 */
const PLATFORM: readonly string[] = ["@types/node"];

/** The method that releases a value with the release trait: none for a function. */
function releaseMethod(trait: ReleaseTrait): string | undefined {
  switch (trait.way.kind) {
    case "call":
      return undefined;
    case "method":
      return trait.way.name;
    case "dispose":
      return trait.way.async ? "[Symbol.asyncDispose]" : "[Symbol.dispose]";
  }
}

/** What an effect starts whose release trait is stated (a type, a marker, a `facts` line). */
function startedWithTrait(
  ctx: FileContext<Settings>,
  node: ts.Node,
  effect: Effect,
  candidate: ReleaseCandidate,
): Started | undefined {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return undefined;
  if (!candidate(node)) return undefined;
  const trait = releaseTraitOf(node, ctx, { platformPackages: PLATFORM });
  if (trait === undefined) return undefined;
  const method = releaseMethod(trait);
  return {
    kind: "subscription",
    node,
    call: `${ts.isNewExpression(node) ? "new " : ""}${textOf(unwrapped(node.expression), ctx.sourceFile)}(…)`,
    stored: storedIn(ctx.types, node, effect, ctx.sourceFile),
    returns: method === undefined ? "function" : "object",
    method: method ?? "unsubscribe",
    trait,
  };
}

function startedBy(
  types: TypeQueries,
  node: ts.Node,
  effect: Effect,
  sourceFile: ts.SourceFile,
  settings: Settings,
): Started | undefined {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    const kind = settings.observers.includes(name)
      ? "observer"
      : settings.connections.includes(name)
        ? "connection"
        : undefined;
    if (kind === undefined || !isPlatform(types, node.expression)) return undefined;
    return { kind, node, constructor: name, stored: storedIn(types, node, effect, sourceFile) };
  }
  if (!ts.isCallExpression(node)) return undefined;
  const callee = unwrapped(node.expression);
  const global = globalCallName(types, node);
  if (global === "setInterval" || (global === "setTimeout" && settings.timeouts)) {
    if (global === "setTimeout") {
      const reruns =
        effect.deps !== "unreadable" && (effect.deps === "none" || effect.deps.length > 0);
      if (!reruns && !setsState(types, node)) return undefined;
    }
    const stored = storedIn(types, node, effect, sourceFile);
    return {
      kind: global === "setInterval" ? "interval" : "timeout",
      node,
      stored,
      refManaged: clearedBefore(effect, node, stored, sourceFile),
    };
  }
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "addEventListener") {
    const [type, handler, options] = node.arguments;
    if (type === undefined || handler === undefined) return undefined;
    const inner = unwrapped(handler);
    const settings = options === undefined ? undefined : unwrapped(options);
    const signal =
      settings !== undefined &&
      ts.isObjectLiteralExpression(settings) &&
      settings.properties.some(
        (property) =>
          property.name !== undefined &&
          ts.isIdentifier(property.name) &&
          property.name.text === "signal",
      );
    return {
      kind: "listener",
      node,
      target: textOf(callee.expression, sourceFile),
      type: ts.isStringLiteralLike(type) ? type.text : textOf(type, sourceFile),
      handler: textOf(handler, sourceFile),
      inline: ts.isArrowFunction(inner) || ts.isFunctionExpression(inner),
      signal,
    };
  }
  const method = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  if (method === undefined || !settings.subscribeMethods.includes(method)) return undefined;
  if (ts.isIdentifier(callee) && method !== "subscribe") return undefined;
  const returns = types.isCallable(node)
    ? "function"
    : types.hasDefinedProperty(node, "unsubscribe")
      ? "object"
      : undefined;
  if (returns === undefined) return undefined;
  return {
    kind: "subscription",
    node,
    call: `${textOf(callee, sourceFile)}(…)`,
    stored: storedIn(types, node, effect, sourceFile),
    returns,
    method: "unsubscribe",
    trait: undefined,
  };
}

/**
 * Methods that start a subscription, and the methods of the same object that end it when called
 * with the same arguments (an event emitter's `on` and `off`).
 */
const UNDONE_BY: ReadonlyMap<string, readonly string[]> = new Map([
  ["on", ["off", "removeListener"]],
  ["addListener", ["removeListener", "off"]],
  ["subscribe", ["unsubscribe"]],
]);

/** The parts of a cleanup call: `window.removeEventListener` → receiver `window`, name. */
function callParts(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): { receiver: string | undefined; name: string; callee: string; args: string[] } {
  const callee = unwrapped(call.expression);
  // `observer!.disconnect()`, `clearTimeout(id!)`: the `!` and parentheses do not change what is undone.
  const args = call.arguments.map((argument) =>
    ts.isStringLiteralLike(argument) ? argument.text : textOf(unwrapped(argument), sourceFile),
  );
  if (ts.isPropertyAccessExpression(callee)) {
    return {
      receiver: textOf(unwrapped(callee.expression), sourceFile),
      name: callee.name.text,
      callee: textOf(callee, sourceFile),
      args,
    };
  }
  const text = textOf(callee, sourceFile);
  return { receiver: undefined, name: text, callee: text, args };
}

/** Whether the cleanup undoes what the effect started. */
function undone(
  started: Started,
  calls: readonly ts.CallExpression[],
  returned: readonly ts.CallExpression[],
  sourceFile: ts.SourceFile,
): boolean {
  const parts = calls.map((call) => callParts(call, sourceFile));
  const stored = started.kind === "listener" ? undefined : started.stored?.text;
  switch (started.kind) {
    case "listener":
      if (started.signal && parts.some((part) => part.name === "abort")) return true;
      return (
        !started.inline &&
        parts.some(
          (part) =>
            part.name === "removeEventListener" &&
            part.receiver === started.target &&
            part.args[0] === started.type &&
            part.args[1] === started.handler,
        )
      );
    case "interval":
    case "timeout":
      return parts.some((part) => CLEARS.includes(part.callee) && part.args[0] === stored);
    case "subscription": {
      if (returned.some((call) => call === started.node)) return true;
      // `bus.on(event, handler)` undone the emitter's way: `bus.off(event, handler)`.
      if (ts.isCallExpression(started.node)) {
        const start = callParts(started.node, sourceFile);
        const undoers = UNDONE_BY.get(start.name) ?? [];
        if (
          start.receiver !== undefined &&
          start.args.length > 0 &&
          parts.some(
            (part) =>
              part.receiver === start.receiver &&
              undoers.includes(part.name) &&
              part.args.length === start.args.length &&
              part.args.every((arg, i) => arg === start.args[i]),
          )
        ) {
          return true;
        }
      }
      if (stored === undefined) return false;
      return started.returns === "function"
        ? parts.some((part) => part.callee === stored)
        : parts.some(
            (part) =>
              (part.receiver === stored && part.name === started.method) ||
              part.callee === `${stored}${started.method}`,
          );
    }
    case "observer":
      return parts.some(
        (part) =>
          part.receiver === stored && (part.name === "disconnect" || part.name === "unobserve"),
      );
    case "connection":
      return parts.some((part) => part.receiver === stored && part.name === "close");
  }
}

/** Whether a cleanup passes what was started to a function stateward cannot see into. */
function handedOver(
  started: Started,
  calls: readonly ts.CallExpression[],
  sourceFile: ts.SourceFile,
): boolean {
  const names =
    started.kind === "listener"
      ? [started.handler]
      : started.stored === undefined
        ? []
        : [started.stored.text];
  return calls.some((call) =>
    call.arguments.some((argument) => names.includes(textOf(argument, sourceFile))),
  );
}

/** `onResize` for "resize", `onKeyDown` stays `onKeydown`: a handler name for the example. */
function handlerName(type: string): string {
  const word = type.replace(/[^A-Za-z0-9]/g, "");
  return word.length === 0 ? "handler" : `on${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** A short description of what was started, for the not-checked message. */
function described(started: Started): string {
  switch (started.kind) {
    case "listener":
      return `the \`${started.type}\` listener`;
    case "interval":
      return "the interval";
    case "timeout":
      return "the timeout";
    case "subscription":
      return `\`${started.call}\``;
    case "observer":
    case "connection":
      return `the \`${started.constructor}\``;
  }
}

function messageFor(
  types: TypeQueries,
  started: Started,
  hasCleanup: boolean,
): { message: string; hint: string } {
  switch (started.kind) {
    case "listener": {
      const type = JSON.stringify(started.type);
      if (started.inline) {
        const name = handlerName(started.type);
        return {
          message: fitted(
            (cut) =>
              `\`${cut.name(started.type)}\` listener on \`${cut.name(started.target)}\` is an inline function: no cleanup can remove it`,
          ),
          hint: fitted(
            (cut) =>
              `keep the handler in a variable (\`const ${name} = …\`), then \`return () => ${cut.name(started.target)}.removeEventListener(${type}, ${name})\``,
          ),
        };
      }
      return {
        message: fitted(
          (cut) =>
            `effect adds a \`${cut.name(started.type)}\` listener to \`${cut.name(started.target)}\` and never removes it`,
        ),
        hint: fitted(
          (cut) =>
            `remove it in the cleanup: \`return () => ${cut.name(started.target)}.removeEventListener(${type}, ${cut.name(started.handler)})\``,
        ),
      };
    }
    case "interval":
    case "timeout": {
      const clear = started.kind === "interval" ? "clearInterval" : "clearTimeout";
      const start = started.kind === "interval" ? "setInterval" : "setTimeout";
      const stored = started.stored?.text;
      if (started.refManaged && stored !== undefined) {
        // The effect already clears the previous timer before it starts the next one; a cleanup
        // returned here would add nothing but a second clear, so only unmount is missing.
        const what = started.kind === "interval" ? "interval" : "timeout";
        return {
          message: fitted(
            (cut) =>
              `the ${what} in \`${cut.name(stored)}\` is cleared before each new one, but not on unmount`,
          ),
          hint: fitted(
            (cut) =>
              `clear it on unmount, in an effect of its own:\n    useEffect(() => () => ${clear}(${cut.name(stored)}), []);`,
          ),
        };
      }
      const sets = setterCallIn(types, started.node);
      const message =
        started.kind === "interval"
          ? "effect starts an interval and never clears it: it keeps running after unmount"
          : sets === undefined
            ? "effect starts a timeout on every run and never clears it"
            : fitted(
                (cut) =>
                  `effect starts a timeout that sets \`${cut.name(sets)}\` and never clears it`,
              );
      const hint =
        stored === undefined
          ? `keep its id and clear it in the cleanup: \`const id = ${start}(…); return () => ${clear}(id);\``
          : fitted(
              (cut) => `clear it in the cleanup: \`return () => ${clear}(${cut.name(stored)});\``,
            );
      return { message, hint };
    }
    case "subscription":
      if (started.returns === "object") {
        const method = started.method.startsWith("[") ? started.method : `.${started.method}`;
        return {
          message: fitted((cut) =>
            started.trait === undefined
              ? `\`${cut.name(started.call)}\` returns a subscription that the effect never ends`
              : `\`${cut.name(started.call)}\` returns a value that the effect never releases`,
          ),
          hint: fitted(
            (cut) =>
              `end it in the cleanup: \`return () => ${cut.name(started.stored?.text ?? "subscription")}${method}();\``,
          ),
        };
      }
      return {
        message: fitted(
          (cut) =>
            `\`${cut.name(started.call)}\` returns ${started.trait === undefined ? "an unsubscribe" : "a release"} function that the effect never calls`,
        ),
        hint: fitted((cut) =>
          started.stored !== undefined
            ? `call it in the cleanup: \`return () => ${cut.name(started.stored.text)}();\``
            : hasCleanup
              ? `keep it (\`const unsubscribe = ${cut.name(started.call)}\`) and call it in the cleanup: \`unsubscribe();\``
              : `return it as the cleanup: \`return ${cut.name(started.call)};\``,
        ),
      };
    case "observer":
      return {
        message: fitted(
          (cut) => `effect creates a \`${cut.name(started.constructor)}\` and never disconnects it`,
        ),
        hint: fitted((cut) =>
          started.stored === undefined
            ? `keep it (\`const observer = new ${cut.name(started.constructor)}(…)\`) and \`return () => observer.disconnect();\``
            : `disconnect it in the cleanup: \`return () => ${cut.name(started.stored.text)}.disconnect();\``,
        ),
      };
    case "connection":
      return {
        message: fitted(
          (cut) => `effect opens a \`${cut.name(started.constructor)}\` and never closes it`,
        ),
        hint: fitted((cut) =>
          started.stored === undefined
            ? `keep it (\`const connection = new ${cut.name(started.constructor)}(…)\`) and \`return () => connection.close();\``
            : `close it in the cleanup: \`return () => ${cut.name(started.stored.text)}.close();\``,
        ),
      };
  }
}

/** The state a timeout's callback sets, by name, or undefined. */
function setterCallIn(types: TypeQueries, call: ts.CallExpression): string | undefined {
  let state: string | undefined;
  const visit = (node: ts.Node): void => {
    if (state !== undefined) return;
    const set = setterCall(types, node);
    if (set !== undefined) {
      state = set.binding.state;
      return;
    }
    ts.forEachChild(node, visit);
  };
  const first = call.arguments[0];
  if (first !== undefined) visit(first);
  return state;
}

/**
 * The calls made on unmount by the other effects of the same component: the cleanups of effects
 * with an empty dependency list, which run once, when the component goes away.
 */
function unmountCalls(
  types: TypeQueries,
  effect: Effect,
  all: readonly Effect[],
): ts.CallExpression[] {
  return all
    .filter(
      (other) =>
        other !== effect &&
        other.owner === effect.owner &&
        other.deps !== "none" &&
        other.deps !== "unreadable" &&
        other.deps.length === 0,
    )
    .flatMap((other) => cleanupCalls(types, other, cleanupsOf(types, other)));
}

function checkEffect(
  ctx: FileContext<Settings>,
  effect: Effect,
  all: readonly Effect[],
  candidate: ReleaseCandidate,
): void {
  const { sourceFile, types } = ctx;
  const started: Started[] = [];
  forEachOwn(effect.callback, (node) => {
    // A stated release trait is certain; the names below are the guess for the rest.
    const found =
      startedWithTrait(ctx, node, effect, candidate) ??
      startedBy(types, node, effect, sourceFile, ctx.options);
    if (found !== undefined) started.push(found);
  });
  if (started.length === 0) return;
  const cleanups = cleanupsOf(types, effect);
  const calls = cleanupCalls(types, effect, cleanups);
  const hasCleanup = cleanups.functions.length > 0 || cleanups.returnedCalls.length > 0;
  const onUnmount = unmountCalls(types, effect, all);
  for (const each of started) {
    if (undone(each, calls, cleanups.returnedCalls, sourceFile)) continue;
    // Another effect's unmount cleanup stops only the last one started; that is enough when this
    // effect runs once, or clears the previous one itself before starting the next.
    const once = effect.deps !== "none" && effect.deps !== "unreadable" && effect.deps.length === 0;
    if (
      each.kind !== "listener" &&
      each.stored?.shared === true &&
      (once || ((each.kind === "timeout" || each.kind === "interval") && each.refManaged)) &&
      undone(each, onUnmount, [], sourceFile)
    ) {
      continue;
    }
    if (cleanups.unreadable || handedOver(each, calls, sourceFile)) {
      ctx.unknown({
        message: fitted(
          (cut) =>
            `not checked: whether the cleanup stops ${cut.name(described(each))}: the cleanup is not written in the effect`,
        ),
        hint: "undo it in the returned function itself (`removeEventListener`, `clearInterval`, `disconnect`, …), so it can be checked",
        node: each.node,
      });
      continue;
    }
    const trait = each.kind === "subscription" ? each.trait : undefined;
    ctx.report({
      ...messageFor(types, each, hasCleanup),
      node: each.node,
      findingKind: each.kind === "listener" && each.inline ? "inline-handler" : "missing-cleanup",
      related: trait === undefined ? [] : [{ node: each.node, message: describeRelease(trait) }],
    });
  }
}

export const effectMissingCleanup = defineRule({
  kind: "file",
  meta: {
    description:
      "A listener, timer or subscription that an effect starts and never stops keeps running after unmount, and each run of the effect adds another one.",
    summary:
      "an effect that starts a listener, timer, subscription or connection and never stops it",
    defaultSeverity: "warning",
    tier: "core",
    group: "effects",
    needsTypes: { library: "React", modules: ["react"] },
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const effects = effectsIn(ctx.types, ctx.sourceFile);
    if (effects.length === 0) return;
    // Most calls cannot have the release trait: the syntax rules them out before any type question.
    const candidate = releaseCandidates(ctx);
    for (const effect of effects) checkEffect(ctx, effect, effects, candidate);
  },
});
