import { defineRule, matchesName, option } from "@stateward/core";
import { machinesOf, quoted } from "./machines.js";
import { at, startNotes } from "./notes.js";
import { summarizeFile } from "./summary.js";
import { fitted } from "./text.js";

const EXPLAIN = `# reducers/state-unreachable

A state of a reducer that no event can lead to.

## Why

A state nothing leads to is dead code in the type: screens, styles and tests are written for it, and none of them can ever run. Usually a transition was planned and never written, or removed from the reducer but not from the type. TypeScript treats every member of the union as possible, so it cannot tell you.

## When to use it

Use it for reducers whose state is a union with a tag like \`status\` or \`kind\`, passed to \`useReducer\`, given a start as the default of its state (\`state = initialState\`), or marked \`@initial\`. It is on as an error in every preset; keep it on.

## What it catches

A state that no sequence of events reaches from where the reducer starts. The rule follows each \`return\`: which states it can give, from the states the surrounding code allows (\`switch (state.status)\`, \`if (state.status !== "paying") return state\`). It starts from the second argument of \`useReducer\` (a constant is followed to its value, in any file, and an \`init\` function through its returns) from the default of its state parameter (\`(state = INITIAL_STATE, action) => …\`, followed the same way; a constant can have any name, and \`INITIAL_STATE\` is the usual one), and from the states named in \`@initial\` on the reducer, which wins over the default.

### Bad

\`\`\`ts
/** @final "paid" | "cancelled" */
type CheckoutState =
  | { status: "cart" }
  | { status: "review" } // nothing returns it
  | { status: "paid" }
  | { status: "cancelled" };

function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  switch (event.type) {
    case "pay": return state.status === "cart" ? { status: "paid" } : state;
    case "cancel": return { status: "cancelled" };
  }
}
// useReducer(checkoutReducer, { status: "cart" })
\`\`\`

### Good

Add the event that leads to \`"review"\`, or remove \`"review"\` from \`CheckoutState\`.

### Fix

Add the missing transition, or remove the state. There is no quick fix: which event leads there is your design.

## What it does not catch

- A function that only has the shape \`(state, event) => state\`, with no \`useReducer\`, no default for its state and no \`@initial\`.
- A reducer whose start is not known (a parameter, a call, a value typed as the whole union), or that is also called or passed around elsewhere, or exported from your package, without \`@initial\`: any state may come first. \`reducers/reducer-not-readable\` points these out.
- State in \`useState\` or class fields, nested or parallel states, and conditions on data (\`attempt > 3\`: both branches count).
- A \`return\` typed as the whole union (a helper typed \`: CheckoutState\`): it counts as leading to every state; \`reducers/reducer-not-readable\` points it out.

When a \`return\` is typed \`any\`, the rule cannot tell which state it gives and says so in an info finding.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "reducers/state-unreachable": "off" } // or "warning"
groups: { "machines/graph": "off" } // the whole group
rules: { "reducers/state-unreachable": ["error", { ignoreStates: ["restored"] }] } // reached from outside the reducer
\`\`\`
`;

export const stateUnreachable = defineRule({
  kind: "project",
  meta: {
    description: "A state of a reducer that no event can lead to.",
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
            (cut) => `stateward cannot tell which state \`${cut.name(unreadable.text)}\` returns`,
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
              message: `${quoted(tag)} is declared here`,
            },
          ],
        });
      }
    }
  },
});
