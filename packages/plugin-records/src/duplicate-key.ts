import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext } from "@stateward/core";
import { fitted } from "./lookup-text.js";

const EXPLAIN = `# records/duplicate-key

The same key twice in a \`new Map([...])\` or \`new Set([...])\` keeps only the last entry, so the first one has no effect.

\`\`\`ts example-bad
export const shortcuts = new Map([
  ["save", "Ctrl+S"],
  ["open", "Ctrl+O"],
  ["save", "Ctrl+Shift+S"],
]);
\`\`\`

Give the entry the key it was meant to have, or remove the one that should lose:

\`\`\`ts example-good
export const shortcuts = new Map([
  ["save", "Ctrl+S"],
  ["open", "Ctrl+O"],
  ["saveAs", "Ctrl+Shift+S"],
]);
\`\`\`

There is no quick fix: which of the two values is right is your call. The finding is on the second key, with the first listed as a related place.

## Why it matters

\`new Map([["save", a], ["save", b]])\` keeps only \`b\`. Nothing fails: \`a\` is gone, and the code that reads \`"save"\` gets \`b\`. It usually happens when a long list of entries is copied and one key is not renamed. A \`Set\` with a repeated item works, but the repeat is a leftover that hides a mistake, often an item that is missing.

## What it does not catch

It compares only keys that are constants: a string, a number, an enum member, or a \`const\` whose type is one value (\`"save"\` and \`SAVE\` are the same key when \`const SAVE = "save"\`). So it never guesses, and it does not see:

- a key that is not a constant (a variable of type \`string\`, a call), or entries added later with \`.set()\` or \`.add()\`;
- a list built elsewhere (\`new Map(entries)\`, \`new Map(Object.entries(x))\`), or entries from a spread;
- a \`Map\` or \`Set\` class of your own, and \`WeakMap\` / \`WeakSet\`;
- an object literal with the same property twice: TypeScript and ESLint's \`no-dupe-keys\` report that.

## Turn it on or off

\`\`\`ts
rules: { "records/duplicate-key": "off" } // or "warning"
rules: { "records/duplicate-key": ["error", { ignore: ["*_ALIASES"] }] } // generated tables
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
      ? "the repeat has no effect"
      : count === 2
        ? "the second value replaces the first"
        : "the last value replaces the others";
  return fitted(
    (cut) =>
      `\`${cut(label)}\` is in the ${kind} ${times}; ${effect} (first at line ${String(line)})`,
  );
}

function hint(kind: Kind): string {
  return kind === "Set"
    ? "remove the repeated item, or write the item that was meant instead"
    : "remove the entry that should not win, or give it the key it was meant to have";
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
      related: [{ node: first.key, message: `first ${first.label}` }],
    });
  }
}

export const duplicateKey = defineRule({
  kind: "file",
  meta: {
    description:
      "The same key twice in a `new Map([...])` or `new Set([...])` keeps only the last entry, so the first one has no effect.",
    summary: "the same key twice in a `new Map([...])` or `new Set([...])` written out in code",
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
