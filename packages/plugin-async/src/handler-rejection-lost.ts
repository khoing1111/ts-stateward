import ts from "@stateward/core/typescript";
import {
  defineRule,
  matchesName,
  option,
  type FileContext,
  type OptionsOf,
  type SymbolRef,
} from "@stateward/core";
import {
  functionOfDeclaration,
  hasModifier,
  isBuiltinGlobal,
  scanRunning,
  sameFileFunction,
  stripParentheses,
  pathOf,
} from "./syntax.js";
import { fitted, oneLine, shorten, withExample } from "./text.js";
import { NEVER_REJECTS } from "./rejects.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "failures";

const EXPLAIN = `# async/handler-rejection-lost

No code awaits an event handler or a timer callback, so its failure is an unhandled rejection the user never sees; a \`catch\` inside it can show the error.

\`\`\`tsx example-bad
async function save(): Promise<void> {
  const response = await fetch("/api/save", { method: "POST" });
  if (!response.ok) throw new Error(\`save failed: \${String(response.status)}\`);
}

export function SaveButton() {
  return (
    <button
      onClick={async () => {
        await save();
      }}
    >
      Save
    </button>
  );
}
\`\`\`

Catch the failure in the handler, and show, retry or record it:

\`\`\`tsx example-good
async function save(): Promise<void> {
  const response = await fetch("/api/save", { method: "POST" });
  if (!response.ok) throw new Error(\`save failed: \${String(response.status)}\`);
}

export function SaveButton({ onError }: { onError: (error: unknown) => void }) {
  return (
    <button
      onClick={async () => {
        try {
          await save();
        } catch (error) {
          onError(error);
        }
      }}
    >
      Save
    </button>
  );
}
\`\`\`

There is no quick fix: what to do with the failure is your call. \`await save().catch(onError)\` works too.

## Why it matters

Nothing awaits an \`onClick\`, a listener or a timer callback. When an \`async\` one fails, its promise rejects with no code waiting for it: the console shows an unhandled rejection, the user sees nothing, and whatever the handler was changing is left half done. A Save button whose save fails looks like it did nothing.

## What it does not catch

It reads \`async\` functions written in place as a JSX prop named \`on\` plus a capital letter (\`onClick\`, \`onSubmit\`), the listener of \`addEventListener\`, or the callback of \`setTimeout\`, \`setInterval\` or \`queueMicrotask\` (the \`timers\` option adds more). It reports one that awaits outside a \`try\` with a \`catch\` (an \`await\` in a \`catch\` or \`finally\` block is not protected by that \`try\`), or returns a promise from \`fetch\`, \`Promise.all\` and similar, or from an \`async\` function in the same file. It is silent on:

- a handler passed by name (\`onClick={save}\`), and other callbacks no code awaits: \`.then\` callbacks, \`setImmediate\`, observers, \`useEffect\` callbacks;
- a handler with no \`await\` and no promise the rule recognises;
- a call that catches its own failure (\`await save().catch(onError)\`), or a call to an \`async\` function of the project that catches its own: every \`await\` and \`throw\` in it is inside a \`try\` with a \`catch\` (a \`catch\` that rethrows or awaits again does not count);
- a promise that reports failure in its value instead of rejecting: its type has an \`unwrap()\` method and it resolves to data or an \`error\` (RTK Query's mutation and lazy-query triggers). \`await addTodo(todo).unwrap()\` rejects, and is reported;
- a prop whose type returns a promise (\`onSave: () => Promise<void>\`): the component that declares it awaits it. The same for a prop your component calls only as \`await onSubmit(…)\` inside a \`try\` with a \`catch\`.

## Getting the best from it

Tell stateward which calls never reject, and it stops asking about them:

- a package function: \`facts: { "my-client": { send: { rejects: [] } } }\` in the config;
- your own function that catches and reports its failures: a JSDoc \`@neverRejects\` on the function, on a function type alias, or on the prop in its props type (\`/** Shows its own errors. @neverRejects */ handleSearch: (query: string) => Promise<void>;\`). stateward takes the tag at its word: a function marked this way that does reject is not caught.

## Turn it on or off

Turn it off only if a global \`unhandledrejection\` handler is how you deal with these on purpose:

\`\`\`ts
rules: { "async/handler-rejection-lost": "off" } // or "warning"
rules: { "async/handler-rejection-lost": ["error", { ignoreProps: ["onSubmit"] }] } // a prop your form library awaits
\`\`\`
`;

