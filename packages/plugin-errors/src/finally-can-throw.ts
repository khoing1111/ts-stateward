import ts from "@stateward/core/typescript";
import { defineRule, option, type FileContext } from "@stateward/core";
import {
  hasModifier,
  isBuiltinGlobal,
  sameFileFunction,
  scanRunning,
  stripParentheses,
  throwsUncaught,
} from "./syntax.js";
import { fitted, oneLine, withExample } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "catch";

const EXPLAIN = `# errors/finally-can-throw

A finally block does not call something that throws, so the error that led to it is not lost.

## Why

When code in a \`finally\` throws, its error replaces the one that sent the code there. An upload that fails with a network error then reports a \`SyntaxError\` from parsing the saved state: the real cause, with its message and stack, is gone, and the rest of the cleanup does not run.

## When to use it

Use it in any code that cleans up in \`finally\`. It is on as an error in every preset; keep it on. Turn it off only if your cleanup's own errors are meant to win.

## What it catches

In a \`finally\` block, outside a nested \`try\` that has a \`catch\`:

- a call to a built-in that throws: \`JSON.parse\`, \`JSON.stringify\` (on circular values), \`new URL\`, \`decodeURIComponent\`, \`decodeURI\`, \`structuredClone\`, \`atob\`;
- a \`throw\`;
- a call to a function in the same file that has a \`throw\` outside its own \`try\` / \`catch\` (an \`async\` one when the call is awaited).

One finding per \`finally\`, on the first of these.

### Bad

\`\`\`ts
try {
  await upload(file);
} finally {
  const state = JSON.parse(saved);
  restore(state);
}
\`\`\`

### Good

\`\`\`ts
try {
  await upload(file);
} finally {
  try {
    restore(JSON.parse(saved));
  } catch (e) {
    report(e);
  }
}
\`\`\`

### Fix

Move the call out of the \`finally\`, or wrap it in its own \`try\` / \`catch\`. There is no quick fix: what the cleanup should do when it fails is your call.

## What it does not catch

- Functions from other files, and package calls: only the built-ins above and functions in the same file are read.
- Other built-ins, such as \`fetch\` or \`BigInt\`.
- A function that throws only inside its own \`try\` / \`catch\`.
- Anything inside a nested \`try\` that has a \`catch\`.
- A second throwing call in the same \`finally\`: only the first is reported.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "errors/finally-can-throw": "off" } // or "warning"
groups: { "errors/finally": "off" } // the whole group
rules: { "errors/finally-can-throw": ["error", { severities: { builtin: "warning" } }] } // built-ins only warn
\`\`\`
`;

/** Built-in functions that throw on input they cannot handle, as `Owner.name` or `name`. */
const THROWING_CALLS: ReadonlySet<string> = new Set([
  "JSON.parse",
  "JSON.stringify",
  "decodeURIComponent",
  "decodeURI",
  "structuredClone",
  "atob",
]);
/** Built-in constructors that throw. */
const THROWING_CONSTRUCTORS: ReadonlySet<string> = new Set(["URL"]);

/** `JSON.parse` or `atob`, when the callee is one of the globals in the table. */
function builtinCall(call: ts.CallExpression, ctx: FileContext): string | undefined {
  const callee = stripParentheses(call.expression);
  if (ts.isIdentifier(callee)) {
    return THROWING_CALLS.has(callee.text) && isBuiltinGlobal(callee, ctx)
      ? callee.text
      : undefined;
  }
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const owner = stripParentheses(callee.expression);
  if (!ts.isIdentifier(owner)) return undefined;
  const name = `${owner.text}.${callee.name.text}`;
  return THROWING_CALLS.has(name) && isBuiltinGlobal(owner, ctx) ? name : undefined;
}

/** A way the finally can throw: the node to show and how the headline names it. */
type Cause = {
  node: ts.Node;
  subject: (cut: (text: string) => string) => string;
  kind: keyof typeof KINDS;
};

/** The kinds of finding: they differ in how sure the rule is that the call throws. */
const KINDS = {
  throw: "a `throw` written in the finally: it throws whenever it runs.",
  builtin:
    "a built-in such as `JSON.parse` or `new URL`: it throws only on input it cannot handle.",
  "own-function": "a function in the same file with a `throw` in it: it throws on some paths.",
};

function causeOf(node: ts.Node, awaited: boolean, ctx: FileContext): Cause | undefined {
  if (ts.isThrowStatement(node)) return { node, subject: () => "this `throw` runs", kind: "throw" };
  if (ts.isNewExpression(node)) {
    const callee = stripParentheses(node.expression);
    if (
      ts.isIdentifier(callee) &&
      THROWING_CONSTRUCTORS.has(callee.text) &&
      isBuiltinGlobal(callee, ctx)
    ) {
      return { node, subject: () => `\`new ${callee.text}(…)\` throws here`, kind: "builtin" };
    }
    return undefined;
  }
  if (!ts.isCallExpression(node)) return undefined;
  const builtin = builtinCall(node, ctx);
  if (builtin !== undefined) {
    return { node, subject: () => `\`${builtin}(…)\` throws here`, kind: "builtin" };
  }
  const declared = sameFileFunction(node.expression, ctx);
  if (declared === undefined || !throwsUncaught(declared)) return undefined;
  // An async function turns its throw into a rejected promise, which only an `await` rethrows.
  if (hasModifier(declared, ts.SyntaxKind.AsyncKeyword) && !awaited) return undefined;
  const callee = oneLine(stripParentheses(node.expression).getText(ctx.sourceFile));
  return { node, subject: (cut) => `\`${cut(callee)}(…)\` throws here`, kind: "own-function" };
}

function headline(cause: Cause): string {
  return fitted((cut) => `if ${cause.subject(cut)}, the error that led to this finally is lost`);
}

const HINT = withExample("move it out of finally, or catch it inside:", [
  "finally {",
  "  try { cleanup(); } catch (e) { report(e); }",
  "}",
]);

/** `shown` holds what is already reported: a `finally` inside a `finally` is looked at twice. */
function checkFinally(block: ts.Block, shown: Set<ts.Node>, ctx: FileContext): void {
  let found: Cause | undefined;
  scanRunning(block, (node, guarded) => {
    if (found !== undefined || guarded) return;
    const awaited = ts.isAwaitExpression(node.parent);
    found = causeOf(node, awaited, ctx);
  });
  if (found === undefined || shown.has(found.node)) return;
  shown.add(found.node);
  ctx.report({ node: found.node, message: headline(found), hint: HINT, findingKind: found.kind });
}

export const finallyCanThrow = defineRule({
  kind: "file",
  meta: {
    description:
      "A finally block does not call something that throws, so the error that led to it is not lost.",
    defaultSeverity: "error",
    tier: "core",
    group: GROUP,
    options: {
      severities: option.severities({
        kinds: KINDS,
        description: "A severity per kind of call, where you trust one kind less.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const shown = new Set<ts.Node>();
    const visit = (node: ts.Node): void => {
      if (ts.isTryStatement(node) && node.finallyBlock !== undefined) {
        checkFinally(node.finallyBlock, shown, ctx);
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
