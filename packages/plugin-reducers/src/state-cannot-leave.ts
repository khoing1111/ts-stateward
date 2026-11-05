import { defineRule, matchesName, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at, finalFix, pathNotes } from "./notes.js";
import { summarizeFile } from "./summary.js";
import { fitted, MAX_HINT, shorten } from "./text.js";

const EXPLAIN = `# reducers/state-cannot-leave

A state a reducer reaches but never leaves is marked final, so a missing way out does not go unnoticed.

## Why

A state nothing leaves is where the user stays for good: a payment that failed with no retry and no cancel, an upload that errored with no way to start again. Sometimes that is meant (a paid order is done); then say so with a \`FINAL_STATES\` constant, or \`@final\` on the state type. When it is not meant, an event is missing, and this rule finds it.

## When to use it

Use it for reducers whose state is a union with a tag like \`status\` or \`kind\`, passed to \`useReducer\` or marked \`@initial\`. It is a warning in every preset, since a dead end may be on purpose until \`@final\` says so.

## What it catches

- A state the reducer reaches and never leaves, not listed in \`@final\`. The message shows the path that reaches it.
- A name in \`@final\` that is not a state of the type (\`@final "payed"\`).
- A state in \`@final\` that the reducer does leave, from a branch that checks the state (\`switch (state.status)\`, an \`if\` on it).

### Say it in code: a \`FINAL_STATES\` constant

A top-level \`const\` in the reducer's module whose name ends with \`FINAL_STATES\` or \`FINAL_STATUSES\`, typed \`as const satisfies readonly State["tag"][]\`, marks its states final. TypeScript checks the names against the union, so a misspelt state does not compile:

\`\`\`ts
export const CHECKOUT_FINAL_STATES = ["paid", "cancelled"] as const satisfies readonly CheckoutState["status"][];
\`\`\`

A constant without the \`satisfies\` is not read: nothing would check its names. \`@final\` keeps working (JSDoc, which TypeScript does not check; stateward does); the two add up.

### Bad

\`\`\`ts
/** @final "paid" | "cancelled" */
type CheckoutState =
  | { status: "cart" }
  | { status: "paying" }
  | { status: "paymentFailed" } // reached on \`paymentFailed\`, nothing leaves it
  | { status: "paid" }
  | { status: "cancelled" };
\`\`\`

### Good

Handle an event that leaves \`"paymentFailed"\` (a retry, a cancel), or list it: \`/** @final "paid" | "cancelled" | "paymentFailed" */\`.

### Fix

A quick fix adds the state to the \`FINAL_STATES\` constant when the reducer's module has one (one name a line, if the others are), else to \`@final\`, or adds the \`@final\` comment above the type. It changes nothing at run time; use it only when the dead end is meant.

## What it does not catch

- A reducer with no \`useReducer\` call and no \`@initial\`.
- A way out that depends on data (\`if (state.attempt < 3)\`): both branches count as possible.
- A final state left by a return that does not check which state it is in: that return counts as leaving every state, so it is not held against \`@final\`.
- State in \`useState\` or class fields, and nested or parallel states.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "reducers/state-cannot-leave": "off" } // or "error"
groups: { "machines/graph": "off" } // the whole group
rules: { "reducers/state-cannot-leave": ["warning", { finalStates: ["done", "cancelled"] }] } // final in every reducer
\`\`\`
`;

export const stateCannotLeave = defineRule({
  kind: "project",
  meta: {
    description:
      "A state a reducer reaches but never leaves is marked final, so a missing way out does not go unnoticed.",
    defaultSeverity: "warning",
    tier: "core",
    group: "graph",
    needsJsDoc: true,
    options: {
      finalStates: option.strings({
        default: [],
        description:
          "State names that are final in every reducer, as if listed in `@final` (done, cancelled, closed*).",
      }),
      severities: option.severities({
        kinds: {
          "never-left": "a state the reducer reaches and never leaves, not marked final.",
          "final-left": "a state marked `@final` that the reducer does leave.",
          "unknown-final": "a name in `@final` that is not a state of the type.",
        },
        description: "A severity per kind of finding.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: summarizeFile,
  check(summaries, ctx) {
    const wrongNames = new Set<string>();
    for (const machine of machinesOf(summaries)) {
      if (!machine.active) continue;
      const { reducer } = machine;
      const { finalConst } = reducer;
      const final = [...(reducer.final?.names ?? []), ...(finalConst?.names ?? [])];
      for (const name of reducer.final?.names ?? []) {
        const key = `${reducer.stateFile}:${String(reducer.final?.at.start)}:${name}`;
        if (reducer.tags.includes(name) || reducer.final === null || wrongNames.has(key)) continue;
        wrongNames.add(key);
        ctx.report({
          message: fitted(
            (cut) =>
              `\`@final\` names ${quoted(name)}, which is not a state of \`${cut.name(reducer.stateName)}\``,
          ),
          hint: shorten(`use one of: ${reducer.tags.map(quoted).join(", ")}`, MAX_HINT),
          location: at(reducer.stateFile, reducer.final.at),
          related: [],
          findingKind: "unknown-final",
        });
      }
      for (const tag of reducer.tags) {
        const outgoing = machine.out.get(tag) ?? [];
        if (final.includes(tag)) {
          const leaves = outgoing.find((hop) => hop.edge.read);
          // Where the state is marked final: the const when it lists the state, else `@final`.
          const markedIn =
            finalConst?.names.includes(tag) === true
              ? { file: machine.file, at: finalConst.at, label: finalConst.name }
              : reducer.final === null
                ? undefined
                : { file: reducer.stateFile, at: reducer.final.at, label: "@final" };
          if (leaves === undefined || markedIn === undefined) continue;
          const event = leaves.edge.event;
          const label = markedIn.label === "@final" ? "`@final`" : `\`${markedIn.label}\``;
          ctx.report({
            message: fitted(
              (cut) =>
                `${quoted(tag)} is marked final, but \`${cut.name(reducer.name)}\` leaves it${
                  event === null ? "" : ` on \`${cut.name(event)}\``
                }`,
            ),
            hint: fitted((cut) =>
              event === null
                ? `remove ${quoted(tag)} from ${label}, or stop leaving it`
                : `remove ${quoted(tag)} from ${label}, or stop handling \`${cut.name(event)}\` in ${quoted(tag)}`,
            ),
            location: at(machine.file, leaves.edge),
            related: [
              {
                location: at(markedIn.file, markedIn.at),
                message: `${quoted(tag)} is marked final here`,
              },
            ],
            findingKind: "final-left",
          });
          continue;
        }
        if (!machine.reached.has(tag) || outgoing.length > 0) continue;
        if (matchesName(tag, ctx.options.finalStates)) continue;
        const fix = finalFix(machine, tag);
        ctx.report({
          message: fitted(
            (cut) => `\`${cut.name(reducer.name)}\` reaches ${quoted(tag)} but never leaves it`,
          ),
          hint: fitted((cut) =>
            fix === undefined
              ? finalConst === null
                ? `handle an event that leaves ${quoted(tag)}, or add it to \`@final\` on \`${cut.name(reducer.stateName)}\``
                : `handle an event that leaves ${quoted(tag)}, or add it to \`${cut.name(finalConst.name)}\``
              : `handle an event that leaves ${quoted(tag)}, or mark it final (quick fix available)`,
          ),
          location: at(machine.file, reducer.at),
          related: pathNotes(machine, tag),
          fixes: fix === undefined ? [] : [fix],
          findingKind: "never-left",
        });
      }
    }
  },
});