const OPTIONS = {
  timers: option.strings({
    default: ["setTimeout", "setInterval", "queueMicrotask"],
    description:
      "Functions whose first argument is a callback no code awaits (add requestAnimationFrame, setImmediate…).",
  }),
  ignoreProps: option.strings({
    default: [],
    description:
      "JSX props whose async handler the component awaits itself, like a form library's onSubmit (globs allowed).",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;
/** Objects the timers are also called on: `window.setTimeout`. */
const TIMER_OWNERS: ReadonlySet<string> = new Set(["window", "globalThis", "self"]);
/** `Promise` methods that return a promise that can reject. */
const REJECTING_PROMISES: ReadonlySet<string> = new Set([
  "all",
  "allSettled",
  "race",
  "any",
  "reject",
]);

type Handler = {
  fn: ts.ArrowFunction | ts.FunctionExpression;
  /** How the message names it: the attribute, or the call. */
  name: string;
} & (
  | { role: "handler" }
  /** A listener or callback: the call it is passed to, whose own text the example repeats. */
  | { role: "listener" | "callback"; call: ts.CallExpression }
);

/** Where a handler can fail, and the code that fails there. */
type Failure = {
  node: ts.Node;
  /** `await x` or `return x`: x; `for await (… of x)`: x. */
  kind: "await" | "for-await";
  code: ts.Expression;
};

function asyncFunction(expression: ts.Expression): Handler["fn"] | undefined {
  const node = stripParentheses(expression);
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  if (!hasModifier(node, ts.SyntaxKind.AsyncKeyword)) return undefined;
  return ts.isFunctionExpression(node) && node.asteriskToken !== undefined ? undefined : node;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = stripParentheses(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text === "addEventListener") return callee.name.text;
  const owner = stripParentheses(callee.expression);
  return ts.isIdentifier(owner) && TIMER_OWNERS.has(owner.text) ? callee.name.text : undefined;
}

/**
 * Whether the prop an attribute sets is declared as a function that returns a promise
 * (`onSave: () => Promise<void>`, `onSave?(): Promise<void>`, `onSave: SaveHandler` naming one):
 * the component asks for a promise so that it can await it, so a failure is its to handle.
 */
function awaitedByComponent(fn: Handler["fn"], ctx: FileContext): boolean {
  return ctx.types.expectsPromiseReturn(fn);
}

/** The component a JSX element renders, when it is a function of the project: `SearchForm`. */
function componentOf(
  attribute: ts.JsxAttribute,
  ctx: FileContext,
): ts.SignatureDeclaration | undefined {
  const element = attribute.parent.parent;
  const symbol = ctx.types.symbolAt(element.tagName);
  return symbol === undefined ? undefined : componentNamed(symbol, ctx, 0);
}

/**
 * The function a component's name stands for: declared as one, wrapped in a call
 * (`const SearchForm = memo(function SearchForm(…) { … })`, `forwardRef(…)`), or a wrapped name
 * (`export default observer(ConfirmationDialog)`, outline's dialogs, real-world corpus).
 */
function componentNamed(
  symbol: SymbolRef,
  ctx: FileContext,
  depth: number,
): ts.SignatureDeclaration | undefined {
  const declared = ctx.types.declarationOf(symbol);
  if (declared === undefined || !ctx.types.isOwnFile(declared.file) || depth > 2) return undefined;
  const direct = functionOfDeclaration(declared.node);
  if (direct !== undefined) return direct;
  const value = ts.isVariableDeclaration(declared.node)
    ? declared.node.initializer
    : ts.isExportAssignment(declared.node)
      ? declared.node.expression
      : undefined;
  if (value === undefined) return undefined;
  const call = stripParentheses(value);
  const [first] = ts.isCallExpression(call) ? call.arguments : [];
  const inner = first === undefined ? undefined : stripParentheses(first);
  if (inner === undefined) return undefined;
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return inner;
  const named = ts.isIdentifier(inner) ? ctx.types.symbolAt(inner) : undefined;
  return named === undefined ? undefined : componentNamed(named, ctx, depth + 1);
}

/** Whether `call` calls the prop `name` of `component`: `props.onSubmit(…)` or `onSubmit(…)`. */
function callsProp(
  call: ts.CallExpression,
  name: string,
  props: ts.ParameterDeclaration,
  ctx: FileContext,
): boolean {
  const callee = stripParentheses(call.expression);
  if (ts.isIdentifier(props.name)) {
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === name &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === props.name.text
    );
  }
  if (!ts.isIdentifier(callee)) return false;
  const symbol = ctx.types.symbolAt(callee);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (declared === undefined || !ts.isBindingElement(declared) || declared.parent !== props.name) {
    return false;
  }
  const key = declared.propertyName ?? declared.name;
  return ts.isIdentifier(key) && key.text === name;
}

/**
 * Whether the component the attribute is passed to calls that prop only inside the `try` of a
 * `try` with a `catch`: it handles the failure itself.
 */
function caughtByComponent(attribute: ts.JsxAttribute, ctx: FileContext): boolean {
  const component = componentOf(attribute, ctx);
  const [props] = component?.parameters ?? [];
  if (component === undefined || props === undefined) return false;
  const name = attribute.name.getText();
  let calls = 0;
  let unguarded = false;
  const visit = (node: ts.Node, guarded: boolean): void => {
    if (ts.isCallExpression(node) && callsProp(node, name, props, ctx)) {
      calls += 1;
      // Only an awaited call's rejection reaches the `catch`.
      let parent = node.parent;
      while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
      if (!guarded || !ts.isAwaitExpression(parent)) unguarded = true;
    }
  };
  // Nested functions (the component's own handlers) are read too, each from its own start.
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && "body" in node && node.body !== undefined) {
      scanRunning(node.body, visit);
    }
    ts.forEachChild(node, walk);
  };
  walk(component);
  return calls > 0 && !unguarded;
}

