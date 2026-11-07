import { defineRule, matchesName, option } from "@stateward/core";
import type { Location, OptionsOf, ProjectContext, RelatedLocation } from "@stateward/core";
import { catchName, className } from "./inference/format.js";
import { analyse, collected, evaluated, relation } from "./inference/solve.js";
import type { Analysis, Collected, FunctionEntry } from "./inference/solve.js";
import { summarizeOnce } from "./inference/project.js";
import { codeList, fitted } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "callers";

const EXPLAIN = `# errors/throws-doc-mismatch

Callers decide what to catch from \`@throws\`: a class it omits reaches them unhandled, and a class listed in excess asks them to handle a case that cannot happen.

\`\`\`ts example-bad
export class NotFoundError extends Error {}

/** @throws {NotFoundError} */
export function loadUser(text: string): { name: string } {
  if (text === "") throw new NotFoundError("no such user");
  return JSON.parse(text) as { name: string };
}
\`\`\`

Update the tag to what the function can throw; the message gives the one to write:

\`\`\`ts example-good
export class NotFoundError extends Error {}

/** @throws {NotFoundError | SyntaxError} */
export function loadUser(text: string): { name: string } {
  if (text === "") throw new NotFoundError("no such user");
  return JSON.parse(text) as { name: string };
}
\`\`\`

The message links to the call that throws each missing class. There is no quick fix.

## Why it matters

\`@throws {T}\` tells callers which errors to expect, and stateward checks every caller's \`catch\` against it. A tag that has drifted from the code misleads both: here a \`SyntaxError\` from \`JSON.parse\` slips past a \`catch\` written for \`NotFoundError\`. A tag that lists an error the function can no longer throw sends callers to handle something that never comes.

## When it says “not checked”

- A listed class that comes from a call stateward cannot see into (a package, a callback, a dynamic call): it names the call. Remove the class from the tag if the function cannot throw it, or declare the package's errors under \`facts\` in the config (\`facts: { "config-lib": { load: { throws: ["ConfigError"] } } }\`).
- A name in the tag that is not a class in scope: import the class, or use a name in scope.

## What it does not catch

It compares the tag with what the function can throw (its own \`throw new X(…)\`, the functions it calls, and the built-ins stateward knows) and reports a class in the tag that the function cannot throw (neither it nor a subclass), and a class it can throw that the tag does not cover. On a function that returns a promise, \`@throws\` means what the promise rejects with. It is silent on:

- a function without \`@throws\`, or a tag without a type (\`@throws when the id is empty\`): that only says the function throws;
- a class that a surrounding \`try\` may catch: only classes that surely escape are reported as missing;
- errors from the JavaScript engine itself, such as reading a property of \`undefined\`.

## Turn it on or off

It does nothing for functions without the tag, so it costs nothing until you start writing them.

\`\`\`ts
rules: { "errors/throws-doc-mismatch": "off" } // or "warning"
rules: { "errors/throws-doc-mismatch": ["error", { severities: { extra: "warning" } }] } // a stale tag only warns
\`\`\`
`;

function locationOf(file: string, at: readonly [number, number]): Location {
  return { file, start: at[0], end: at[1] };
}

const OPTIONS = {
  severities: option.severities({
    kinds: {
      missing: "the function can throw a class its `@throws` does not list.",
      extra: "the `@throws` lists a class the function cannot throw (stale, not dangerous).",
    },
    description: "A severity per kind of mismatch.",
  }),
  ignoreClasses: option.strings({
    default: [],
    description:
      "Error classes a `@throws` never needs to list (TypeError, *AbortError), as a catch names them.",
  }),
};

