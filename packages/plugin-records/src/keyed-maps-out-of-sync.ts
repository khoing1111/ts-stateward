import ts from "@stateward/core/typescript";
import { defineRule, matchesName, option, type FileContext, type OptionsOf } from "@stateward/core";
import { isComponentOrHook, isReactUseState } from "./react-hooks.js";
import { MAX_HEADLINE, fitted, namesText, shorten } from "./text.js";

const EXPLAIN = `# records/keyed-maps-out-of-sync

Two records kept in step must lose a key together: a key removed from one and forgotten in the other is reported.

## Why

When \`savedRelevanceByNoteId\` and \`viewEpochByNoteId\` both get an entry for every note, deleting a note from one and not the other leaves an entry for a note that is gone. The screen then shows a stale value, or an old one comes back when the id is reused. The bug is the forgotten removal, not that there are two records.

## When to use it

Use it for code that keeps several tables keyed by the same id: normalised stores, caches, per-item state in a component. It guesses from how the tables are written, so it is off until you add its add-on (below), then a warning in every preset.

## What it catches

Two or more records or \`Map\`s in one place (module-level constants, the fields of one class, or the \`useState\` values of one component or hook) keyed by the same type. They count as kept in step when one function writes both with the same key (\`a[id] = …; b[id] = …\`, \`a.set(id, …); b.set(id, …)\`, or two setters each adding \`[id]: …\`).

For such a pair, the rule looks at every removal: \`delete a[id]\`, \`a.delete(id)\`, \`a.clear()\`, replacing the whole table (\`a = {}\`, \`setA({})\`, \`setA(new Map())\`), and a setter that drops a key (\`setA(({ [id]: _, ...rest }) => rest)\`, or a \`filter\` over the previous value). It reports a function where one table loses a key or is reset and the other does not, at that removal, with the other table's declaration as a note. A removal in another function does not count, so the message lists both places and you decide.

When every write and every removal of the tables is paired, it suggests one record instead, as an info.

### Bad

\`\`\`ts
type NoteId = string;
const savedRelevanceByNoteId: Record<NoteId, number> = {};
const viewEpochByNoteId: Record<NoteId, number> = {};

function openNote(id: NoteId, relevance: number, epoch: number) {
  savedRelevanceByNoteId[id] = relevance;
  viewEpochByNoteId[id] = epoch;
}

function removeNote(id: NoteId) {
  delete viewEpochByNoteId[id];
}
\`\`\`

### Good

Remove from both:

\`\`\`ts
function removeNote(id: NoteId) {
  delete viewEpochByNoteId[id];
  delete savedRelevanceByNoteId[id];
}
\`\`\`

### Fix

Remove the key from both tables in the same function. If the tables live for different times on purpose, say so on the removal: \`// stateward-ignore records/keyed-maps-out-of-sync: <why>\`. When every change is paired, the info suggests merging them into one \`Record<NoteId, { savedRelevance; viewEpoch }>\`; there is no quick fix, since every read changes.

## What it does not catch

- Tables with different key types, or never written with the same key in one function.
- A table computed from the other (\`byName[id] = f(names[id])\` is a cache, not a second copy).
- Arrays, tables without a declared key type (no annotation, \`new Map()\` with no type arguments), or from another file or a parameter.
- The same key under different names (\`id\` and \`userId\`), writes through another name (\`const m = names; m[id] = …\`), \`Object.assign\`, or helpers such as \`omit\`.
- Tables in different places (a module-level record and a component's state).
- A table that loses keys in a \`finally\` or in a timer's callback (\`savingFiles.delete(id)\` after a save, \`pendingSaves.delete(key)\` when the timeout fires): it marks work in progress, so it lives for a shorter time than its partner on purpose.
- Override maps whose reads fall back (\`overrides[id] ?? server[id]\`) are meant to lose keys alone. They are reported like any other pair for now; a later version will read the fallback. Until then, say so with the ignore comment.

It can be wrong for two unrelated tables keyed by a plain \`string\` and written with the same variable in one function (\`plainStringKeys: false\` leaves those out), and for tables that live for different times. Two key types that are both \`string\` under different names (\`type A = string; type B = string\`) count as one.

## Turn it on or off

Turn it on in \`stateward.config.ts\`:

\`\`\`ts
addons: ["records/keyed-maps"]
\`\`\`

Then change or turn off the rule itself:

\`\`\`ts
rules: { "records/keyed-maps-out-of-sync": "off" } // or "error"
groups: { "states/records": "off" } // the whole group
rules: { "records/keyed-maps-out-of-sync": ["warning", { plainStringKeys: false }] } // only named key types like UserId
\`\`\`
`;

