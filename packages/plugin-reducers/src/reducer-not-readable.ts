import { defineRule, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at } from "./notes.js";
import { summarizeFile } from "./summary.js";
import { fitted, MAX_HINT, shorten } from "./text.js";

const EXPLAIN = `# reducers/reducer-not-readable

A place in or around a reducer that stateward cannot read, so its other reducer checks cannot cover it.

## Why

\`reducers/state-unreachable\` and \`reducers/state-cannot-leave\` read which state each \`return\` of a reducer gives, and where it starts. Where they cannot tell (a helper typed as the whole union, a start loaded from storage), they assume any state can follow or come first, and say nothing. This rule lists those places, each with the change that makes the reducer fully checked.

## When to use it

Use it when you want every reducer fully checked. It shows as info under \`recommended\` (a hint in the editor that does not fail the check) and as an error under \`strict\`.

## What it catches

- A \`return\` typed as the whole state union, like \`return applyPromo(state, event)\` where \`applyPromo\` returns \`CheckoutState\`. A returned constant is read from its value (\`const initialState: State = { status: "idle" }\`), and reported only when that value cannot be read either (\`const restored: State = restore()\`).
- A \`useReducer\` start that is not a known state: a parameter, a call, data from storage.
- A reducer-like function passed around as a value (\`reducers = [queueReducer]\`), without \`useReducer\` or \`@initial\`.
- A reducer also called or passed around elsewhere (outside tests), or exported from your package, without \`@initial\`: it may start in any state.
- A name in \`@initial\` that is not a state.
- A \`@final\` or \`@initial\` that does not start with a quoted state (\`@final the order is done\`): it is read as a comment. Write states in quotes, separated by \`|\`, commas or spaces: \`@final "delivered" | "refunded"\`.

### Bad

\`\`\`ts
function jobReducer(state: JobState, event: JobEvent): JobState {
  return applyEvent(state, event); // \`applyEvent\` is typed \`: JobState\`
}
\`\`\`

### Good

\`\`\`ts
function applyEvent(state: JobState, event: JobEvent): Extract<JobState, { status: "running" }> { … }
\`\`\`

And for a reducer that does not run through \`useReducer\`, give its state a default (\`state = initialQueue\`), or put \`/** @initial "queued" */\` above it.

### Fix

Give the helper or constant a return type that names its states, such as \`Extract<State, { status: "idle" }>\`, or add \`@initial\`. There is no quick fix: only you know which states they are.

## What it does not catch

- A function with a reducer's signature that is never used, or only called as a helper.
- A \`return\` typed \`any\`: \`reducers/state-unreachable\` reports that one.
- State in \`useState\` or class fields: they do not have to become reducers.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "reducers/reducer-not-readable": "off" } // or "warning"
groups: { "machines/graph": "off" } // the whole group
rules: { "reducers/reducer-not-readable": ["info", { severities: { "may-start-anywhere": "off" } }] } // a library's exported reducers
\`\`\`
`;