function check(
  entry: FunctionEntry,
  analysis: Analysis,
  ctx: ProjectContext<OptionsOf<typeof OPTIONS>>,
): void {
  const doc = entry.fact.doc;
  if (doc === null) return;
  const { classes } = analysis;
  const result = evaluated(entry, analysis).body;
  const all: Collected = collected();
  for (const part of [result.throws, result.rejects]) {
    for (const [id, info] of part.classes) {
      const known = all.classes.get(id);
      if (known === undefined) all.classes.set(id, { ...info });
      else known.certain ||= info.certain;
    }
    for (const [key, source] of part.unknowns) all.unknowns.set(key, source);
  }
  const name = entry.fact.name;
  const firstUnknown = [...all.unknowns.values()][0];

  for (const item of doc.entries) {
    const location = locationOf(entry.file, item.at);
    if (item.id === null) {
      ctx.unknown({
        message: fitted(
          (cut) =>
            `not checked: \`@throws\` names \`${cut(item.name)}\`: no class of that name is in scope`,
        ),
        hint: "name an error class that is in scope in this file, or import it",
        location,
      });
      continue;
    }
    const id = item.id;
    const possible = [...all.classes.keys()].some(
      (thrown) => relation(id, thrown, classes) !== "no",
    );
    if (possible) continue;
    const listed = className(id, classes);
    if (firstUnknown !== undefined) {
      ctx.unknown({
        message: fitted(
          (cut) =>
            `not checked: whether \`${cut(name)}\` throws \`${cut(listed)}\`: what \`${cut(firstUnknown.text)}\` throws is not known (${firstUnknown.reason})`,
        ),
        hint: `remove \`${listed}\` from the tag if \`${name}\` cannot throw it; otherwise add \`@throws\` where it comes from`,
        location,
      });
      continue;
    }
    ctx.report({
      message: fitted(
        (cut) => `\`@throws\` of \`${cut(name)}\` lists \`${cut(listed)}\`, which it cannot throw`,
      ),
      hint: `remove \`${listed}\` from the tag, or throw it where it can happen`,
      location,
      findingKind: "extra",
    });
  }

  if (doc.untyped.length > 0 || doc.entries.some((item) => item.id === null)) return;
  const missing: { id: string; related: RelatedLocation | undefined }[] = [];
  for (const [id, info] of all.classes) {
    if (!info.certain || matchesName(catchName(id, classes), ctx.options.ignoreClasses)) continue;
    const verdicts = doc.entries.map((item) =>
      item.id === null ? "undecided" : relation(item.id, id, classes),
    );
    if (verdicts.includes("yes") || verdicts.includes("undecided")) continue;
    const via = info.via;
    missing.push({
      id,
      related:
        via === null
          ? undefined
          : {
              location: { file: via.file, start: via.start, end: via.end },
              message: `\`${via.text}\` can throw \`${className(id, classes)}\``,
            },
    });
  }
  if (missing.length === 0) return;
  const names = missing.map((one) => className(one.id, classes)).sort();
  const tagNames = [...new Set(missing.map((one) => catchName(one.id, classes)))].sort();
  ctx.report({
    message: fitted(
      (cut) => `\`@throws\` of \`${cut(name)}\` does not list ${codeList(names, cut)}`,
    ),
    hint: `add ${missing.length === 1 ? "it" : "them"} to the tag: \`@throws {${tagNames.join(" | ")}}\``,
    location: locationOf(entry.file, entry.fact.at),
    related: missing.flatMap((one) => (one.related === undefined ? [] : [one.related])).slice(0, 3),
    findingKind: "missing",
  });
}

export const throwsDocMismatch = defineRule({
  kind: "project",
  meta: {
    description:
      "Callers decide what to catch from `@throws`: a class it omits reaches them unhandled, and a class listed in excess asks them to handle a case that cannot happen.",
    summary: "a `@throws` tag that lists an error the function cannot throw, or misses one it can",
    defaultSeverity: "error",
    tier: "core",
    group: GROUP,
    needsJsDoc: true,
    options: OPTIONS,
    explain: EXPLAIN,
  },
  summarize: (ctx) => summarizeOnce(ctx),
  check(summaries, ctx) {
    const analysis = analyse(summaries);
    for (const entry of analysis.functions.values()) check(entry, analysis, ctx);
  },
});