/** The most functions a hint lists; the rest are counted. */
const MAX_SITES = 3;

/** One record or map, or one \`useState\` of one. */
type Container = {
  readonly name: string;
  /** The key type as the checker prints it: two containers have "the same key" when these match. */
  readonly keyType: string;
  /** The key type as written, shown in the message. */
  readonly keyShown: string;
  readonly valueId: string;
  readonly setterId: string | undefined;
  /** Where a finding is reported when this is the first container of the group. */
  readonly node: ts.Node;
  readonly order: number;
};

/**
 * One change of a container: `c[key] = value`, `c.set(key, value)`, a setter adding a key (`write`);
 * `delete c[key]`, `c.delete(key)`, a setter dropping a key (`remove`); `c.clear()`, `c = {}`,
 * `setC({})` (`reset`).
 */
type WriteKind = "write" | "remove" | "reset";

type Write = {
  readonly kind: WriteKind;
  readonly container: number;
  /** The handler: the function (or `case`) the change sits in, not counting a setter's updater. */
  readonly owner: ts.Node;
  /** The nearest function a reader would name, shown in messages. */
  readonly ownerName: string;
  /** The key expression as text; empty when the change has no single key (a reset, a filter). */
  readonly key: string;
  /** The containers the written value reads: `b[id] = f(a[id])` reads `a`. */
  readonly reads: ReadonlySet<number>;
  readonly node: ts.Node;
};

/** A node can sit under parentheses, `!`, `as` and `satisfies` without being another node. */
function skipWrappers(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Whether the identifier names a global of the language library, not something of the project. */
function isGlobal(name: ts.Identifier, ctx: FileContext): boolean {
  const symbol = ctx.types.symbolAt(name);
  const declaration = symbol && ctx.types.declarationOf(symbol);
  return declaration !== undefined && !ctx.types.isOwnFile(declaration.file);
}

/** The key type node of `Record<K, V>`, `Map<K, V>` or `{ [id: K]: V }`. */
function keyTypeNode(type: ts.TypeNode, ctx: FileContext): ts.TypeNode | undefined {
  if (ts.isTypeReferenceNode(type)) {
    const [key, value] = type.typeArguments ?? [];
    if (key === undefined || value === undefined || !ts.isIdentifier(type.typeName)) {
      return undefined;
    }
    const isContainer = type.typeName.text === "Record" || type.typeName.text === "Map";
    return isContainer && isGlobal(type.typeName, ctx) ? key : undefined;
  }
  if (ts.isTypeLiteralNode(type)) {
    const [member] = type.members;
    if (
      type.members.length !== 1 ||
      member === undefined ||
      !ts.isIndexSignatureDeclaration(member)
    ) {
      return undefined;
    }
    return member.parameters[0]?.type;
  }
  return undefined;
}

/** The key type of a container from `new Map<K, V>()`, `{} as Record<K, V>` and the like. */
function keyTypeOfValue(expression: ts.Expression, ctx: FileContext): ts.TypeNode | undefined {
  const value = skipWrappers(expression);
  if (
    value !== expression &&
    (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))
  ) {
    return keyTypeNode(expression.type, ctx);
  }
  if (ts.isNewExpression(value) && ts.isIdentifier(value.expression)) {
    const [key, entry] = value.typeArguments ?? [];
    const isMap = value.expression.text === "Map" && isGlobal(value.expression, ctx);
    return isMap && key !== undefined && entry !== undefined ? key : undefined;
  }
  return undefined;
}

/** The key type of a declared variable or field: its annotation, or its initializer. */
function keyTypeOfDeclaration(
  declaration: ts.VariableDeclaration | ts.PropertyDeclaration,
  ctx: FileContext,
): ts.TypeNode | undefined {
  if (declaration.type !== undefined) return keyTypeNode(declaration.type, ctx);
  return declaration.initializer === undefined
    ? undefined
    : keyTypeOfValue(declaration.initializer, ctx);
}

