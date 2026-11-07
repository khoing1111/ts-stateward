import { defineRule, matchesName, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at, finalFix, pathNotes } from "./notes.js";
import { summarizeFile } from "./summary.js";
import { fitted, MAX_HINT, shorten } from "./text.js";

const EXPLAIN = `# reducers/state-cannot-leave

A reducer state with no way out keeps the user there for good, such as a failed payment with no retry; marking it final records that this is intended.

\`\`\`ts example-bad
import { useReducer } from "react";

/** @final "paid" */
type PaymentState = { status: "paying" } | { status: "failed" } | { status: "paid" };
type PaymentEvent = { type: "succeeded" } | { type: "declined" };

function payment(state: PaymentState, event: PaymentEvent): PaymentState {
  if (state.status !== "paying") return state;
  return event.type === "succeeded" ? { status: "paid" } : { status: "failed" };
}

export function usePayment() {
  return useReducer(payment, { status: "paying" });
}
\`\`\`

Add the event that leaves the state (a retry, a cancel):

\`\`\`ts example-good
import { useReducer } from "react";

/** @final "paid" */
type PaymentState = { status: "paying" } | { status: "failed" } | { status: "paid" };
type PaymentEvent = { type: "succeeded" } | { type: "declined" } | { type: "retry" };

function payment(state: PaymentState, event: PaymentEvent): PaymentState {
  if (event.type === "retry") return state.status === "failed" ? { status: "paying" } : state;
  if (state.status !== "paying") return state;
  return event.type === "succeeded" ? { status: "paid" } : { status: "failed" };
}

export function usePayment() {
  return useReducer(payment, { status: "paying" });
}
\`\`\`

Or, when the dead end is meant, mark it final: \`/** @final "paid" | "failed" */\`. A quick fix does that: it adds the state to the module's \`FINAL_STATES\` constant when there is one (one name a line, if the others are), else to \`@final\`, or adds the \`@final\` comment above the type. It changes nothing at run time; use it only when the dead end is meant.

## Why it matters

A state nothing leaves is where the user stays for good: a payment that failed with no retry and no cancel, an upload that errored with no way to start again. Sometimes that is meant (a paid order is done), and then the code should say so. When it is not meant, an event is missing, and this rule finds it.

## What it does not catch

It reports a state the reducer reaches and never leaves, not marked final (the message shows the path that reaches it); a name in \`@final\` that is not a state of the type (\`@final "payed"\`); and a state in \`@final\` that the reducer does leave, from a branch that checks the state (\`switch (state.status)\`, an \`if\` on it). It does not see:

- a reducer with no \`useReducer\` call and no \`@initial\`;
- a way out that depends on data (\`if (state.attempt < 3)\`): both branches count as possible;
- a final state left by a return that does not check which state it is in: that return counts as leaving every state, so it is not held against \`@final\`;
- state in \`useState\` or class fields, and nested or parallel states.

## Getting the best from it

Say which states are final in code TypeScript checks: a top-level \`const\` in the reducer's module whose name ends with \`FINAL_STATES\` or \`FINAL_STATUSES\`, typed \`as const satisfies readonly State["tag"][]\`. A misspelt state then does not compile:

\`\`\`ts
export const CHECKOUT_FINAL_STATES = ["paid", "cancelled"] as const satisfies readonly CheckoutState["status"][];
\`\`\`

A constant without the \`satisfies\` is not read, since nothing would check its names. \`@final\` on the state type keeps working (TypeScript does not check JSDoc; stateward does), and the two add up. Write states in quotes, separated by \`|\`, commas or spaces.

## Turn it on or off

\`\`\`ts
rules: { "reducers/state-cannot-leave": "off" } // or "error"
rules: { "reducers/state-cannot-leave": ["warning", { finalStates: ["done", "cancelled"] }] } // final in every reducer
\`\`\`
`;

export const stateCannotLeave = defineRule({
  kind: "project",
  meta: {
    description:
      "A reducer state with no way out keeps the user there for good, such as a failed payment with no retry; marking it final records that this is intended.",
    summary: "a reducer state that nothing leaves and that is not marked final",
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
                message: `${quoted(tag)} is marked final`,
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
