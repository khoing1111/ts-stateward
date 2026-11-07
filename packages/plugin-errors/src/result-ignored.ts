import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option } from "@stateward/core";
import type { FileContext, OptionsOf } from "@stateward/core";
import { example, resultShapeOf, shorten, type ResultShape } from "./result-type.js";

const EXPLAIN = `# errors/result-ignored

A \`Result\` dropped as a statement discards its error, so a failed call looks the same as a successful one.

\`\`\`ts example-bad
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

declare function saveUser(name: string): Promise<Result<void>>;

export async function rename(name: string): Promise<void> {
  await saveUser(name);
}
\`\`\`

Check the result, or return it to your caller:

\`\`\`ts example-good
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

declare function saveUser(name: string): Promise<Result<void>>;

export async function rename(name: string): Promise<Result<void>> {
  const saved = await saveUser(name);
  if (!saved.ok) return saved;
  return { ok: true, value: undefined };
}
\`\`\`

The message shows how, with your names and your Result's shape. There is no quick fix.

## Why it matters

A \`Result\` is how a function says "this can fail". Call \`saveUser(name)\` as a statement and the answer is discarded: no code reads the error, and the code goes on as if the user was saved. The failure shows up later, as missing data.

## What it does not catch

A Result is recognised by its shape, so no library is needed: a union told apart by \`ok: true\` and \`ok: false\`, or by \`success: true\` and \`success: false\` (zod's \`safeParse\`); a type with \`isOk()\` and \`isErr()\` methods (neverthrow); or a type the \`resultTypes\` option names. It is silent on:

- a result that is assigned, returned, passed on, used in a condition or spread;
- a Result of another shape (an \`Either\` with \`_tag\`, a tuple \`[error, value]\`), unless \`resultTypes\` names it;
- a result dropped in a callback that returns nothing (\`items.forEach((item) => save(item))\`), or after \`&&\` or \`?.\`;
- a result stored and never looked at (\`const saved = saveUser(name);\` with \`saved\` unused), and reading \`.value\` without checking \`.ok\`: \`errors/result-unchecked\` looks at those reads.

## Turn it on or off

To drop a result on purpose, list the function in \`ignore\`, or set \`allowVoid\` and write \`void save()\`:

\`\`\`ts
rules: { "errors/result-ignored": ["error", { allowVoid: true }] } // \`void save()\` drops it on purpose
rules: { "errors/result-ignored": ["error", { resultTypes: ["Either"] }] } // your own name for a Result
rules: { "errors/result-ignored": "off" }
\`\`\`
`;

/** The longest callee a headline shows before it is cut, and the longest call an example line shows. */
const CALLEE_MAX = 30;
const CALL_MAX = 60;

const OPTIONS = {
  allowVoid: option.boolean({
    default: false,
    description: "Take `void save()` as dropping the Result on purpose, and stay quiet.",
  }),
  resultTypes: option.strings({
    default: [],
    description:
      "Your names for a Result type whose shape stateward does not recognise (`Either`, `Outcome*`; globs allowed).",
  }),
  ignore: option.strings({
    default: [],
    description:
      "Functions whose Result may be dropped, by the name they are called with (`logEvent`, `*.track`; globs allowed).",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

function unwrap(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isVoidExpression(expression) ||
    ts.isAwaitExpression(expression)
  ) {
    return unwrap(expression.expression);
  }
  return expression;
}

/** The text of the callee, keeping its end when it is long: `…users.save`. */
function calleeText(call: ts.CallExpression, ctx: FileContext): string {
  const text = call.expression.getText(ctx.sourceFile).replace(/\s+/g, "");
  return text.length > CALLEE_MAX ? `…${text.slice(-(CALLEE_MAX - 1))}` : text;
}

/** `void x`, also inside parentheses or after `await`. */
function isVoided(expression: ts.Expression): boolean {
  if (ts.isVoidExpression(expression)) return true;
  return (
    (ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) &&
    isVoided(expression.expression)
  );
}

/** The line of the example that checks the result, in the Result's own shape. */
function checkLine(shape: ResultShape): string {
  switch (shape) {
    case "ok":
      return "if (!saved.ok) return saved;";
    case "success":
      return "if (!saved.success) return saved;";
    case "isErr":
      return "if (saved.isErr()) return saved;";
    case "named":
      return "// handle its failure here, or return it";
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
}

function checkStatement(statement: ts.ExpressionStatement, ctx: FileContext<Settings>): void {
  if (ctx.options.allowVoid && isVoided(statement.expression)) return;
  const call = unwrap(statement.expression);
  if (!ts.isCallExpression(call)) return;
  const callee = call.expression.getText(ctx.sourceFile).replace(/\s+/g, "");
  if (matchesName(callee, ctx.options.ignore)) return;
  const shape = resultShapeOf(call, ctx.types, ctx.options.resultTypes);
  if (shape === undefined) return;
  const promised = ctx.types.isPromiseLike(call);
  const whole = shorten(call.getText(ctx.sourceFile), Number.MAX_SAFE_INTEGER);
  // A long call keeps its callee and drops its arguments, so the example stays valid code.
  const callText =
    whole.length > CALL_MAX
      ? `${shorten(call.expression.getText(ctx.sourceFile), CALL_MAX)}(…)`
      : whole;
  ctx.report({
    node: statement,
    about: statement,
    message: `the \`Result\` of \`${calleeText(call, ctx)}(…)\` is dropped: its error is never handled`,
    hint: [
      "check it, or pass it on:",
      example([`const saved = ${promised ? "await " : ""}${callText};`, checkLine(shape)]),
    ].join("\n"),
  });
}

export const resultIgnored = defineRule({
  kind: "file",
  meta: {
    description:
      "A `Result` dropped as a statement discards its error, so a failed call looks the same as a successful one.",
    summary: "a `Result` dropped as a statement, after `void` or after `await`",
    defaultSeverity: "error",
    tier: "core",
    group: "callers",
    // A trigger dropped where its failure goes unseen is said better there (one cause, one message).
    yieldsTo: ["result-unchecked"],
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isExpressionStatement(node)) checkStatement(node, ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
