import { defineRule, matchesName, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at, startNotes } from "./notes.js";
import { summarizeFile } from "./summary.js";
import { fitted } from "./text.js";

const EXPLAIN = `# reducers/state-unreachable

A reducer state that no event leads to is code that can never run, often a step that was planned and not written.

\`\`\`ts example-bad
import { useReducer } from "react";

type CheckoutState = { status: "cart" } | { status: "review" } | { status: "paid" };
type CheckoutEvent = { type: "pay" } | { type: "reset" };

function checkout(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case "pay":
      return state.status === "cart" ? { status: "paid" } : state;
    case "reset":
      return { status: "cart" };
  }
}

export function useCheckout() {
  return useReducer(checkout, { status: "cart" });
}
\`\`\`

Add the event that leads to \`"review"\`, or remove \`"review"\` from the type:

\`\`\`ts example-good
import { useReducer } from "react";

type CheckoutState = { status: "cart" } | { status: "review" } | { status: "paid" };
type CheckoutEvent = { type: "review" } | { type: "pay" } | { type: "reset" };

function checkout(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case "review":
      return state.status === "cart" ? { status: "review" } : state;
    case "pay":
      return state.status === "review" ? { status: "paid" } : state;
    case "reset":
      return { status: "cart" };
  }
}

export function useCheckout() {
  return useReducer(checkout, { status: "cart" });
}
\`\`\`

There is no quick fix: which event leads there is your design.

## Why it matters

A state nothing leads to is dead code in the type: screens, styles and tests are written for it, and none of them can ever run. Usually a step was planned and never written, or removed from the reducer but not from the type. TypeScript treats every member of the union as possible, so it cannot tell you.

## When it says “not checked”

When a \`return\` is typed \`any\`, which state it gives is not known, and the rule lists it as not checked. Give it a type that names its states.

## What it does not catch

- A function that only has the shape \`(state, event) => state\`, with no \`useReducer\`, no default for its state and no \`@initial\`.
- A reducer whose start is not known (a parameter, a call, a value typed as the whole union), or that is also called or passed around elsewhere, or exported from your package, without \`@initial\`: any state may come first.
- A \`return\` typed as the whole union (a helper typed \`: CheckoutState\`): it counts as leading to every state.
- State in \`useState\` or class fields, nested or parallel states, and conditions on data (\`attempt > 3\`: both branches count).

\`reducers/reducer-not-readable\` lists the reducers and returns it cannot read, with the change that makes them checkable.

## Getting the best from it

Keep the state a union with a tag like \`status\` or \`kind\`, and let the rule see where it starts: the second argument of \`useReducer\` (a constant is followed to its value, in any file, and an \`init\` function through its returns), the default of the state parameter (\`(state = INITIAL_STATE, action) => …\`), or \`/** @initial "cart" */\` on the reducer, which wins over the default. It follows each \`return\` from the states the code around it allows (\`switch (state.status)\`, \`if (state.status !== "paying") return state\`).

## Turn it on or off

\`\`\`ts
rules: { "reducers/state-unreachable": "off" } // or "warning"
rules: { "reducers/state-unreachable": ["error", { ignoreStates: ["restored"] }] } // reached from outside the reducer
\`\`\`
`;

export const stateUnreachable = defineRule({
  kind: "project",
  meta: {
    description:
      "A reducer state that no event leads to is code that can never run, often a step that was planned and not written.",
    summary: "a state of a reducer's union that no event can lead to",
    defaultSeverity: "error",
    tier: "core",
    group: "graph",
    needsJsDoc: true,
    options: {
      ignoreStates: option.strings({
        default: [],
        description:
          "State names reached from outside the reducer (a restored session, a test setup), never reported (globs allowed).",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: summarizeFile,
  check(summaries, ctx) {
    for (const machine of machinesOf(summaries)) {
      if (!machine.active) continue;
      const { reducer } = machine;
      for (const unreadable of reducer.unreadable) {
        if (unreadable.kind !== "unknown") continue;
        ctx.unknown({
          message: fitted(
            (cut) =>
              `not checked: which state \`${cut.name(unreadable.text)}\` returns: its type is not one state of \`${cut.name(reducer.stateName)}\``,
          ),
          hint: `give it a type that is one of the states of \`${reducer.stateName}\`, such as \`Extract<${reducer.stateName}, …>\``,
          location: at(machine.file, unreadable),
        });
      }
      if (machine.startsAny) continue;
      for (const tag of reducer.tags) {
        if (machine.reached.has(tag) || matchesName(tag, ctx.options.ignoreStates)) continue;
        const from = reducer.edges.filter(
          (edge) => edge.to.includes(tag) && edge.from.some((source) => source !== tag),
        );
        const only = from.length > 0 ? [...new Set(from.flatMap((edge) => edge.from))].sort() : [];
        const cause =
          only.length > 0
            ? `only unreached ${only.map(quoted).join(", ")} lead${only.length === 1 ? "s" : ""} to it`
            : "no case returns it";
        const declared = reducer.tagAt[tag];
        ctx.report({
          message: fitted(
            (cut) => `\`${cut.name(reducer.name)}\` never reaches ${quoted(tag)}: ${cause}`,
          ),
          hint: fitted((cut) =>
            only.length > 0
              ? `make ${only.map(quoted).join(", ")} reachable, or remove ${quoted(tag)} from \`${cut.name(reducer.stateName)}\``
              : `add the event that leads to ${quoted(tag)}, or remove it from \`${cut.name(reducer.stateName)}\``,
          ),
          location: at(machine.file, reducer.at),
          related: [
            ...startNotes(machine),
            ...from.map((edge) => ({
              location: at(machine.file, edge),
              message: `returns ${quoted(tag)} only from ${edge.from
                .filter((source) => source !== tag)
                .map(quoted)
                .join(", ")}`,
            })),
            {
              location: at(reducer.stateFile, declared ?? reducer.stateAt),
              message: `${quoted(tag)} is declared`,
            },
          ],
        });
      }
    }
  },
});