/** The async function this node hands to something that never awaits it, if it does. */
function handlerOf(node: ts.Node, ctx: FileContext<Settings>): Handler | undefined {
  if (ts.isJsxAttribute(node)) {
    const name = node.name;
    if (!ts.isIdentifier(name) || !/^on[A-Z]/.test(name.text)) return undefined;
    if (matchesName(name.text, ctx.options.ignoreProps)) return undefined;
    const value = node.initializer;
    if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) {
      return undefined;
    }
    const fn = asyncFunction(value.expression);
    return fn === undefined || awaitedByComponent(fn, ctx) || caughtByComponent(node, ctx)
      ? undefined
      : { fn, name: name.text, role: "handler" };
  }
  if (!ts.isCallExpression(node)) return undefined;
  const name = calleeName(node);
  if (name === "addEventListener") {
    const [, listener] = node.arguments;
    const fn = listener === undefined ? undefined : asyncFunction(listener);
    return fn === undefined ? undefined : { fn, name, role: "listener", call: node };
  }
  if (name !== undefined && ctx.options.timers.includes(name)) {
    const [callback] = node.arguments;
    const fn = callback === undefined ? undefined : asyncFunction(callback);
    return fn === undefined ? undefined : { fn, name, role: "callback", call: node };
  }
  return undefined;
}

/** A call that returns a promise which can reject: `fetch`, `Promise.all`, a local async function. */
function returnsPromise(expression: ts.Expression, ctx: FileContext): boolean {
  const call = stripParentheses(expression);
  if (!ts.isCallExpression(call)) return false;
  const callee = stripParentheses(call.expression);
  if (ts.isIdentifier(callee) && callee.text === "fetch" && isBuiltinGlobal(callee, ctx)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const owner = stripParentheses(callee.expression);
    if (
      ts.isIdentifier(owner) &&
      owner.text === "Promise" &&
      REJECTING_PROMISES.has(callee.name.text) &&
      isBuiltinGlobal(owner, ctx)
    ) {
      return true;
    }
  }
  const declared = sameFileFunction(callee, ctx);
  return declared !== undefined && hasModifier(declared, ts.SyntaxKind.AsyncKeyword);
}