function containerOf(
  name: ts.Identifier,
  key: ts.TypeNode,
  order: number,
  setter: ts.Identifier | undefined,
  ctx: FileContext,
): Container | undefined {
  const value = ctx.types.symbolAt(name);
  if (value === undefined) return undefined;
  const setterSymbol = setter === undefined ? undefined : ctx.types.symbolAt(setter);
  return {
    name: name.text,
    keyType: ctx.types.typeTextOf(key),
    keyShown: key.getText(),
    valueId: value.id,
    setterId: setterSymbol?.id,
    node: name,
    order,
  };
}

/** Whether the function is a place a reader would name: a declaration, method or named function value. */
function nameOf(node: ts.Node): string | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name !== undefined &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  let current: ts.Node = node;
  let parent: ts.Node = node.parent;
  // `useCallback(() => …)` and `memo(() => …)` give their function to the name they are assigned to.
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    (ts.isCallExpression(parent) &&
      parent.arguments[0] === current &&
      /^(?:use[A-Z0-9]\w*|memo|forwardRef)$/.test(parent.expression.getText()))
  ) {
    current = parent;
    parent = parent.parent;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}

/** The nearest function with a name around a node, or the file when there is none. */
function ownerOf(node: ts.Node): { owner: ts.Node; name: string } {
  let current: ts.Node = node.parent;
  while (!ts.isSourceFile(current)) {
    const name = nameOf(current);
    if (name !== undefined) return { owner: current, name };
    current = current.parent;
  }
  return { owner: current, name: "the top level" };
}

/** The containers of one scope and the code that may write them. */
type Scope = {
  readonly containers: readonly Container[];
  readonly root: ts.Node;
  /** A node whose inside belongs to another scope. */
  readonly skip: (node: ts.Node) => boolean;
};

const ASSIGNMENTS = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

/** Whether an expression is a fresh empty record or map: `{}`, `new Map()`, `new Map<K, V>()`. */
function isEmptyContainer(expression: ts.Node): boolean {
  if (!ts.isExpression(expression)) return false;
  const value = skipWrappers(expression);
  if (ts.isObjectLiteralExpression(value)) return value.properties.length === 0;
  return (
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "Map" &&
    (value.arguments?.length ?? 0) === 0
  );
}

/** Whether the identifier `name` appears anywhere inside the node. */
function mentions(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true;
  return ts.forEachChild(node, (child) => (mentions(child, name) ? true : undefined)) === true;
}

