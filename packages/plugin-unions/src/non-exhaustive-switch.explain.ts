/** The rule page of `unions/non-exhaustive-switch` (`stateward explain`, docs/rules). */
export const EXPLAIN = `# unions/non-exhaustive-switch

Every \`switch\` over a union handles every case: a \`switch\` without a \`default\` lists them all, and a \`default\` handles only the cases it allows, so a case added later is reported where it is not handled.

\`\`\`ts example-bad
type Folder = "inbox" | "archive" | "newsletters";

export function title(folder: Folder): string {
  switch (folder) {
    case "inbox":
      return "Inbox";
    case "archive":
      return "Archive";
    default:
      return "Mail";
  }
}
\`\`\`

Give the case its own \`case\`:

\`\`\`ts example-good
type Folder = "inbox" | "archive" | "newsletters";

export function title(folder: Folder): string {
  switch (folder) {
    case "inbox":
      return "Inbox";
    case "archive":
      return "Archive";
    case "newsletters":
      return "Newsletters";
    default:
      return "Mail";
  }
}
\`\`\`

Or, when the \`default\` is right for it, allow it there. The check is plain TypeScript, so \`tsc\` also fails when \`folder\` can be anything else in the \`default\`:

\`\`\`ts
    default:
      void (folder satisfies "newsletters");
      return "Mail";
\`\`\`

The quick fixes write either one: "Add the missing case" puts \`case "newsletters":\` before the \`default\`, so it runs the same code until you give it its own, and "Allow "newsletters" in \`default\`" writes the \`satisfies\` line. \`check --fix\` applies neither: which one is right is a decision about the code.

A \`switch\` without a \`default\` must list every case. When TypeScript already reports the missing case (the \`switch\` ends a function that must return a value: TS2366, or TS7030 with \`noImplicitReturns\`), stateward does not report it again:

\`\`\`text
error[unions/non-exhaustive-switch]: \`switch\` on \`folder\` does not handle "newsletters"
  = fix: one of
      - add \`case "newsletters":\` with its own code
      - or add \`default:\` that allows it: \`default: void (folder satisfies "newsletters");\`
\`\`\`

A \`default\` that cannot be reached because every case is listed is correct and not reported. \`folder satisfies never\` in a \`default\` is read like a plain \`default\`: it is not needed with the rule on, and an existing one can stay.

## Why it matters

A \`default\` takes every case the \`switch\` does not list, including the ones added later. When \`Folder\` gains \`"spam"\`, the code still compiles and spam is titled "Mail". With the rule on, \`"spam"\` is reported at every \`switch\` that does not handle it or allow it.

## What it does not catch

- A \`switch\` over a type with no fixed set of values (\`string\`, \`number\`, an object), \`switch (true)\` and \`switch (typeof x)\`.
- A union declared in a package or in TypeScript's lib, unless \`projectTypesOnly\` is \`false\`.
- An \`if\` chain. To make one handle every case, end it with \`else { status satisfies never; }\` (TypeScript enforces it) or write it as a \`switch\`.

## Getting the best from it

**Open unions.** A union that comes from outside the code (a status from a server, an event type from a package) can gain members at run time. State it where it enters, with a type in your \`src/guarantees.ts\`:

\`\`\`ts
export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };

export type OrderStatus = OpenUnion<"pending" | "paid" | "shipped">;
\`\`\`

Every \`switch\` on an \`OrderStatus\` must then have a \`default\` that handles a value it does not list; a \`switch\` without one is an error:

\`\`\`text
error[unions/non-exhaustive-switch]: \`switch\` on \`status\` does not handle a value outside \`OrderStatus\`, which is open
\`\`\`

\`stateward guarantees\`, the hover and the code lens list each open union with its switches.

A \`default\` that handles more than 5 cases (\`maxHidden\`), or a \`switch\` without one that misses more than 5, is reported as info: it often means "everything else". To keep a \`switch\` without a \`default\` unreported, set its kinds' severity: \`severities: { missing: "off", "many-missing": "off" }\`. To accept one \`switch\` with a reason, put \`// stateward-ignore unions/non-exhaustive-switch: <why>\` above it.

## Turn it on or off

\`\`\`ts
rules: { "unions/non-exhaustive-switch": "off" } // or "warning"
rules: { "unions/non-exhaustive-switch": ["error", { ignore: ["*Event"], maxHidden: 3 }] }
\`\`\`

Before 1.2 this rule was \`unions/default-hides-cases\`; the old id still works, with a warning.
`;
