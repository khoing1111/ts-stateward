import { defineRule, matchesName, option } from "@stateward/core";
import type { RelatedLocation } from "@stateward/core";
import { catchName, className } from "./inference/format.js";
import { analyse, everyCatch } from "./inference/solve.js";
import type { CatchSeen, Via } from "./inference/solve.js";
import { modelOf, summarizeReact, throwsOf } from "./react/boundaries.js";
import { checkFallbacks } from "./react/fallbacks.js";
import type { ClassFact } from "./inference/summary.js";
import { codeList, fitted, withExample } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "catch";

const EXPLAIN = `# errors/catch-misses-error

A catch that branches with instanceof handles every error class its try can throw, or rethrows the rest; so does an error boundary's fallback.

## Why

A \`catch\` that checks \`e instanceof AuthError\` says which errors it expects. When \`api.send\` can also throw \`RateLimitError\`, a rate limit falls into the generic branch: the user sees a generic error page, and the retry that would have worked never happens. This rule lists, at the \`catch\`, the classes it leaves out.

## When to use it

Use it in code that throws its own error classes and catches them by class. It is on as an error in every preset; where a \`catch\` does not branch on \`instanceof\`, it says nothing. It works best when your functions throw classes and document them with \`@throws {T}\`.

## What it catches

A \`catch\` that branches with \`if\` / \`else if\` or \`switch (true)\` on \`instanceof\`, when its \`try\` can throw an error class that no branch names and nothing passes on.

What the \`try\` can throw is worked out from \`throw new X(…)\` in the functions it calls, in any file, their \`@throws\` tags (also on a function declared without a body, such as \`declare function\` or a \`.d.ts\` of your own), the built-ins stateward knows (\`JSON.parse\`, \`new URL\`, \`fetch\`, …), and the packages it calls. \`stateward deps\` shows how well each package's errors are known.

What counts as handled:

- \`e instanceof X\` handles \`X\` and every class that extends it (\`e instanceof Error\` handles them all);
- a last \`else\` or \`default\`, or a statement after the chain, that throws (\`throw e\`, or a new error with \`{ cause: e }\`) passes the rest on;
- a last \`else\` or \`default\`, or code after the chain, that uses the error (\`setError(e)\`, logging it, reading a property) handles the rest. An \`else\` that ignores the error (\`showGenericError()\`) does not.

### Bad

\`\`\`ts
// api.send can throw RateLimitError and AuthError.
try {
  await api.send(message);
} catch (e) {
  if (e instanceof AuthError) {
    redirectToLogin();
  } else {
    showGenericError();
  }
}
\`\`\`

### Good

\`\`\`ts
try {
  await api.send(message);
} catch (e) {
  if (e instanceof AuthError) {
    redirectToLogin();
  } else if (e instanceof RateLimitError) {
    retryLater();
  } else {
    throw e;
  }
}
\`\`\`

### Fix

Add a branch for each missing class, or rethrow what you do not handle. The message shows the branch in the shape of your \`catch\`, and links to the call that throws each class. There is no quick fix.

## What it does not catch

- A \`catch\` with no \`instanceof\` branches: it treats every error alike on purpose.
- Errors stateward cannot see: from a package it cannot read, a callback, or a dynamic call. Only the classes it can see are checked, and the message notes each call it could not see into, with the reason. \`errors/catch-hides-unexpected\` makes sure the rest is not dropped. To fill a gap, declare a package's errors under \`facts\` in the config.
- A class whose \`extends\` cannot be followed, or a branch with a test that is not only \`instanceof\` (\`e instanceof A && e.code === 1\`, \`isAbort(e)\`): it does not guess what that branch handles.
- Errors from the JavaScript engine itself, such as reading a property of \`undefined\`.
- Built-ins other than \`JSON.parse\`, \`JSON.stringify\`, \`new URL\`, \`decodeURIComponent\`, \`decodeURI\`, \`structuredClone\`, \`atob\`, \`fetch\`, \`toFixed\`, \`Array(n)\` and \`BigInt\`: they are taken not to throw.
- Promises kept in a \`let\`, a parameter or a property; getters, setters and generators; tests other than \`instanceof\` (\`e.name === "AbortError"\`).

## Error boundary fallbacks

An error boundary's fallback is a catch too: what the components below the boundary throw while rendering and in their effects, down to the next boundary, is its \`try\` (the hover on the boundary lists it). A fallback that branches with \`if\` / \`else if\`, \`switch (true)\` or \`? :\` on \`error instanceof X\` is checked the same way: each class the boundary can catch has a branch, or a branch for the rest does more than return \`null\` or nothing. The fallback is react-error-boundary's \`FallbackComponent\`, \`fallbackRender\` or \`onError\`, or a boundary class's \`getDerivedStateFromError\`.

\`\`\`tsx
// SettingsPage, under this boundary, can throw ParseError.
function UserErrorPage({ error }: FallbackProps) {
  if (error instanceof NotFoundError) return <p>This user does not exist.</p>;
  return <p>Something went wrong: {String(error)}</p>; // a branch for the rest
}
\`\`\`

A fallback that does not branch on \`instanceof\`, or whose tests are not only \`instanceof\`, is left alone; so is one passed as anything other than a function written in place or the name of a function of the project.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "errors/catch-misses-error": "off" } // or "warning"
groups: { "errors/catch": "off" } // the whole group
facts: { "config-lib": { load: { throws: ["ConfigError"] } } } // declare a package's errors
rules: { "errors/catch-misses-error": ["error", { ignoreClasses: ["SyntaxError"] }] } // never require a branch for these
\`\`\`
`;

