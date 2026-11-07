# Write a rule of your own

A team convention that no pack checks, such as a size limit, a naming rule or a banned call, can be
written as a rule. The rule is a file in the app's repository, loads from `stateward.config.ts`, and
reports in the terminal and in VS Code like any other. Check the [rule pages](../rules/) first; an
existing rule may already offer it as an option.

A rule needs stateward installed ([install.md](install.md)) and `@stateward/core` at the same
version as `stateward`:

```bash
npm install --save-dev @stateward/core
```

[examples/basic/stateward-rules/team.ts](../../examples/basic/stateward-rules/team.ts) is a complete
example.

## 1. Write the rule

This rule, in `stateward-rules/team.ts`, warns when a union has more members than the team's
limit:

```ts
import ts from "@stateward/core/typescript";
import { definePlugin, defineRule, option } from "@stateward/core";

export const maxUnionMembers = defineRule({
  kind: "file", // looks at one file at a time
  meta: {
    description: "A type alias whose union has more members than the team's limit.",
    defaultSeverity: "warning",
    tier: "core",
    group: "unions", // a config can set a whole group at once
    options: {
      max: option.number({ default: 12, min: 1, integer: true, description: "Most members." }),
    },
    explain: "# team/max-union-members\n…", // the page `stateward explain` shows, in Markdown
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type)) {
        const count = node.type.types.length;
        if (count > ctx.options.max) {
          ctx.report({
            node: node.name,
            message: `\`${node.name.text}\` has ${String(count)} members; above ${String(ctx.options.max)}, switches over it get hard to keep complete`,
            hint: "split it into nested unions by kind",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});

export const team = definePlugin({
  name: "team",
  description: "This team's own rules.",
  rules: { "max-union-members": maxUnionMembers },
});
```

Import TypeScript from `@stateward/core/typescript`, not the app's `typescript`. Another version
numbers the syntax kinds differently, so its checks match nothing; stateward warns when a rule does
this.
To ask about types, use `ctx.types`, not TypeScript's type checker.

A rule that looks across files uses `kind: "project"`;
[`ownership/state-written-outside-owner`](../../packages/plugin-ownership/src/state-written-outside-owner.ts)
is an example.

## 2. Load it

Add the plugin to `stateward.config.ts`. The rule's id is the plugin's name, a slash, and its key:

```ts
import { defineConfig } from "stateward";
import { team } from "./stateward-rules/team.js";

export default defineConfig({
  plugins: [team],
  rules: { "team/max-union-members": ["warning", { max: 12 }] },
});
```

## 3. Run it

```bash
npx stateward check --rule team/max-union-members
```

```text
warning[team/max-union-members]: `AppEvent` has 13 members; above 12, switches over it get hard to keep complete
 --> src/events.ts:2:13
  |
2 | export type AppEvent =
  |             ^^^^^^^^
  = fix: split it into nested unions by kind
  = docs: stateward explain team/max-union-members

1 warning in 5 files (1.2 s). Run `stateward explain <rule>` for details.
```

## 4. Test it

Put a small project in a folder (a `tsconfig.json` and a file or two) and check it with
`checkFixture`. `expectMessageStandard` fails when a message breaks the rules in
[Writing the message](#writing-the-message).

```ts
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { expect, it } from "vitest";
import { team } from "./team.js";

it("flags a union above the limit", () => {
  const { findings } = checkFixture("stateward-rules/fixtures/big", [team], {
    "team/max-union-members": ["warning", { max: 3 }],
  });
  expectMessageStandard(findings);
  expect(findings.map((finding) => finding.message)).toEqual([
    "`Big` has 4 members; above 3, switches over it get hard to keep complete",
  ]);
});
```

Test each option value that changes the result, and code the rule must leave alone.

## Options

Declare each option in `meta.options`. `ctx.options` holds the values, typed, with defaults filled
in.

| Builder                                                          | `ctx.options` holds                   |
| ---------------------------------------------------------------- | ------------------------------------- |
| `option.boolean({ default, description })`                       | `boolean`                             |
| `option.number({ default, description, min?, max?, integer? })`  | `number`                              |
| `option.string({ default, description, oneOf? })`                | `string`, or one of the `oneOf` values |
| `option.strings({ default, description })`                       | `readonly string[]`                   |
| `option.record({ default, description })`                        | names mapped to lists of strings      |
| `option.severities({ kinds, description })`                      | a severity per kind of finding        |

The config's types reject an unknown option or a value of the wrong type in the editor. Limits such as `min`
are checked when stateward runs:

```text
rules["team/max-union-members"].max must be a whole number of at least 1, got 0
```

A rule without `meta.options` refuses any option.

## Writing the message

- **`message`**: what is wrong, naming the user's code in backticks, one line of at most 100
  characters. No "You", no "!".
- **`hint`**: the change to make, one line of at most 140 characters, optionally followed by up to
  4 lines of fixed code, each indented by 4 spaces.
- **`related`** (`{ node, message }`): other places that matter, such as where a value was created.
- Longer explanation goes in `meta.explain`.

## Quick fixes

Offer a fix only when there is one clear change. A fix is a title and text edits:

```ts
ctx.report({
  node,
  message,
  hint,
  fixes: [
    {
      title: "Remove the `default`",
      edits: [{ location: { file: ctx.file, start, end }, newText: "" }],
      safe: true,
    },
  ],
});
```

stateward applies a fix to a copy of the code first and does not offer it if it adds a TypeScript
error on the lines it changes. `safe: true` says the fix cannot change behaviour, so `check --fix`
applies it; other fixes are offered in the editor only. When the code can be written several ways,
list the others in `alternatives`; stateward offers the first that compiles.

```ts
fixes: [{ ...checkOnObject, alternatives: [checkOnLocalConst] }],
```

## When the rule cannot tell

When the rule cannot decide about some code, call `ctx.unknown({ message, hint, node })` instead of
reporting nothing. The place then shows as not checked, not as a pass.