export const reducerNotReadable = defineRule({
  kind: "project",
  meta: {
    description:
      "A place in or around a reducer that stateward cannot read, so its other reducer checks cannot cover it.",
    defaultSeverity: "info",
    tier: "coverage",
    group: "graph",
    needsJsDoc: true,
    options: {
      severities: option.severities({
        kinds: {
          "whole-return":
            "a `return` typed as the whole state union, or a constant whose state cannot be read.",
          "unknown-start": "a `useReducer` start that is not a known state.",
          "may-start-anywhere":
            "a reducer used outside `useReducer`, or exported from your package, with no `@initial`.",
          "unquoted-tag": "an `@initial` or `@final` tag that lists states without quotes.",
          "unknown-initial": "a name in `@initial` that is not a state.",
        },
        description: "A severity per kind of place stateward cannot read.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: summarizeFile,
  check(summaries, ctx) {
    const proseSeen = new Set<string>();
    for (const machine of machinesOf(summaries)) {
      const { reducer } = machine;
      const unstarted =
        !machine.active && machine.references.some(({ reference }) => reference.kind === "value");
      if (!machine.active && !unstarted) continue;
      const name = (cut: { name: (text: string) => string }): string =>
        `\`${cut.name(reducer.name)}\``;
      const example = `Extract<${reducer.stateName}, { ${reducer.tag}: ${quoted(reducer.tags[0] ?? "")} }>`;
      for (const unreadable of reducer.unreadable) {
        // A return with no readable tag at all is an `unknown` finding of `reducers/state-unreachable`.
        if (unreadable.kind !== "whole") continue;
        ctx.report({
          message: fitted((cut) =>
            unreadable.constant
              ? `stateward cannot tell which state the constant \`${cut.name(unreadable.text)}\` is in`
              : `stateward cannot tell which states \`${cut.name(unreadable.text)}\` returns`,
          ),
          hint: shorten(
            unreadable.constant
              ? `type it with the state it starts in, e.g. \`const ${unreadable.text}: ${example} = …\``
              : `declare its return type as the states it returns, e.g. \`${example}\``,
            MAX_HINT,
          ),
          location: at(machine.file, unreadable),
          related: [
            { location: at(machine.file, reducer.at), message: `in \`${shorten(reducer.name)}\`` },
          ],
          findingKind: "whole-return",
        });
      }
      for (const { file, use } of machine.unreadStarts) {
        ctx.report({
          message: fitted(
            (cut) => `${name(cut)} can start in any state: this start is not a known state`,
          ),
          hint: "start from a constant state, or list where it starts with `@initial` on the reducer",
          location: at(file, use.at),
          related: [
            {
              location: at(machine.file, reducer.at),
              message: `\`${shorten(reducer.name)}\` is declared here`,
            },
          ],
          findingKind: "unknown-start",
        });
      }
      const prosed = [
        ...(reducer.final?.prose === true
          ? [{ tag: "final", at: reducer.final.at, file: reducer.stateFile, on: reducer.stateName }]
          : []),
        ...(reducer.initial?.prose === true
          ? [{ tag: "initial", at: reducer.initial.at, file: machine.file, on: reducer.name }]
          : []),
      ];
      for (const { tag, at: place, file, on } of prosed) {
        const key = `${file}:${String(place.start)}`;
        if (proseSeen.has(key)) continue;
        proseSeen.add(key);
        ctx.report({
          message: fitted(
            (cut) =>
              `\`@${tag}\` on \`${cut.name(on)}\` should list states in quotes: \`@${tag} ${quoted(reducer.tags[0] ?? "")}\``,
          ),
          hint: shorten(
            `quote each state, e.g. \`@${tag} ${reducer.tags.slice(0, 2).map(quoted).join(" | ")}\``,
            MAX_HINT,
          ),
          location: at(file, place),
          related: [],
          findingKind: "unquoted-tag",
        });
      }
      for (const bad of machine.badInitial) {
        const initial = reducer.initial;
        if (initial === null) continue;
        ctx.report({
          message: fitted(
            (cut) =>
              `\`@initial\` names ${quoted(bad)}, which is not a state of \`${cut.name(reducer.stateName)}\``,
          ),
          hint: shorten(`use one of: ${reducer.tags.map(quoted).join(", ")}`, MAX_HINT),
          location: at(machine.file, initial.at),
          related: [],
          findingKind: "unknown-initial",
        });
      }
      if (unstarted) {
        ctx.report({
          message: fitted((cut) => `stateward cannot tell where ${name(cut)} starts`),
          hint: shorten(
            `add \`/** @initial ${reducer.tags[0] ?? "start"} */\` to \`${reducer.name}\``,
            MAX_HINT,
          ),
          location: at(machine.file, reducer.at),
          related: machine.references.map(({ file, reference }) => ({
            location: at(file, reference.at),
            message: reference.kind === "call" ? "called here" : "handed on here",
          })),
          findingKind: "may-start-anywhere",
        });
      } else if (reducer.initial === null && (machine.references.length > 0 || reducer.external)) {
        const outside =
          machine.references.length > 0
            ? "also used outside `useReducer`"
            : "exported from the package";
        ctx.report({
          message: fitted((cut) => `${name(cut)} is ${outside}, so it may start anywhere`),
          hint: "list its starts with `@initial`, or call it only through `useReducer`",
          location: at(machine.file, reducer.at),
          related: machine.references.map(({ file, reference }) => ({
            location: at(file, reference.at),
            message: reference.kind === "call" ? "called here" : "handed on here",
          })),
          findingKind: "may-start-anywhere",
        });
      }
    }
  },
});