type Missing = { id: string; via: Via | null };

/** At most this many package calls with unknown errors are noted on a finding. */
const MAX_UNKNOWN_NOTES = 2;

function headline(names: readonly string[], via: string | undefined): string {
  return fitted((cut) => {
    const source = via === undefined ? "its `try` block" : `\`${cut(via)}\``;
    return `this catch does not handle ${codeList(names, cut)}, which ${source} can throw`;
  });
}

/** The fix, in the shape of the catch: a `case`, an `else if`, or an `if` for a chain without `else`. */
function hint(count: number, variable: string, handler: string, shape: Shape): string {
  const branch = count === 1 ? "it" : "each";
  switch (shape) {
    case "switch":
      return withExample(`add a branch for ${branch}, or rethrow what you do not handle:`, [
        `case ${variable} instanceof ${handler}:`,
        "  …",
        "default:",
        `  throw ${variable};`,
      ]);
    case "else":
      return withExample(`add a branch for ${branch}, or rethrow what you do not handle:`, [
        `} else if (${variable} instanceof ${handler}) {`,
        "  …",
        "} else {",
        `  throw ${variable};`,
      ]);
    case "if":
      return withExample(
        `add a branch for ${branch}, or rethrow what you do not handle after the chain:`,
        [`if (${variable} instanceof ${handler}) {`, "  …", "}", `throw ${variable};`],
      );
    default: {
      const unreachable: never = shape;
      return unreachable;
    }
  }
}

/** How the catch branches: a `switch (true)`, an `if` chain with a final `else`, or one without. */
type Shape = "switch" | "else" | "if";

function report(
  seen: CatchSeen,
  classes: ReadonlyMap<string, ClassFact>,
  ignored: readonly string[],
  emit: (problem: {
    message: string;
    hint: string;
    location: { file: string; start: number; end: number };
    related: readonly RelatedLocation[];
  }) => void,
): void {
  const { handler } = seen;
  if (handler.restThrows || handler.restUsed || handler.variable === null) return;
  const missing: Missing[] = [];
  for (const [id, info] of seen.unhandled) {
    if (info.certain && !matchesName(catchName(id, classes), ignored)) {
      missing.push({ id, via: info.via });
    }
  }
  const [first] = missing;
  if (first === undefined) return;
  const vias = new Set(missing.map((one) => one.via?.text));
  const via = vias.size === 1 ? first.via?.text : undefined;
  const related: RelatedLocation[] = [];
  const shown = new Set<string>();
  for (const { id, via: from } of missing) {
    if (from === null || shown.has(`${String(from.start)}:${from.text}`) || related.length >= 3) {
      continue;
    }
    shown.add(`${String(from.start)}:${from.text}`);
    related.push({
      location: { file: from.file, start: from.start, end: from.end },
      message: `\`${from.text}\` can throw \`${className(id, classes)}\``,
    });
  }
  // A package call whose errors are not all known: the catch passes them on (they reach the
  // rethrow, or nothing is reported for them), and the note says which call and why.
  const unknowns = [...seen.thrown.unknowns.values()].filter((one) => one.package !== undefined);
  for (const source of unknowns.slice(0, MAX_UNKNOWN_NOTES)) {
    related.push({
      location: { file: source.file, start: source.start, end: source.end },
      message: `\`${source.text}\` may also throw errors stateward cannot list (${source.reason}); rethrow what you do not handle`,
    });
  }
  emit({
    message: headline(
      missing.map((one) => className(one.id, classes)),
      via,
    ),
    hint: hint(
      missing.length,
      handler.variable,
      catchName(first.id, classes),
      handler.dispatch === "switch" ? "switch" : handler.otherwise === null ? "if" : "else",
    ),
    location: { file: seen.file, start: handler.at[0], end: handler.at[1] },
    related,
  });
}

export const catchMissesError = defineRule({
  kind: "project",
  meta: {
    description:
      "A catch that branches with instanceof handles every error class its try can throw, or rethrows the rest; so does an error boundary's fallback.",
    defaultSeverity: "error",
    tier: "core",
    group: GROUP,
    needsJsDoc: true,
    options: {
      ignoreClasses: option.strings({
        default: [],
        description:
          "Error classes a catch never needs a branch for, as its instanceof test names them (SyntaxError, *AbortError).",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: (ctx) => summarizeReact(ctx),
  check(summaries, ctx) {
    const analysis = analyse(throwsOf(summaries));
    for (const seen of everyCatch(analysis)) {
      report(seen, analysis.classes, ctx.options.ignoreClasses, (problem) => {
        ctx.report(problem);
      });
    }
    checkFallbacks(modelOf(summaries), ctx.options.ignoreClasses, (problem) => {
      ctx.report(problem);
    });
  },
});
