import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext } from "@stateward/core";
import { fitted } from "./text.js";

const EXPLAIN = `# unions/tag-does-not-discriminate

When \`kind\` is \`string\` in one member, testing \`kind\` does not narrow the union, so TypeScript cannot check which properties each branch reads.

\`\`\`ts example-bad
export type Message =
  | { kind: "chat"; text: string }
  | { kind: string; payload: unknown };
\`\`\`

Give every member its own literal, and keep the catch-all apart from the union:

\`\`\`ts example-good
export type Message = { kind: "chat"; text: string } | { kind: "join"; user: string };

/** What the server may send that this app does not know yet. */
export type UnknownMessage = { kind: string; payload: unknown };
\`\`\`

There is no quick fix: which members the union really has is yours to say.

## Why it matters

In the bad \`Message\`, testing \`message.kind === "chat"\` does not rule out the second member, because \`string\` includes \`"chat"\`. So \`message.text\` is still an error after the test, or needs a cast, and a \`switch\` over \`kind\` is not checked for missing cases: the other \`unions\` rules have nothing to check and stay quiet. The union looks as if each \`kind\` picks one member, and it does not.

## What it does not catch

It reads only the \`type\` declaration as written:

- members named by type (\`type Message = Chat | Other\`) are not looked into, only members written inline as \`{ … }\`;
- interfaces, and unions built with generics or mapped types, are not read;
- a property that is \`string\` in every member, or a literal in every member, is fine.

A union that another property already tells apart is fine too (\`{ kind: "root"; depth: 0 } | { kind: "child"; depth: number }\`: \`kind\` decides), unless your code narrows on the weak one: it tests it (\`row.depth === 0\`, \`switch (row.depth)\`, or a destructured \`depth\`) and then reads a property only some members have, through a cast, as if the test had picked one. A read that another test has narrowed (\`row.kind === "root" && row.title\`) does not count. Narrowing is seen only on a value whose type is the union itself (not \`Row | undefined\`), through \`===\`, \`!==\`, \`==\`, \`!=\`, \`switch\` and \`const { depth } = row\`.

## Turn it on or off

It shows as info under \`recommended\` (a hint in the editor that does not fail the check) and as an error under \`strict\`. Turn it off if such catch-all members are deliberate in your API types, or name those types:

\`\`\`ts
rules: { "unions/tag-does-not-discriminate": "off" } // or "warning"
rules: { "unions/tag-does-not-discriminate": ["warning", { ignore: ["*Response"] }] } // API types
\`\`\`
`;

type Base = "string" | "number";

/** What one member says about a property. */
type Seen =
  | { kind: "literal"; base: Base; text: string }
  | { kind: "weak"; base: Base; name: ts.PropertyName };

function stripTypeParentheses(type: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(type) ? stripTypeParentheses(type.type) : type;
}

function literalOf(type: ts.TypeNode): { base: Base; text: string } | undefined {
  if (!ts.isLiteralTypeNode(type)) return undefined;
  const literal = type.literal;
  if (ts.isStringLiteral(literal)) return { base: "string", text: JSON.stringify(literal.text) };
  if (ts.isNumericLiteral(literal)) return { base: "number", text: literal.text };
  if (ts.isPrefixUnaryExpression(literal) && ts.isNumericLiteral(literal.operand)) {
    return { base: "number", text: literal.getText() };
  }
  return undefined;
}

/** A literal, or a union of literals of one kind: the first is shown. */
function literalsOnly(type: ts.TypeNode): { base: Base; text: string } | undefined {
  const inner = stripTypeParentheses(type);
  const members = ts.isUnionTypeNode(inner) ? inner.types : [inner];
  const found = members.map((member) => literalOf(stripTypeParentheses(member)));
  const first = found[0];
  if (first === undefined) return undefined;
  return found.every((one) => one?.base === first.base) ? first : undefined;
}

/**
 * The values a property can hold when it is only literals (`"a"`, `1 | 2`, `true`), each as
 * written; undefined when it can hold anything else.
 */
function tagValues(type: ts.TypeNode): string[] | undefined {
  const inner = stripTypeParentheses(type);
  const members = ts.isUnionTypeNode(inner) ? inner.types : [inner];
  const values: string[] = [];
  for (const member of members.map(stripTypeParentheses)) {
    if (!ts.isLiteralTypeNode(member)) return undefined;
    const literal = literalOf(member);
    if (literal !== undefined) values.push(literal.text);
    else if (member.literal.kind === ts.SyntaxKind.TrueKeyword) values.push("true");
    else if (member.literal.kind === ts.SyntaxKind.FalseKeyword) values.push("false");
    else return undefined;
  }
  return values;
}

