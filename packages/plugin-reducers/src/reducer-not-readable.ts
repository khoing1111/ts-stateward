import { defineRule, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at } from "./notes.js";
import { summarizeFile } from "./summary.js";
import { fitted, MAX_HINT, shorten } from "./text.js";

const EXPLAIN = `# reducers/reducer-not-readable

The reducer checks skip a place whose states cannot be read; a type that names its states brings it back under those checks.

\`\`\`ts example-bad
import { useReducer } from "react";

type JobState = { status: "queued" } | { status: "running" } | { status: "done" };
type JobEvent = { type: "start" } | { type: "finish" };

function advance(state: JobState, event: JobEvent): JobState {
  if (event.type === "start") return state.status === "queued" ? { status: "running" } : state;
  return state.status === "running" ? { status: "done" } : state;
}

function job(state: JobState, event: JobEvent): JobState {
  return advance(state, event);
}

export function useJob() {
  return useReducer(job, { status: "queued" });
}
\`\`\`

Write the steps in the reducer itself, or give the helper a return type that names its states (\`Extract<JobState, { status: "running" | "done" }>\`):

\`\`\`ts example-good
import { useReducer } from "react";

type JobState = { status: "queued" } | { status: "running" } | { status: "done" };
type JobEvent = { type: "start" } | { type: "finish" };

function job(state: JobState, event: JobEvent): JobState {
  if (event.type === "start") return state.status === "queued" ? { status: "running" } : state;
  return state.status === "running" ? { status: "done" } : state;
}

export function useJob() {
  return useReducer(job, { status: "queued" });
}
\`\`\`

There is no quick fix: only you know which states the helper gives.

## Why it matters

\`reducers/state-unreachable\` and \`reducers/state-cannot-leave\` read which state each \`return\` of a reducer gives, and where it starts. Where they cannot read it (a helper typed as the whole union, a start loaded from storage), they assume any state can follow or come first, and say nothing. This rule lists those places, each with the change that makes the reducer fully checked. It is what those two rules would otherwise pass over in silence.

## What it does not catch

It reports:

- a \`return\` typed as the whole state union, like \`return advance(state, event)\` above. A returned constant is read from its value (\`const initialState: State = { status: "idle" }\`), and reported only when that value cannot be read either (\`const restored: State = restore()\`);
- a \`useReducer\` start that is not a known state: a parameter, a call, data from storage;
- a reducer-like function passed around as a value (\`reducers = [queueReducer]\`), without \`useReducer\` or \`@initial\`;
- a reducer also called or passed around elsewhere (outside tests), or exported from your package, without \`@initial\`: it may start in any state;
- a name in \`@initial\` that is not a state, and a \`@final\` or \`@initial\` that does not start with a quoted state (\`@final the order is done\` is read as a comment; write \`@final "delivered" | "refunded"\`).

It leaves alone a start of \`null\` or \`undefined\` when the state type includes it (\`useReducer(selectionReducer, null)\`): it is a known start, which the other two rules read as any state coming first. It skips a setter, a reducer whose every \`return\` gives a property of the action typed as the whole state (\`return action.payload\` with \`payload: Selection\`), \`null\`, \`undefined\` or the state unchanged: its states are what the caller sends, so none of the reducers rules reads it; one \`return\` that builds a state (\`return { status: "loading" }\`) makes it a state machine again. It also leaves alone a function with a reducer's signature that is never used or only called as a helper, a \`return\` typed \`any\` (\`reducers/state-unreachable\` reports that one), and state in \`useState\` or class fields, which do not have to become reducers.

## Getting the best from it

For a reducer that does not run through \`useReducer\`, give its state a default (\`state = initialQueue\`), or put \`/** @initial "queued" */\` above it.

## Turn it on or off

It shows as info under \`recommended\` (a hint in the editor that does not fail the check) and as an error under \`strict\`, for projects where every reducer must be fully checked.

\`\`\`ts
rules: { "reducers/reducer-not-readable": "off" } // or "warning"
rules: { "reducers/reducer-not-readable": ["info", { severities: { "may-start-anywhere": "off" } }] } // a library's exported reducers
\`\`\`
`;

export const reducerNotReadable = defineRule({
  kind: "project",
  meta: {
    description:
      "The reducer checks skip a place whose states cannot be read; a type that names its states brings it back under those checks.",
    summary:
      "a reducer, or a `return` in one, whose states cannot be read, so the reducer checks skip it",
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
              ? `constant \`${cut.name(unreadable.text)}\` can be any state of \`${cut.name(reducer.stateName)}\``
              : `\`${cut.name(unreadable.text)}\` can return any state of \`${cut.name(reducer.stateName)}\``,
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
            (cut) => `${name(cut)} can start in any state: the state it starts from is not known`,
          ),
          hint: "start from a constant state, or list where it starts with `@initial` on the reducer",
          location: at(file, use.at),
          related: [
            {
              location: at(machine.file, reducer.at),
              message: `\`${shorten(reducer.name)}\` is declared`,
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
            (cut) => `\`@${tag}\` on \`${cut.name(on)}\` lists states without quotes`,
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
          message: fitted((cut) => `${name(cut)} can start in any state: no start is known`),
          hint: shorten(
            `add \`/** @initial ${reducer.tags[0] ?? "start"} */\` to \`${reducer.name}\``,
            MAX_HINT,
          ),
          location: at(machine.file, reducer.at),
          related: machine.references.map(({ file, reference }) => ({
            location: at(file, reference.at),
            message: reference.kind === "call" ? "called" : "handed on",
          })),
          findingKind: "may-start-anywhere",
        });
      } else if (reducer.initial === null && (machine.references.length > 0 || reducer.external)) {
        const outside =
          machine.references.length > 0
            ? "also used outside `useReducer`"
            : "exported from the package";
        ctx.report({
          message: fitted((cut) => `${name(cut)} can start in any state: it is ${outside}`),
          hint: "list its starts with `@initial`, or call it only through `useReducer`",
          location: at(machine.file, reducer.at),
          related: machine.references.map(({ file, reference }) => ({
            location: at(file, reference.at),
            message: reference.kind === "call" ? "called" : "handed on",
          })),
          findingKind: "may-start-anywhere",
        });
      }
    }
  },
});