/**
 * Whether the config's facts say the package function called here never fails: `rejects: []`
 * (and no `throws`). The function is named as the facts name it: its path in the package's
 * types (`Client.send`), or its own name (`send`).
 */
function factsSayNeverRejects(call: ts.CallExpression, ctx: FileContext): boolean {
  const callee = stripParentheses(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol && ctx.types.declarationOf(symbol);
  if (declared === undefined || ctx.types.isOwnFile(declared.file)) return false;
  const packageName = ctx.types.packageOf(declared.file);
  const facts = packageName === undefined ? undefined : ctx.facts[packageName];
  if (facts === undefined) return false;
  const names = pathOf(declared.node);
  const entry = facts[names.join(".")] ?? facts[names.at(-1) ?? ""];
  return entry?.rejects?.length === 0 && (entry.throws ?? []).length === 0;
}

/**
 * A promise that reports failure in its value, not by rejecting: its type has an `unwrap()`
 * method and resolves to data or an error (RTK Query's mutation and lazy-query triggers, item
 * 19), the config's facts say the function never rejects, or the project says so with
 * `@neverRejects` on the function, the prop it is reached through, or its function type.
 */
function neverRejects(expression: ts.Expression, ctx: FileContext): boolean {
  const code = stripParentheses(expression);
  if (ctx.types.settlesWithError(code)) return true;
  return (
    ts.isCallExpression(code) &&
    (factsSayNeverRejects(code, ctx) || ctx.types.calleeTags(code).includes(NEVER_REJECTS))
  );
}

/**
 * A call to a project function that catches its own failures: an `async` function with a block
 * body in which every `await`, `for await`, `throw` and returned call sits inside the `try` of a
 * `try` with a `catch` (its `catch` and `finally` are not, so one that rethrows or awaits again
 * still counts as failing). `const remove = async () => { try { await api.remove(); } catch {} }`.
 */
function calleeCatchesOwnFailures(expression: ts.Expression, ctx: FileContext): boolean {
  const call = stripParentheses(expression);
  if (!ts.isCallExpression(call)) return false;
  const callee = stripParentheses(call.expression);
  const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  if (!ts.isIdentifier(name)) return false;
  const symbol = ctx.types.symbolAt(name);
  const declared = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (declared === undefined || !ctx.types.isOwnFile(declared.file)) return false;
  const fn = functionOfDeclaration(declared.node);
  if (fn?.body === undefined || !ts.isBlock(fn.body)) return false;
  if (!hasModifier(fn, ts.SyntaxKind.AsyncKeyword) || fn.asteriskToken !== undefined) return false;
  let fails = false;
  scanRunning(fn.body, (node, guarded) => {
    if (fails || guarded) return;
    if (ts.isAwaitExpression(node) || ts.isThrowStatement(node)) fails = true;
    else if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) fails = true;
    else if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const value = stripParentheses(node.expression);
      fails = ts.isCallExpression(value) || ts.isAwaitExpression(value);
    }
  });
  return !fails;
}