function weakBase(type: ts.TypeNode): Base | undefined {
  const inner = stripTypeParentheses(type);
  if (inner.kind === ts.SyntaxKind.StringKeyword) return "string";
  return inner.kind === ts.SyntaxKind.NumberKeyword ? "number" : undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** What one member says about each of its properties, and the literal values of its tags. */
function seenInMember(member: ts.TypeLiteralNode): {
  seen: Map<string, Seen>;
  tags: Map<string, string[]>;
  names: Set<string>;
} {
  const seen = new Map<string, Seen>();
  const tags = new Map<string, string[]>();
  const names = new Set<string>();
  for (const element of member.members) {
    const named = element.name === undefined ? undefined : propertyName(element.name);
    if (named !== undefined) names.add(named);
    if (!ts.isPropertySignature(element) || element.type === undefined) continue;
    const name = propertyName(element.name);
    if (name === undefined) continue;
    const base = weakBase(element.type);
    const literal = literalsOnly(element.type);
    if (base !== undefined) seen.set(name, { kind: "weak", base, name: element.name });
    else if (literal !== undefined) seen.set(name, { kind: "literal", ...literal });
    const values = element.questionToken === undefined ? tagValues(element.type) : undefined;
    if (values !== undefined) tags.set(name, values);
  }
  return { seen, tags, names };
}

/**
 * Whether some property tells every member apart: every member is written inline and gives it
 * literals that no other member gives.
 */
function toldApart(
  tags: readonly ReadonlyMap<string, readonly string[]>[],
  count: number,
): boolean {
  if (tags.length !== count) return false;
  const [first] = tags;
  if (first === undefined) return false;
  return [...first.keys()].some((property) => {
    const owner = new Set<string>();
    for (const member of tags) {
      const values = member.get(property);
      if (values === undefined) return false;
      for (const value of values) {
        if (owner.has(value)) return false;
        owner.add(value);
      }
    }
    return true;
  });
}

/** A string literal is cut inside its quotes, so they stay balanced. */
function cutLiteral(literal: string, cut: (text: string) => string): string {
  return literal.startsWith('"') ? `"${cut(literal.slice(1, -1))}"` : cut(literal);
}

function headline(property: string, literal: string, weak: Base, alias: string): string {
  return fitted(
    (cut) =>
      `\`${cut(property)}\` does not tell the members of \`${cut(alias)}\` apart: one member has ${cutLiteral(literal, cut)}, another \`${weak}\``,
  );
}

function hint(property: string, alias: string): string {
  return fitted(
    (cut) =>
      `give every member of \`${cut(alias)}\` its own literal \`${cut(property)}\`, or move the catch-all member out of the union, so a test on \`${cut(property)}\` picks one member`,
  );
}

/**
 * A weak property of a union; with `toldApart`, reported only where the code narrows on it:
 * tests it, then reads one of `memberOnly` (the properties only some members have) as if the test
 * had picked a member.
 */
type Candidate = {
  alias: string;
  property: string;
  memberOnly: string[];
  start: number;
  end: number;
  message: string;
  hint: string;
  toldApart: boolean;
};

/**
 * A property the code tests, by the union (its file and name) it belongs to, and the properties
 * read through the same value where the test decides what runs.
 */
type Narrowed = { file: string; alias: string; property: string; reads: string[] };

type Summary = { candidates: Candidate[]; narrowed: Narrowed[] };

/** One path form for a file name, so a key from the type checker meets the engine's. */
const fileKey = (file: string): string => file.replaceAll("\\", "/");

const narrowedKey = (file: string, alias: string, property: string): string =>
  `${fileKey(file)}\u0000${alias}\u0000${property}`;

function candidatesOf(
  node: ts.TypeAliasDeclaration,
  ignore: readonly string[],
  sourceFile: ts.SourceFile,
): Candidate[] {
  if (matchesName(node.name.text, ignore)) return [];
  const union = stripTypeParentheses(node.type);
  if (!ts.isUnionTypeNode(union)) return [];
  const read = union.types
    .map(stripTypeParentheses)
    .filter((member) => ts.isTypeLiteralNode(member))
    .map(seenInMember);
  const members = read.map((member) => member.seen);
  const every = read.map((member) => member.names);
  const memberOnly = [...new Set(every.flatMap((names) => [...names]))]
    .filter((name) => !every.every((names) => names.has(name)))
    .sort();
  const told = toldApart(
    read.map((member) => member.tags),
    union.types.length,
  );
  const names = new Set(members.flatMap((member) => [...member.keys()]));
  const found: Candidate[] = [];
  for (const property of names) {
    const all = members.flatMap((member) => member.get(property) ?? []);
    for (const weak of all) {
      if (weak.kind !== "weak") continue;
      const literal = all.find((one) => one.kind === "literal" && one.base === weak.base);
      if (literal?.kind !== "literal") continue;
      found.push({
        alias: node.name.text,
        property,
        start: weak.name.getStart(sourceFile),
        end: weak.name.end,
        message: headline(property, literal.text, weak.base, node.name.text),
        hint: hint(property, node.name.text),
        memberOnly,
        toldApart: told,
      });
      break;
    }
  }
  return found;
}

const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** An expression without parentheses, `as`, `satisfies` and `!`. */
function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The union and property a compared or switched expression reads: `row.depth`, `row["depth"]`,
 * or `depth` from `const { depth } = row`.
 */
function narrowedBy(
  ctx: FileContext,
  tested: ts.Expression,
):
  | {
      narrowed: Omit<Narrowed, "reads">;
      object: ts.Expression;
      pattern: ts.ObjectBindingPattern | undefined;
    }
  | undefined {
  const node = unwrapped(tested);
  let object: ts.Expression | undefined;
  let property: string | undefined;
  let pattern: ts.ObjectBindingPattern | undefined;
  if (ts.isPropertyAccessExpression(node)) {
    object = node.expression;
    property = node.name.text;
  } else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    object = node.expression;
    property = node.argumentExpression.text;
  } else if (ts.isIdentifier(node)) {
    const symbol = ctx.types.symbolAt(node);
    const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
    if (
      declaration === undefined ||
      !ts.isBindingElement(declaration) ||
      declaration.dotDotDotToken !== undefined ||
      !ts.isObjectBindingPattern(declaration.parent) ||
      !ts.isVariableDeclaration(declaration.parent.parent) ||
      declaration.parent.parent.initializer === undefined
    ) {
      return undefined;
    }
    const key = declaration.propertyName ?? declaration.name;
    if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return undefined;
    object = declaration.parent.parent.initializer;
    property = key.text;
    pattern = declaration.parent;
  }
  if (object === undefined || property === undefined) return undefined;
  const alias = ctx.types.awaitedAliasOf(object);
  if (alias === undefined || alias.promised) return undefined;
  return { narrowed: { file: fileKey(alias.file), alias: alias.name, property }, object, pattern };
}