function writesOf(scope: Scope, ctx: FileContext): readonly Write[] {
  const byValue = new Map(scope.containers.map((container) => [container.valueId, container]));
  const bySetter = new Map(
    scope.containers.flatMap((container) =>
      container.setterId === undefined ? [] : [[container.setterId, container] as const],
    ),
  );
  const symbolId = (node: ts.Node): string | undefined => ctx.types.symbolAt(node)?.id;

  const containerAt = (expression: ts.Expression): Container | undefined => {
    const target = skipWrappers(expression);
    if (ts.isIdentifier(target)) return byValue.get(symbolId(target) ?? "");
    return ts.isPropertyAccessExpression(target)
      ? byValue.get(symbolId(target.name) ?? "")
      : undefined;
  };

  /** The containers an expression mentions, as a value read. */
  const readsIn = (expression: ts.Node | undefined): ReadonlySet<number> => {
    const seen = new Set<number>();
    const look = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const container = byValue.get(symbolId(node) ?? "");
        if (container !== undefined) seen.add(container.order);
      }
      ts.forEachChild(node, look);
    };
    if (expression !== undefined) look(expression);
    return seen;
  };

  /** A function that only hands `setX` its next value is part of the handler that calls `setX`. */
  const isUpdater = (node: ts.Node): boolean =>
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isCallExpression(node.parent) &&
    ts.isIdentifier(node.parent.expression) &&
    node.parent.arguments.includes(node) &&
    bySetter.has(symbolId(node.parent.expression) ?? "");

  /** The handler of a node: its nearest function (not a setter's updater) or `case`. */
  const handlerOf = (node: ts.Node): ts.Node => {
    let current: ts.Node = node.parent;
    while (!ts.isSourceFile(current)) {
      const isFunction =
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isConstructorDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current);
      if ((isFunction && !isUpdater(current)) || ts.isCaseOrDefaultClause(current)) return current;
      current = current.parent;
    }
    return current;
  };

  const writes: Write[] = [];
  const add = (
    container: Container,
    at: ts.Node,
    kind: WriteKind,
    key: ts.Expression | undefined,
    value: ts.Expression | undefined,
  ): void => {
    writes.push({
      kind,
      container: container.order,
      owner: handlerOf(at),
      ownerName: ownerOf(at).name,
      key: key === undefined ? "" : compact(key.getText()),
      reads: readsIn(value),
      node: at,
    });
  };

  /** What a setter's argument adds or removes: `{ ...prev, [id]: v }`, `next.set(id, v)`, `delete next[id]`. */
  const scanSetter = (container: Container, argument: ts.Node): void => {
    if (isEmptyContainer(argument)) add(container, argument, "reset", undefined, undefined);
    const updater = ts.isArrowFunction(argument) || ts.isFunctionExpression(argument);
    const [first] = updater ? argument.parameters : [];
    const previous = first !== undefined && ts.isIdentifier(first.name) ? first.name.text : "";
    const look = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isComputedPropertyName(node.name)) {
        add(container, node, "write", node.name.expression, node.initializer);
      } else if (
        ts.isBinaryExpression(node) &&
        ASSIGNMENTS(node.operatorToken.kind) &&
        ts.isElementAccessExpression(skipWrappers(node.left))
      ) {
        const left = skipWrappers(node.left);
        if (ts.isElementAccessExpression(left)) {
          add(container, node, "write", left.argumentExpression, node.right);
        }
      } else if (ts.isDeleteExpression(node)) {
        const operand = skipWrappers(node.expression);
        if (ts.isElementAccessExpression(operand)) {
          add(container, node, "remove", operand.argumentExpression, undefined);
        }
      } else if (
        ts.isBindingElement(node) &&
        node.propertyName !== undefined &&
        ts.isComputedPropertyName(node.propertyName) &&
        ts.isObjectBindingPattern(node.parent) &&
        node.parent.elements.some((element) => element.dotDotDotToken !== undefined)
      ) {
        // `({ [id]: _, ...rest }) => rest` drops `id`.
        add(container, node, "remove", node.propertyName.expression, undefined);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const { name, expression } = node.expression;
        const [key, value] = node.arguments;
        if (name.text === "set" && key !== undefined) add(container, node, "write", key, value);
        if (name.text === "delete" && key !== undefined) {
          add(container, node, "remove", key, undefined);
        }
        // `Object.fromEntries(Object.entries(prev).filter(…))` keeps some keys of `prev`.
        if (name.text === "filter" && previous !== "" && mentions(expression, previous)) {
          add(container, node, "remove", undefined, undefined);
        }
      }
      ts.forEachChild(node, look);
    };
    look(argument);
  };

  const visit = (node: ts.Node): void => {
    if (node !== scope.root && scope.skip(node)) return;
    if (ts.isBinaryExpression(node) && ASSIGNMENTS(node.operatorToken.kind)) {
      const left = skipWrappers(node.left);
      const container = ts.isElementAccessExpression(left)
        ? containerAt(left.expression)
        : undefined;
      if (ts.isElementAccessExpression(left) && container !== undefined) {
        add(container, node, "write", left.argumentExpression, node.right);
      } else if (
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isEmptyContainer(node.right)
      ) {
        const whole = containerAt(left);
        if (whole !== undefined) add(whole, node, "reset", undefined, undefined);
      }
    } else if (ts.isDeleteExpression(node)) {
      const operand = skipWrappers(node.expression);
      const container = ts.isElementAccessExpression(operand)
        ? containerAt(operand.expression)
        : undefined;
      if (ts.isElementAccessExpression(operand) && container !== undefined) {
        add(container, node, "remove", operand.argumentExpression, undefined);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ["set", "delete", "clear"].includes(callee.name.text)
      ) {
        const container = containerAt(callee.expression);
        const [key, value] = node.arguments;
        if (container !== undefined) {
          if (callee.name.text === "clear") add(container, node, "reset", undefined, undefined);
          else if (key !== undefined) {
            const kind = callee.name.text === "set" ? "write" : "remove";
            add(container, node, kind, key, value);
          }
        }
      } else if (ts.isIdentifier(callee)) {
        const container = bySetter.get(symbolId(callee) ?? "");
        const [argument] = node.arguments;
        if (container !== undefined && argument !== undefined) scanSetter(container, argument);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(scope.root);
  return writes;
}

/** Groups of containers that are used together; a container is in one group. */
class Groups {
  private readonly parent = new Map<number, number>();

  find(item: number): number {
    const up = this.parent.get(item);
    if (up === undefined || up === item) return item;
    const root = this.find(up);
    this.parent.set(item, root);
    return root;
  }

  join(a: number, b: number): void {
    const [low, high] = a < b ? [a, b] : [b, a];
    this.parent.set(this.find(high), this.find(low));
  }
}

/** `names` -> `name`, `categories` -> `category`: the field a container's entries become. */
function singular(name: string): string {
  if (/[^aeiou]ies$/.test(name)) return `${name.slice(0, -3)}y`;
  if (/[^s]s$/.test(name)) return name.slice(0, -1);
  return name;
}

function headline(group: readonly Container[]): string {
  const key = group[0]?.keyShown ?? "";
  const both = group.length === 2 ? "both" : "all";
  return fitted(
    (cut) =>
      `${namesText(
        group.map((container) => container.name),
        cut,
      )} are ${both} keyed by \`${cut(key)}\` and always written together`,
  );
}

function hint(group: readonly Container[], owners: readonly string[]): string {
  const key = group[0]?.keyShown ?? "";
  const shown = owners.slice(0, MAX_SITES).map((name) => `\`${name}\``);
  const more = owners.length - shown.length;
  const where = `${shown.join(", ")}${more > 0 ? ` and ${String(more)} more` : ""}`;
  return fitted(
    (cut) =>
      `one \`Record<${cut(key)}, { ${group.map((container) => cut(singular(container.name))).join("; ")} }>\` cannot get out of step (written together in ${where})`,
  );
}

/** The findings for the containers of one scope. */
const OPTIONS = {
  minFunctions: option.number({
    default: 1,
    min: 1,
    integer: true,
    description:
      "How many functions must write the tables together with one key before they count as kept in step.",
  }),
  plainStringKeys: option.boolean({
    default: true,
    description:
      "Count tables keyed by a plain `string` or `number`; false keeps only named key types like `UserId`, which rarely meet by chance.",
  }),
  ignore: option.strings({
    default: [],
    description: "Table names (globs like *Cache) that may be kept apart.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

/** `NoteId` -> `a note`; a key type that is not named `…Id` gives `an entry`. */
function entryText(keyShown: string): string {
  const match = /^([A-Za-z][A-Za-z0-9]*?)Id$/.exec(keyShown);
  const noun =
    match?.[1] === undefined
      ? "entry"
      : match[1].replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return `${/^[aeio]/.test(noun) ? "an" : "a"} ${noun}`;
}

const IGNORE_HINT =
  "or if they live for different times on purpose: `// stateward-ignore records/keyed-maps-out-of-sync: <why>`";

/** A key or a reset in one handler that its partner does not get. */
type Gap = {
  readonly removal: Write;
  readonly removed: Container;
  readonly missing: Container;
};

function gapHeadline(gap: Gap): string {
  const reset = gap.removal.kind === "reset";
  const build = (cut: (text: string) => string, withHandler: boolean): string => {
    const removed = `\`${cut(gap.removed.name)}\``;
    const missing = `\`${cut(gap.missing.name)}\``;
    const core = reset
      ? `clearing ${removed} does not clear ${missing}`
      : `deleting ${entryText(gap.removed.keyShown)} removes it from ${removed} but not from ${missing}`;
    return withHandler ? `${core} (in \`${cut(gap.removal.ownerName)}\`)` : core;
  };
  const full = build((text) => shorten(text), true);
  return full.length <= MAX_HEADLINE ? full : fitted((cut) => build(cut, false));
}

function gapHint(gap: Gap): string {
  return `${gap.removal.kind === "reset" ? "clear" : "remove it from"} both here, ${IGNORE_HINT}`;
}

function gapNote(gap: Gap): string {
  const verb = gap.removal.kind === "reset" ? "clear" : "remove from";
  return `\`${gap.missing.name}\` is declared here; \`${gap.removal.ownerName}\` does not ${verb} it`;
}

function checkScope(scope: Scope, ctx: FileContext<Settings>): void {
  const { options } = ctx;
  const containers = scope.containers.filter(
    (container) =>
      !matchesName(container.name, options.ignore) &&
      (options.plainStringKeys ||
        (container.keyType !== "string" && container.keyType !== "number")),
  );
  if (containers.length < 2) return;
  const writes = writesOf(scope, ctx);
  if (writes.length < 2) return;
  const minFunctions = options.minFunctions;

  // Kept in step: per pair of containers with one key type, the handlers that change both with one
  // key expression. A keyless change (a reset) is not evidence.
  const keyed = writes.filter((write) => write.kind !== "reset" && write.key !== "");
  const groups = new Groups();
  const linked = new Set<number>();
  const pairs: (readonly [Container, Container])[] = [];
  const together = new Map<string, readonly Write[]>();
  for (const a of containers) {
    for (const b of containers) {
      if (a.order >= b.order || a.keyType !== b.keyType) continue;
      const owners = new Map<ts.Node, Write[]>();
      for (const first of keyed) {
        if (first.container !== a.order || first.reads.has(b.order)) continue;
        for (const second of keyed) {
          if (second.container !== b.order || second.reads.has(a.order)) continue;
          if (second.owner !== first.owner || second.key !== first.key) continue;
          owners.set(first.owner, [...(owners.get(first.owner) ?? []), first, second]);
        }
      }
      if (owners.size < minFunctions) continue;
      groups.join(a.order, b.order);
      linked.add(a.order);
      linked.add(b.order);
      pairs.push([a, b]);
      together.set(`${String(a.order)}:${String(b.order)}`, [...owners.values()].flat());
    }
  }

  // Removals: per handler, a pair where one container loses a key or is reset and the other does not.
  const removals = writes.filter((write) => write.kind !== "write");
  // A table that loses keys in a `finally` or a timer's callback marks work in progress (a save in
  // flight, a pending timeout): it lives for a shorter time than its partner on purpose (real-world corpus:
  // excalidraw's `savingFiles`, memos' `pendingSaves`).
  const transient = new Set(
    removals.filter((removal) => endsWork(removal.node)).map((removal) => removal.container),
  );
  const gaps: Gap[] = [];
  for (const [a, b] of pairs) {
    for (const [removed, missing] of [
      [a, b],
      [b, a],
    ] as const) {
      if (transient.has(removed.order)) continue;
      const seen = new Set<ts.Node>();
      for (const removal of removals) {
        if (removal.container !== removed.order || seen.has(removal.owner)) continue;
        seen.add(removal.owner);
        const partner = removals.some(
          (other) => other.container === missing.order && other.owner === removal.owner,
        );
        if (!partner) gaps.push({ removal, removed, missing });
      }
    }
  }
  gaps.sort(
    (x, y) =>
      x.removal.node.getStart() - y.removal.node.getStart() || x.missing.order - y.missing.order,
  );
  const gapGroups = new Set<number>();
  for (const gap of gaps) {
    gapGroups.add(groups.find(gap.removed.order));
    ctx.report({
      node: gap.removal.node,
      message: gapHeadline(gap),
      hint: gapHint(gap),
      related: [{ node: gap.missing.node, message: gapNote(gap) }],
    });
  }

  const byRoot = new Map<number, Container[]>();
  for (const container of containers) {
    if (!linked.has(container.order)) continue;
    const root = groups.find(container.order);
    byRoot.set(root, [...(byRoot.get(root) ?? []), container]);
  }
  for (const [root, group] of byRoot) {
    const first = group[0];
    if (first === undefined || gapGroups.has(root)) continue;
    if (!everyChangePaired(group, writes)) continue;
    const inGroup = new Set(group.map((container) => container.order));
    const sites = [...together.entries()]
      .filter(([pair]) => pair.split(":").every((order) => inGroup.has(Number(order))))
      .flatMap(([, found]) => found)
      .sort((a, b) => a.node.getStart() - b.node.getStart());
    // One note per handler: its first write.
    const firstPerOwner = new Map<ts.Node, Write>();
    for (const write of sites)
      if (!firstPerOwner.has(write.owner)) firstPerOwner.set(write.owner, write);
    const notes = [...firstPerOwner.values()];
    const names = group.map((container) => container.name);
    ctx.report({
      node: first.node,
      message: headline(group),
      hint: hint(group, [...new Set(notes.map((write) => write.ownerName))]),
      severity: "info",
      related: notes.map((write) => ({
        node: write.node,
        message: `\`${write.ownerName}\` writes ${namesText(names, (text) => text)} with \`${write.key}\``,
      })),
    });
  }
}

/** Calls that run a callback later: a removal in one ends a pending timeout. */
const TIMERS = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "requestIdleCallback",
]);

/**
 * Whether a removal ends work in progress: it sits in a `finally` block of its function, or in a
 * function given to a timer (`setTimeout(() => pending.delete(key))`).
 */
function endsWork(node: ts.Node): boolean {
  for (let current = node; !ts.isSourceFile(current); current = current.parent) {
    const parent = current.parent;
    if (ts.isTryStatement(parent) && parent.finallyBlock === current) return true;
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      if (!ts.isCallExpression(parent) || !parent.arguments.includes(current)) return false;
      const callee = skipWrappers(parent.expression);
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      return name !== undefined && TIMERS.has(name);
    }
    if (ts.isFunctionLike(current)) return false;
  }
  return false;
}

/**
 * Whether every handler that changes one container of the group changes all of them: each keyed
 * change has a change of every other container with the same key beside it, and each removal or
 * reset comes with the removal or reset of the others. Only then is "one record" safe advice.
 */
function everyChangePaired(group: readonly Container[], writes: readonly Write[]): boolean {
  const inGroup = new Set(group.map((container) => container.order));
  const ours = writes.filter((write) => inGroup.has(write.container));
  const handlers = new Set(ours.map((write) => write.owner));
  for (const handler of handlers) {
    const here = ours.filter((write) => write.owner === handler);
    const removed = new Set(
      here.filter((write) => write.kind !== "write").map((write) => write.container),
    );
    if (removed.size > 0 && removed.size < group.length) return false;
    for (const write of here) {
      if (write.kind === "reset" || write.key === "") continue;
      for (const other of group) {
        if (other.order === write.container) continue;
        const partner = here.some(
          (candidate) =>
            candidate.container === other.order &&
            candidate.key === write.key &&
            !write.reads.has(other.order) &&
            !candidate.reads.has(write.container),
        );
        if (!partner) return false;
      }
    }
  }
  return true;
}

function moduleScope(ctx: FileContext): Scope {
  const containers: Container[] = [];
  for (const statement of ctx.sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const key = keyTypeOfDeclaration(declaration, ctx);
      const container =
        key === undefined
          ? undefined
          : containerOf(declaration.name, key, containers.length, undefined, ctx);
      if (container !== undefined) containers.push(container);
    }
  }
  return { containers, root: ctx.sourceFile, skip: () => false };
}

function classScope(node: ts.ClassLikeDeclaration, ctx: FileContext): Scope {
  const containers: Container[] = [];
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) continue;
    const key = keyTypeOfDeclaration(member, ctx);
    const container =
      key === undefined
        ? undefined
        : containerOf(member.name, key, containers.length, undefined, ctx);
    if (container !== undefined) containers.push(container);
  }
  return { containers, root: node, skip: () => false };
}

