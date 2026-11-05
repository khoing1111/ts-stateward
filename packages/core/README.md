# @stateward/core

The engine of [stateward](https://github.com/khoing1111/ts-stateward#readme) and the API for
writing rules of your own: a convention your team keeps that no pack checks (a limit, a naming
rule, a call nobody should make). Your rule lives next to your code, loads from
`stateward.config.ts`, and reports in the terminal, in CI and in VS Code like any bundled rule.

`stateward` installs this package; add it yourself only to write a rule, at the same version as
`stateward`:

```bash
npm install --save-dev @stateward/core
```

## What it exports

- `defineRule`, `definePlugin` and `option`: a rule, the plugin that holds it, and its options.
- `@stateward/core/typescript`: the TypeScript that stateward reads with. Import it, never your
  app's `typescript`.
- `@stateward/core/testing`: `checkFixture` to run a rule on a small project in a test, and
  `expectMessageStandard` to check its messages.

## Example

A rule that warns when a union has more members than the team allows:

```ts
// stateward-rules/team.ts
import ts from "@stateward/core/typescript";
import { definePlugin, defineRule, option } from "@stateward/core";

export const maxUnionMembers = defineRule({
  kind: "file", // one file at a time; "project" looks across files
  meta: {
    description: "A type alias whose union has more members than the team's limit.",
    defaultSeverity: "warning",
    tier: "core",
    group: "unions",
    options: {
      max: option.number({ default: 12, min: 1, integer: true, description: "Most members." }),
    },
    explain: "# team/max-union-members\n…", // the page `stateward explain` shows
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

Load it in `stateward.config.ts`; the rule's id is the plugin's name, a slash, and its key:

```ts
import { defineConfig } from "stateward";
import { team } from "./stateward-rules/team.js";

export default defineConfig({
  plugins: [team],
  rules: { "team/max-union-members": ["warning", { max: 12 }] },
});
```

Then `npx stateward check --rule team/max-union-members`.

## Docs

- [Write a rule of your own](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/write-your-own-rule.md):
  options, tests, messages, quick fixes, and what to do when the rule cannot tell.
- [The bundled rules](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md):
  check them first; what you want may be an option of one.