/** Whether a statement leaves its block: `return`, `throw`, `break`, `continue`, or a block ending so. */
function exits(statement: ts.Statement): boolean {
  if (ts.isBlock(statement)) {
    const last = statement.statements[statement.statements.length - 1];
    return last !== undefined && exits(last);
  }
  return (
    ts.isReturnStatement(statement) ||
    ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) ||
    ts.isContinueStatement(statement)
  );
}

/**
 * The code a comparison decides whether it runs: the rest of an `&&` or `||`, the branches of the
 * `if` or `?:` it is the condition of, and the statements after an `if` whose branch leaves.
 */
function guardedBy(comparison: ts.Expression): ts.Node[] {
  const regions: ts.Node[] = [];
  let current: ts.Node = comparison;
  for (;;) {
    const parent: ts.Node = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      if (parent.left === current) regions.push(parent.right);
    } else if (
      !ts.isParenthesizedExpression(parent) &&
      !(ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
    ) {
      break;
    }
    current = parent;
  }
  const parent = current.parent;
  if (ts.isIfStatement(parent) && parent.expression === current) {
    regions.push(parent.thenStatement);
    if (parent.elseStatement !== undefined) regions.push(parent.elseStatement);
    if (exits(parent.thenStatement) && ts.isBlock(parent.parent)) {
      const siblings = parent.parent.statements;
      regions.push(...siblings.slice(siblings.indexOf(parent) + 1));
    }
  } else if (ts.isConditionalExpression(parent) && parent.condition === current) {
    regions.push(parent.whenTrue, parent.whenFalse);
  }
  return regions;
}

