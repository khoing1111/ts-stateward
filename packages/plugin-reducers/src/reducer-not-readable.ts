import { defineRule, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at } from "./notes.js";
import { summarizeFile, type Reducer } from "./summary.js";
import { markInitialReferences } from "./tag-reads.js";

/**
 * A finding about `@initial` is against the reducer it is on (the reference ledger's id): a stated
 * guarantee, so an error while the rule is on, as `guarantees` reads it.
 */
function againstInitial(file: string, reducer: Reducer) {
  return { against: [{ file, start: reducer.declared, end: reducer.declared }], ...STATED };
}

const STATED: { readonly stated: true } = { stated: true };
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

Write the steps in the reducer itself. A helper that gives back the state it is passed, as \`advance\` does, cannot say so in its return type; one that only builds new states can name them (\`Extract<JobState, { status: "running" | "done" }>\`). A start or a constant that is one state gets the same kind of type, and the rule's \`severities\` option turns the kind off where any state is meant:

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
- a \`useReducer\` start that is not a known state: a parameter, a call, data from storage, unless the reducer lists where it starts with \`/** @initial "queued" | "running" */\`;
- a reducer-like function passed around as a value (\`reducers = [queueReducer]\`), without \`useReducer\` or \`@initial\`;
- a reducer also called or passed around elsewhere (outside tests), or exported from your package, without \`@initial\`: it may start in any state;
- a \`useReducer\` start in a state the reducer's \`@initial\` does not list (\`useReducer(light, { color: "yellow" })\` with \`@initial "red"\`, or an \`init\` function that returns it): the tag says where it starts, so a start it leaves out is reported. \`stateward guarantees\` lists \`@initial\` as "not checked" at a start it cannot read, a reducer given to another function or another name, and a direct call of the reducer in a state the tag does not list;
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
    proves: { tags: ["initial"] },
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
          "start-not-listed":
            "a `useReducer` start in a state the reducer's `@initial` does not list.",
        },
        description: "A severity per kind of place stateward cannot read.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: (ctx) => {
    markInitialReferences(ctx);
    return summarizeFile(ctx);
  },
  check(summaries, ctx) {
    const proseSeen = new Set<string>();
    for (const machine of machinesOf(summaries)) {
      const { reducer } = machine;
      const unstarted =
        !machine.active && machine.references.some(({ reference }) => reference.kind === "value");
      if (!machine.active && !unstarted) continue;
      const name = (cut: { name: (text: string) => string }): string =>
        `\`${cut.name(reducer.name)}\``;
      // The first state, as the one the `@initial` example lists; the developer lists their own.
      const example = quoted(reducer.tags[0] ?? "");
      // The state type with its tag named and the states left for you to list: `…` is yours to fill.
      const subset = `Extract<${reducer.stateName}, { ${reducer.tag}: … }>`;
      const off =
        '- or, if it may be any state on purpose, turn this kind off: `severities: { "whole-return": "off" }` in the rule\'s options';
      for (const unreadable of reducer.unreadable) {
        // A return with no readable tag at all is an `unknown` finding of `reducers/state-unreachable`.
        if (unreadable.kind !== "whole") continue;
        const callee = /^([\w$.]+)\(/.exec(unreadable.text)?.[1];
        ctx.report({
          message: fitted((cut) =>
            unreadable.constant
              ? `constant \`${cut.name(unreadable.text)}\` can be any state of \`${cut.name(reducer.stateName)}\``
              : `\`${cut.name(unreadable.text)}\` can return any state of \`${cut.name(reducer.stateName)}\``,
          ),
          hint: unreadable.constant
            ? [
                "one of",
                `- type it with the state it holds, \`${subset}\`, and make whatever builds it give that type`,
                off,
              ].join("\n")
            : [
                "one of",
                callee === undefined
                  ? "- write its steps in the reducer, so each state it gives is read"
                  : fitted(
                      (cut) =>
                        `- write the steps of \`${cut.name(callee)}\` in the reducer, so each state it gives is read`,
                    ),
                `- or declare its return type as the states it gives, \`${subset}\`: only if it never gives back the state it is passed, which a return type cannot say`,
                off,
              ].join("\n"),
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
          hint: [
            "one of",
            "- start from a constant state",
            `- or list, quoted, the states it can start in, above \`${reducer.name}\` (for example one state):`,
            `    /** @initial ${example} */`,
          ].join("\n"),
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
      for (const { file, use, tags } of machine.unlistedStarts) {
        const initial = reducer.initial;
        if (initial === null) continue;
        const states = tags.map(quoted).join(", ");
        ctx.report({
          message: fitted(
            (cut) =>
              `\`useReducer\` starts \`${cut.name(reducer.name)}\` in ${states}, which \`@initial\` does not list`,
          ),
          hint: shorten(
            `list it, quoted: \`@initial ${[...initial.names, ...tags].map(quoted).join(" | ")}\`, or start the reducer in a state \`@initial\` lists`,
            MAX_HINT,
          ),
          location: at(file, use.at),
          related: [
            { location: at(machine.file, initial.at), message: "`@initial` is stated here" },
          ],
          findingKind: "start-not-listed",
          ...againstInitial(machine.file, reducer),
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
          ...againstInitial(machine.file, reducer),
        });
      }
      if (unstarted) {
        ctx.report({
          message: fitted((cut) => `${name(cut)} can start in any state: no start is known`),
          hint: [
            `list, quoted, the states it can start in, above \`${reducer.name}\` (for example one state):`,
            `    /** @initial ${example} */`,
          ].join("\n"),
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
          hint: [
            "one of",
            `- list, quoted, the states it can start in, above \`${reducer.name}\` (for example one state):`,
            `    /** @initial ${example} */`,
            "- or call it only through `useReducer`",
          ].join("\n"),
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
