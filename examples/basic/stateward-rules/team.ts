import ts from "@stateward/core/typescript";
import { definePlugin, defineRule, option } from "@stateward/core";

const EXPLAIN = `# team/max-union-members

A union with many members is hard to keep complete: every \`switch\` over it needs a case for each
one, and adding a member touches many places. Past a limit (the \`max\` option, 12 by default), split
the union into nested unions by kind, so each \`switch\` handles one group.

## Bad

\`\`\`ts
type AppEvent = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m";
\`\`\`

## Good

\`\`\`ts
type AppEvent = UserEvent | SystemEvent;
type UserEvent = "click" | "key" | "scroll";
type SystemEvent = "load" | "timeout" | "error";
\`\`\`

## Change the limit

\`\`\`ts
rules: { "team/max-union-members": ["warning", { max: 8 }] }
\`\`\`
`;

export const maxUnionMembers = defineRule({
  kind: "file",
  meta: {
    description: "A type alias whose union has more members than the team's limit.",
    defaultSeverity: "warning",
    tier: "core",
    group: "unions",
    options: {
      max: option.number({
        default: 12,
        min: 1,
        integer: true,
        description: "The most members a union may have before it should be split.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node) && ts.isUnionTypeNode(node.type)) {
        const count = node.type.types.length;
        if (count > ctx.options.max) {
          const name = node.name.text;
          ctx.report({
            node: node.name,
            message: `\`${name}\` has ${String(count)} members; above ${String(ctx.options.max)}, switches over it get hard to keep complete`,
            hint: [
              "split it into nested unions by kind",
              `    type ${name} = UserEvent | SystemEvent;`,
              "    type UserEvent = Click | Key | …;",
              "    type SystemEvent = Load | Timeout | …;",
            ].join("\n"),
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
