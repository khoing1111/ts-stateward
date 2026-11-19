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

An error class the \`try\` can throw and the \`catch\` does not test goes to the generic branch, or is ignored; a branch for it, or a rethrow, handles it explicitly.

\`\`\`ts example-bad
class AuthError extends Error {}
class RateLimitError extends Error {}

function send(text: string, remaining: number): void {
  if (remaining === 0) throw new RateLimitError("slow down");
  if (text === "") throw new AuthError("signed out");
}

export function post(text: string, remaining: number, show: (text: string) => void): void {
  try {
    send(text, remaining);
  } catch (e) {
    if (e instanceof AuthError) {
      show("Please sign in again.");
    } else {
      show("Something went wrong.");
    }
  }
}
\`\`\`

Add a branch for each class the message names, and rethrow what you do not handle:

\`\`\`ts example-good
class AuthError extends Error {}
class RateLimitError extends Error {}

function send(text: string, remaining: number): void {
  if (remaining === 0) throw new RateLimitError("slow down");
  if (text === "") throw new AuthError("signed out");
}

export function post(text: string, remaining: number, show: (text: string) => void): void {
  try {
    send(text, remaining);
  } catch (e) {
    if (e instanceof AuthError) {
      show("Please sign in again.");
    } else if (e instanceof RateLimitError) {
      show("Too many messages; try again in a minute.");
    } else {
      throw e;
    }
  }
}
\`\`\`

The message shows the branch in the shape of your \`catch\`, and links to the call that throws each class. It keeps an \`else\` or \`default\` you already have: the branch goes before it, and the other readings are to make it rethrow, to use the error in it (then the rest is handled), or to list the class under \`ignoreClasses\`. There is no quick fix.

## Why it matters

A \`catch\` that checks \`e instanceof AuthError\` says which errors it expects. When \`send\` can also throw \`RateLimitError\`, a rate limit falls into the generic branch: the user sees "Something went wrong", and the wait that would have worked never happens. The rule lists, at the \`catch\`, the classes it leaves out, so a new error class reaches every place that has to decide about it.

## What it does not catch

What counts as handled: \`e instanceof X\` handles \`X\` and every class that extends it (\`e instanceof Error\` handles them all); a last \`else\` or \`default\`, or a statement after the chain, that throws (\`throw e\`, or a new error with \`{ cause: e }\`) passes the rest on; and one that uses the error (\`setError(e)\`, logging it, reading a property) handles the rest. An \`else\` that ignores the error, like \`show("Something went wrong.")\` above, does not. The rule is silent on:

- a \`catch\` with no \`instanceof\` branches: it treats every error alike on purpose;
- errors stateward cannot see: from a package it cannot read, a callback, or a dynamic call. The message notes each call it could not see into, with the reason, and \`errors/catch-hides-unexpected\` makes sure the rest is not dropped;
- a class whose \`extends\` cannot be followed, or a branch whose test is not only \`instanceof\` (\`e instanceof A && e.code === 1\`, \`isAbort(e)\`, \`e.name === "AbortError"\`): it does not guess what that branch handles;
- errors from the JavaScript engine itself, such as reading a property of \`undefined\`;
- built-ins other than \`JSON.parse\`, \`JSON.stringify\`, \`new URL\`, \`decodeURIComponent\`, \`decodeURI\`, \`structuredClone\`, \`atob\`, \`fetch\`, reading a \`Response\` body (\`json()\`, \`text()\`, …), \`toFixed\`, \`Array(n)\` and \`BigInt\`: they are taken not to throw;
- promises kept in a \`let\`, a parameter or a property; getters, setters and generators.

## Getting the best from it

What the \`try\` can throw is worked out from \`throw new X(…)\` in the functions it calls, in any file; their \`@throws {X}\` tags (also on a function with no body, such as \`declare function\` or a \`.d.ts\` of your own); the built-ins above; and the packages it calls (\`stateward deps\` shows how well each package's errors are known). So throw classes, not strings, and document what a function throws with \`@throws\`. Declare a package's errors under \`facts\` in the config: \`facts: { "config-lib": { load: { throws: ["ConfigError"] } } }\`.

An error boundary's fallback is checked the same way: what the components below the boundary throw while rendering and in their effects, down to the next boundary, is its \`try\` (the hover on the boundary lists it). A fallback (react-error-boundary's \`FallbackComponent\`, \`fallbackRender\` or \`onError\`, or a boundary class's \`getDerivedStateFromError\`) that branches with \`if\` / \`else if\`, \`switch (true)\` or \`? :\` on \`error instanceof X\` needs a branch for each class the boundary can catch, or a branch for the rest that does more than return \`null\` or nothing. The message shows both, written for the kind of fallback (for a boundary class's \`getDerivedStateFromError\` it describes the branch for the rest, since the state is yours), and the \`ignoreClasses\` option with the class named. A fallback that does not branch on \`instanceof\`, whose tests are not only \`instanceof\`, or that is passed as anything other than a function written in place or the name of one of your functions, is left alone.

## Turn it on or off

\`\`\`ts
rules: { "errors/catch-misses-error": "off" } // or "warning"
rules: { "errors/catch-misses-error": ["error", { ignoreClasses: ["SyntaxError"] }] } // never require a branch for these
\`\`\`
`;

