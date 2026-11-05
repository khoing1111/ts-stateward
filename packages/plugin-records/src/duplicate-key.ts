import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext } from "@stateward/core";
import { fitted } from "./lookup-text.js";

const EXPLAIN = `# records/duplicate-key

A \`new Map([...])\` or \`new Set([...])\` written out in code has the same key twice.

## Why

\`new Map([["recent", a], ["recent", b]])\` keeps only \`b\`. Nothing fails: \`a\` is gone, and the code that read \`a\` from the map gets \`b\`. It usually happens when a long list of entries is copied and one key is not renamed. A \`Set\` with a repeated item works, but the repeat is a leftover that hides a mistake (a missing item).

## When to use it

Use it in any project. It only reports keys that are plain constants, so it does not guess, and it is an error under every preset.

## What it catches

A \`new Map([...])\` whose entries are written out as \`[key, value]\` pairs, or a \`new Set([...])\`, when two keys are the same constant: a string, a number, an enum member, or a \`const\` whose type is one value (\`const RECENT = "recent"\`). The finding is on the second key, and the first is listed as a related place. \`"recent"\` and \`RECENT\` are the same key when \`RECENT\` is \`"recent"\`.

### Bad

\`\`\`ts
const groups = new Map([
  ["recent", recentEmojis],
  ["people", peopleEmojis],
  ["recent", otherEmojis],
]);
\`\`\`

### Good

\`\`\`ts
const groups = new Map([
  ["recent", recentEmojis],
  ["people", peopleEmojis],
  ["custom", otherEmojis],
]);
\`\`\`

### Fix

Remove the entry that should lose, or give it the key it was meant to have. There is no quick fix: which of the two values is right is your call.

## What it does not catch

- An object literal with the same property twice: ESLint's \`no-dupe-keys\` (and TypeScript itself) reports that.
- A key that is not a constant (a variable of type \`string\`, a call), and entries added later with \`.set()\` or \`.add()\`.
- A list built elsewhere (\`new Map(entries)\`, \`new Map(Object.entries(x))\`) and entries that come from a spread.
- A \`Map\` or \`Set\` class of your own, and \`WeakMap\` / \`WeakSet\`.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "records/duplicate-key": "off" } // or "warning"
rules: { "records/duplicate-key": ["error", { ignore: ["*_ALIASES"] }] } // generated tables
groups: { "guards/lookups": "off" } // the whole group
\`\`\`
`;

type Kind = "Map" | "Set";
type Entry = { key: ts.Expression; id: string; label: string };

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
    ? unwrap(node.expression)
    : node;
}

/** `new Map` or `new Set` as the language defines them, not a class of the project with that name. */
function builtinKind(node: ts.NewExpression, ctx: FileContext): Kind | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  const name = node.expression.text;
  if (name !== "Map" && name !== "Set") return undefined;
  const symbol = ctx.types.symbolAt(node.expression);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declaration !== undefined && ctx.types.isOwnFile(declaration.file) ? undefined : name;
}

/** The key as a value: a string `"1"` and a number `1` are different keys of a Map. */
function entryOf(key: ts.Expression, ctx: FileContext): Entry | undefined {
  const found = ctx.types.literalsOf(key);
  if (found === "not-finite") return undefined;
  const [only, ...rest] = found;
  if (only === undefined || rest.length > 0) return undefined;
  return { key, id: `${typeof only.value}:${String(only.value)}`, label: only.label };
}

/** The keys written out in the first argument, in order; entries that are spreads are skipped. */
function keysOf(node: ts.NewExpression, kind: Kind, ctx: FileContext): readonly Entry[] {
  const [first] = node.arguments ?? [];
  const list = first === undefined ? undefined : unwrap(first);
  if (list === undefined || !ts.isArrayLiteralExpression(list)) return [];
  return list.elements.flatMap((element) => {
    const written = unwrap(element);
    const key =
      kind === "Set"
        ? written
        : ts.isArrayLiteralExpression(written)
          ? written.elements[0]
          : undefined;
    if (key === undefined || ts.isSpreadElement(key) || ts.isOmittedExpression(key)) return [];
    const entry = entryOf(unwrap(key), ctx);
    return entry === undefined ? [] : [entry];
  });
}

function headline(label: string, kind: Kind, count: number, line: number): string {
  const times = count === 2 ? "twice" : `${String(count)} times`;
  const effect =
    kind === "Set"
      ? "the repeat does nothing"
      : count === 2
        ? "the second value replaces the first"
        : "the last value replaces the others";
  return fitted(
    (cut) => `\`${cut(label)}\` is in this ${kind} ${times}; ${effect} (line ${String(line)})`,
  );
}

function hint(kind: Kind): string {
  return kind === "Set"
    ? "remove the repeated item, or write the item that was meant here"
    : "remove the entry that should lose, or give it the key it was meant to have";
}

/** The name a `new Map(...)` is stored under: its variable or property, if it has one. */
function storedName(node: ts.NewExpression): string | undefined {
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return undefined;
}

function checkLiteral(
  node: ts.NewExpression,
  kind: Kind,
  ignore: readonly string[],
  ctx: FileContext,
): void {
  const name = storedName(node);
  if (name !== undefined && matchesName(name, ignore)) return;
  const seen = new Map<string, Entry[]>();
  for (const entry of keysOf(node, kind, ctx)) {
    seen.set(entry.id, [...(seen.get(entry.id) ?? []), entry]);
  }
  for (const entries of seen.values()) {
    const [first, second] = entries;
    if (first === undefined || second === undefined) continue;
    const line = ctx.sourceFile.getLineAndCharacterOfPosition(first.key.getStart()).line + 1;
    ctx.report({
      node: second.key,
      message: headline(first.label, kind, entries.length, line),
      hint: hint(kind),
      related: [{ node: first.key, message: `the first ${first.label} is here` }],
    });
  }
}

export const duplicateKey = defineRule({
  kind: "file",
  meta: {
    description:
      "A new Map([...]) or new Set([...]) written out in code has the same key twice, so the second replaces the first.",
    defaultSeverity: "error",
    tier: "core",
    group: "keys",
    options: {
      ignore: option.strings({
        default: [],
        description:
          "Names of maps and sets (globs like *_ALIASES) whose repeats are deliberate, such as generated tables.",
      }),
    },
    explain: EXPLAIN,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        const kind = builtinKind(node, ctx);
        if (kind !== undefined) checkLiteral(node, kind, ctx.options.ignore, ctx);
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