/** `save().catch(showError)`: a call that handles its own failure. */
function catchesOwnFailure(expression: ts.Expression): boolean {
  const call = stripParentheses(expression);
  if (!ts.isCallExpression(call) || call.arguments.length === 0) return false;
  const callee = stripParentheses(call.expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "catch";
}

/** The first place the handler can fail with nothing to catch it, or undefined. */
function unguardedFailure(fn: Handler["fn"], ctx: FileContext): Failure | undefined {
  let found: Failure | undefined;
  const look = (node: ts.Node, guarded: boolean): void => {
    if (found !== undefined || guarded) return;
    if (
      ts.isAwaitExpression(node) &&
      !catchesOwnFailure(node.expression) &&
      !neverRejects(node.expression, ctx) &&
      !calleeCatchesOwnFailures(node.expression, ctx)
    ) {
      found = {
        node: node.getFirstToken(ctx.sourceFile) ?? node,
        kind: "await",
        code: node.expression,
      };
    } else if (ts.isForOfStatement(node) && node.awaitModifier !== undefined) {
      found = { node: node.awaitModifier, kind: "for-await", code: node.expression };
    } else if (
      ts.isReturnStatement(node) &&
      node.expression !== undefined &&
      returnsPromise(node.expression, ctx) &&
      !calleeCatchesOwnFailures(node.expression, ctx)
    ) {
      found = { node: node.expression, kind: "await", code: node.expression };
    }
  };
  scanRunning(fn.body, look);
  if (
    found === undefined &&
    !ts.isBlock(fn.body) &&
    returnsPromise(fn.body, ctx) &&
    !calleeCatchesOwnFailures(fn.body, ctx)
  ) {
    found = { node: fn.body, kind: "await", code: fn.body };
  }
  return found;
}

function headline(handler: Handler): string {
  return fitted(
    (cut) =>
      `unhandled rejection: nothing catches a failure of the async \`${cut(handler.name)}\` ${handler.role}`,
  );
}

/** The developer's own code in an example is cut to this many characters. */
const CODE_MAX = 50;

function code(node: ts.Node, ctx: FileContext): string {
  return shorten(oneLine(node.getText(ctx.sourceFile)), CODE_MAX);
}

/** The example's first and last line: the handler written where it was, with its own names. */
function frame(handler: Handler, ctx: FileContext): { first: string; last: string } {
  switch (handler.role) {
    case "handler":
      return { first: `${oneLine(handler.name)}={async () => {`, last: "}}" };
    case "listener":
    case "callback": {
      const [before, after] = aroundFunction(handler.call, handler.fn, ctx);
      return {
        first: `${code(handler.call.expression, ctx)}(${before}async () => {`,
        last: `}${after});`,
      };
    }
    default: {
      const unreachable: never = handler;
      return unreachable;
    }
  }
}

/** The call's other arguments, before and after the function: `"click", ` and `, 100`. */
function aroundFunction(
  call: ts.CallExpression,
  fn: Handler["fn"],
  ctx: FileContext,
): [string, string] {
  const index = call.arguments.findIndex((argument) => stripParentheses(argument) === fn);
  const texts = call.arguments.map((argument) => code(argument, ctx));
  const before = texts.slice(0, index).map((text) => `${text}, `);
  const after = texts.slice(index + 1).map((text) => `, ${text}`);
  return [before.join(""), after.join("")];
}

function hint(handler: Handler, failure: Failure, ctx: FileContext): string {
  const { first, last } = frame(handler, ctx);
  const failing =
    failure.kind === "await"
      ? `await ${code(failure.code, ctx)};`
      : `for await (const item of ${code(failure.code, ctx)}) { … }`;
  return withExample(`catch inside the ${handler.role}, since nothing awaits it:`, [
    first,
    `  try { ${failing} } catch (e) { showError(e); }`,
    last,
  ]);
}

export const handlerRejectionLost = defineRule({
  kind: "file",
  meta: {
    description:
      "No code awaits an event handler or a timer callback, so its failure is an unhandled rejection the user never sees; a `catch` inside it can show the error.",
    summary: "an async `onClick`, listener or timer callback whose failure is never caught",
    defaultSeverity: "error",
    tier: "core",
    group: GROUP,
    options: OPTIONS,
    explain: EXPLAIN,
    // `@neverRejects` is read from the project's JSDoc.
    needsJsDoc: true,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      const handler = handlerOf(node, ctx);
      if (handler !== undefined) {
        const failure = unguardedFailure(handler.fn, ctx);
        if (failure !== undefined) {
          ctx.report({
            node: failure.node,
            message: headline(handler),
            hint: hint(handler, failure, ctx),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