type Missing = { id: string; via: Via | null };

/** At most this many package calls with unknown errors are noted on a finding. */
const MAX_UNKNOWN_NOTES = 2;

function headline(names: readonly string[], via: string | undefined): string {
  return fitted((cut) => {
    const source = via === undefined ? "thrown in its `try` block" : `from \`${cut(via)}\``;
    return `\`catch\` does not handle ${codeList(names, cut)} ${source}`;
  });
}

/**
 * The ways to handle a class the `catch` does not test, in the shape of the catch (M22): a branch
 * for it (placed so the existing `else` or `default` stays), a rethrow for what is not handled,
 * the generic branch using the error, or the class listed under `ignoreClasses`.
 */
function hint(
  names: readonly string[],
  variable: string,
  shape: Shape,
  hasFallback: boolean,
): string {
  const count = names.length;
  const [handler = ""] = names;
  const branch = count === 1 ? "it" : "each";
  const ignore =
    count === 1
      ? `- or, if \`${handler}\` needs no branch, list it under the rule's \`ignoreClasses\` option`
      : "- or, for the classes that need no branch, list them under the rule's `ignoreClasses` option";
  const used = (where: string) =>
    `- or, if the ${where} is right for ${count === 1 ? "it" : "them"}, use \`${variable}\` there: read it, log it or report it`;
  switch (shape) {
    case "switch":
      return [
        "one of",
        hasFallback
          ? withExample(`- add a branch for ${branch}, before the \`default\` you have`, [
              `case ${variable} instanceof ${handler}:`,
              "  …",
              "default: // yours, unchanged",
            ])
          : withExample(`- add a branch for ${branch}, and rethrow what you do not handle`, [
              `case ${variable} instanceof ${handler}:`,
              "  …",
              "default:",
              `  throw ${variable};`,
            ]),
        ...(hasFallback
          ? [
              withExample("- or rethrow what you do not handle, in the `default` you have", [
                "default:",
                `  throw ${variable};`,
              ]),
              used("`default`"),
            ]
          : []),
        ignore,
      ].join("\n");
    case "else":
      return [
        "one of",
        withExample(`- add a branch for ${branch}, before the \`else\` you have`, [
          `} else if (${variable} instanceof ${handler}) {`,
          "  …",
          "} else { // yours, unchanged",
        ]),
        withExample("- or rethrow what you do not handle, in the `else` you have", [
          "} else {",
          `  throw ${variable};`,
          "}",
        ]),
        used("`else`"),
        ignore,
      ].join("\n");
    case "if":
      return [
        "one of",
        withExample(
          `- add a branch for ${branch}, and rethrow what you do not handle after the chain`,
          [`if (${variable} instanceof ${handler}) {`, "  …", "}", `throw ${variable};`],
        ),
        `- or, if what the chain does not handle is right for ${count === 1 ? "it" : "them"}, use \`${variable}\` after the chain: read it, log it or report it`,
        ignore,
      ].join("\n");
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
      message: `\`${source.text}\` may also throw errors that are not known (${source.reason}); rethrow what you do not handle`,
    });
  }
  emit({
    message: headline(
      missing.map((one) => className(one.id, classes)),
      via,
    ),
    hint: hint(
      missing.map((one) => catchName(one.id, classes)),
      handler.variable,
      handler.dispatch === "switch" ? "switch" : handler.otherwise === null ? "if" : "else",
      handler.otherwise !== null,
    ),
    location: { file: seen.file, start: handler.at[0], end: handler.at[1] },
    related,
  });
}

export const catchMissesError = defineRule({
  kind: "project",
  meta: {
    description:
      "An error class the `try` can throw and the `catch` does not test goes to the generic branch, or is ignored; a branch for it, or a rethrow, handles it explicitly.",
    summary: "a `catch` that branches on error classes but misses one its `try` can throw",
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