/** The key type of `useState<Record<K, V>>()` or `useState(new Map<K, V>())`. */
function stateKeyType(call: ts.CallExpression, ctx: FileContext): ts.TypeNode | undefined {
  const [typeArgument] = call.typeArguments ?? [];
  if (typeArgument !== undefined) return keyTypeNode(typeArgument, ctx);
  const [initial] = call.arguments;
  return initial === undefined ? undefined : keyTypeOfValue(initial, ctx);
}

function hookScope(component: ts.FunctionLikeDeclaration, ctx: FileContext): Scope {
  const containers: Container[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== component && isComponentOrHook(node)) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      ts.isArrayBindingPattern(node.name) &&
      isReactUseState(node.initializer, ctx)
    ) {
      const [value, setter] = node.name.elements;
      const key = stateKeyType(node.initializer, ctx);
      if (
        key !== undefined &&
        value !== undefined &&
        !ts.isOmittedExpression(value) &&
        ts.isIdentifier(value.name)
      ) {
        const setterName =
          setter !== undefined && !ts.isOmittedExpression(setter) && ts.isIdentifier(setter.name)
            ? setter.name
            : undefined;
        const container = containerOf(value.name, key, containers.length, setterName, ctx);
        if (container !== undefined) containers.push(container);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (component.body !== undefined) visit(component.body);
  return {
    containers,
    root: component,
    skip: (node) => isComponentOrHook(node),
  };
}

export const keyedMapsOutOfSync = defineRule({
  kind: "file",
  meta: {
    description:
      "Two records kept in step must lose a key together: a key removed from one and forgotten in the other is reported.",
    defaultSeverity: "warning",
    tier: "addon",
    addon: "keyed-maps",
    group: "keys",
    heuristic: true,
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    checkScope(moduleScope(ctx), ctx);
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        checkScope(classScope(node, ctx), ctx);
      }
      if (isComponentOrHook(node)) checkScope(hookScope(node, ctx), ctx);
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