/**
 * The properties read through `object` (by its text) or through names destructured with `pattern`.
 * A read through `object` counts only when some member of `object`'s type there lacks the
 * property: then only a cast makes it compile, relying on the test. When TypeScript has narrowed
 * `object` (by `row.kind === "turn"`), the read relies on that check, not on this one.
 */
function readsIn(
  ctx: FileContext,
  regions: readonly ts.Node[],
  object: ts.Expression,
  pattern: ts.ObjectBindingPattern | undefined,
): string[] {
  const text = unwrapped(object).getText(ctx.sourceFile);
  const reads = new Set<string>();
  const relies = (through: ts.Expression, property: string): boolean => {
    const inner = unwrapped(through);
    return (
      inner.getText(ctx.sourceFile) === text &&
      ctx.types.awaitedTagsOf(inner, property) === "missing"
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && relies(node.expression, node.name.text)) {
      reads.add(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      relies(node.expression, node.argumentExpression.text)
    ) {
      reads.add(node.argumentExpression.text);
    } else if (pattern !== undefined && ts.isIdentifier(node)) {
      const symbol = ctx.types.symbolAt(node);
      const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
      if (
        declaration !== undefined &&
        ts.isBindingElement(declaration) &&
        declaration.parent === pattern
      ) {
        const key = declaration.propertyName ?? declaration.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) reads.add(key.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const region of regions) visit(region);
  return [...reads];
}

function summarize(ctx: FileContext<{ ignore: readonly string[] }>): Summary {
  const candidates: Candidate[] = [];
  const narrowed: Narrowed[] = [];
  const seen = new Map<string, Narrowed>();
  const note = (tested: ts.Expression, regions: readonly ts.Node[]): void => {
    const found = narrowedBy(ctx, tested);
    if (found === undefined) return;
    const reads = readsIn(ctx, regions, found.object, found.pattern);
    const key = narrowedKey(found.narrowed.file, found.narrowed.alias, found.narrowed.property);
    const known = seen.get(key);
    if (known !== undefined) {
      for (const read of reads) if (!known.reads.includes(read)) known.reads.push(read);
      return;
    }
    const entry = { ...found.narrowed, reads };
    seen.set(key, entry);
    narrowed.push(entry);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node)) {
      candidates.push(...candidatesOf(node, ctx.options.ignore, ctx.sourceFile));
    } else if (ts.isBinaryExpression(node) && COMPARISONS.has(node.operatorToken.kind)) {
      const regions = guardedBy(node);
      note(node.left, regions);
      note(node.right, regions);
    } else if (ts.isSwitchStatement(node)) {
      note(node.expression, node.caseBlock.clauses);
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return { candidates, narrowed };
}

export const tagDoesNotDiscriminate = defineRule({
  kind: "project",
  meta: {
    description:
      "When `kind` is `string` in one member, testing `kind` does not narrow the union, so TypeScript cannot check which properties each branch reads.",
    summary:
      "a tag like `kind` that is `string` in one member, so a test on it does not pick a member",
    defaultSeverity: "warning",
    tier: "coverage",
    group: "cases",
    options: {
      ignore: option.strings({
        default: [],
        description:
          "Union type names (globs like *Response) whose catch-all member is deliberate, such as API types.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize,
  check(summaries, ctx) {
    // Reads per tested property: a test counts as narrowing only when what it guards reads a
    // property some members lack, as if the test had picked a member (`row.depth === 0 && row.turn`
    // with `turn` on every member only compares a value).
    const narrowed = new Map<string, Set<string>>();
    for (const summary of summaries.values()) {
      for (const one of summary.narrowed) {
        const key = narrowedKey(one.file, one.alias, one.property);
        const reads = narrowed.get(key) ?? new Set<string>();
        for (const read of one.reads) reads.add(read);
        narrowed.set(key, reads);
      }
    }
    for (const [file, summary] of [...summaries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      for (const candidate of summary.candidates) {
        const reads = narrowed.get(narrowedKey(file, candidate.alias, candidate.property));
        if (
          candidate.toldApart &&
          !candidate.memberOnly.some((property) => reads?.has(property) === true)
        ) {
          continue;
        }
        ctx.report({
          message: candidate.message,
          hint: candidate.hint,
          location: { file, start: candidate.start, end: candidate.end },
        });
      }
    }
  },
});
