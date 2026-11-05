import ts from "@stateward/core/typescript";
import type { FileContext } from "@stateward/core";
import { shapeOf, type Shape } from "./shapes.js";
import { classifyUse, type Use } from "./uses.js";

/**
 * Where the quick fixes edit: delete `[removeStart, removeEnd)` (the annotation with its colon)
 * and insert at `insertAt` (after the initializer); or replace the type `[typeStart, removeEnd)`.
 */
export type FixSpan = {
  removeStart: number;
  removeEnd: number;
  insertAt: number;
  typeStart: number;
};

/** A variable whose keys are fixed in its source, declared in the file. */
export type Candidate = {
  id: string;
  name: string;
  kind: "record" | "map";
  start: number;
  end: number;
  /** The object literal or `new Map(...)`, where the keys are listed. */
  literal: { start: number; end: number };
  /** The keys as code reads them (`"1"` for `1`), and as a message shows them. */
  keys: string[];
  labels: string[];
  /** How the declaration starts, as a message example shows it: `export const `, `let `. */
  declares: string;
  /** The annotation as written, on one line; empty for a Map. */
  typeText: string;
  /** Null when there is no annotation to replace (a Map). */
  fix: FixSpan | null;
  /** `string` for `Record<string, V>`, `number` for `Record<number, V>`. */
  keyKind: "string" | "number";
  /** The value type `V` as written (`string`), on one line; empty for a Map. */
  valueText: string;
  /**
   * A union type in scope whose members are exactly the table's keys (`Action`), so the fixed
   * table can be checked against it; null when there is none.
   */
  keysType: string | null;
  /**
   * Every union type in scope whose members are exactly the table's keys, by the name the file
   * uses (`name`), the name it is declared with and its file: a read's key type found here needs
   * no import.
   */
  keyTypes: KeyUnion[];
  /** Where an import the fix adds goes: after the last import, or the directives, or at the start. */
  importAt: number;
};

/**
 * A named union a read looks the table up with (`labels[touchpointStatus()]`): its name, the
 * file that declares it, its members, and where the table's file imports it from (null when it is
 * declared in the table's own file).
 */
export type KeyType = { name: string; file: string; keys: string[]; specifier: string | null };

/** Everything one file does to the fixed-key variables it can see, summed per variable. */
export type UseSummary = {
  id: string;
  writes: boolean;
  escapes: boolean;
  /** Reads a key that is not one of a few literals (and does not come from `Object.keys` of it). */
  unknownKey: boolean;
  /** Reads with a key taken from `Object.keys` of this same variable. */
  selfKeyed: boolean;
  keys: string[];
  /** Some read with a wider key handles a missing entry (`Use.handled`). */
  handledWide: boolean;
  /** Some read with a wider key does not handle a missing entry. */
  unhandledWide: boolean;
  /** The named unions reads look the variable up with, sorted by name and file. */
  keyTypes: KeyType[];
};

export type FileSummary = {
  candidates: Candidate[];
  uses: UseSummary[];
  /** Local names this file gives imported fixed-key variables (`import { a as b }`). */
  aliases: { id: string; name: string }[];
  /** Names used as `{ name }` in an object literal; the variable behind one is not resolved. */
  shorthand: string[];
  /** Files whose whole namespace this file passes on (`foo(ns)`). */
  moduleEscapes: string[];
  /** Files this file re-exports from. */
  reexports: string[];
  /** Names of variables declared outside the project that this file changes or passes on. */
  foreign: string[];
};

type Collector = {
  uses: Map<string, UseSummary>;
  aliases: { id: string; name: string }[];
  shorthand: Set<string>;
  moduleEscapes: Set<string>;
  reexports: Set<string>;
  foreign: Set<string>;
};

function emptyUse(id: string): UseSummary {
  return {
    id,
    writes: false,
    escapes: false,
    unknownKey: false,
    selfKeyed: false,
    keys: [],
    handledWide: false,
    unhandledWide: false,
    keyTypes: [],
  };
}

/** Records the named union a read looks a table up with, once. */
function addKeyType(collector: Collector, id: string, keyType: KeyType): void {
  const sum = collector.uses.get(id);
  if (sum === undefined) return;
  if (sum.keyTypes.some((known) => known.name === keyType.name && known.file === keyType.file)) {
    return;
  }
  sum.keyTypes.push(keyType);
}

/**
 * The named union of the key of `reference[key]`, and where the table's file (`tableFile`)
 * imports it from; undefined when the key's type has no name, or the table's file cannot import it.
 */
function keyTypeOf(
  reference: ts.Expression,
  tableFile: string,
  ctx: FileContext,
): KeyType | undefined {
  const access = reference.parent;
  if (!ts.isElementAccessExpression(access) || access.expression !== reference) return undefined;
  const key = access.argumentExpression;
  const alias = ctx.types.typeAliasOf(key);
  const keys = alias && unionKeys(key, ctx);
  if (alias === undefined || keys === undefined) return undefined;
  if (alias.file === tableFile) return { ...alias, keys: [...keys], specifier: null };
  const specifier = ctx.types.importSpecifierFor(alias, tableFile);
  return specifier === undefined ? undefined : { ...alias, keys: [...keys], specifier };
}

function addUse(collector: Collector, id: string, use: Use): void {
  if (use.kind === "none") return;
  const sum = collector.uses.get(id) ?? emptyUse(id);
  collector.uses.set(id, sum);
  switch (use.kind) {
    case "write":
      sum.writes = true;
      return;
    case "escape":
      sum.escapes = true;
      return;
    case "read":
      sum.selfKeyed ||= use.selfKeyed;
      if (use.keys === null && use.handled === true) sum.handledWide = true;
      else if (use.keys === null) sum.unhandledWide = true;
      if (use.keys === null) sum.unknownKey = true;
      else for (const key of use.keys) if (!sum.keys.includes(key)) sum.keys.push(key);
      return;
    default: {
      const unreachable: never = use;
      return unreachable;
    }
  }
}

function declaresOf(declaration: ts.VariableDeclaration): string {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent)) return "const ";
  const exported = list.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  return `${exported === true ? "export " : ""}${(list.flags & ts.NodeFlags.Let) !== 0 ? "let" : "const"} `;
}

/** The `V` of `Record<string, V>` or `{ [key: string]: V }` as written; undefined for another form. */
function writtenValue(type: ts.TypeNode, sourceFile: ts.SourceFile): string | undefined {
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "Record" &&
    type.typeArguments?.length === 2
  ) {
    return type.typeArguments[1]?.getText(sourceFile);
  }
  if (ts.isTypeLiteralNode(type) && type.members.length === 1) {
    const [member] = type.members;
    if (member !== undefined && ts.isIndexSignatureDeclaration(member)) {
      return member.type.getText(sourceFile);
    }
  }
  return undefined;
}

function candidateOf(
  shape: Shape,
  id: string,
  ctx: FileContext,
  unions: readonly KeyUnion[],
  importAt: number,
): Candidate {
  const { declaration, name, literal, keys } = shape;
  const { sourceFile } = ctx;
  const { type, initializer } = declaration;
  const annotated = type !== undefined && initializer !== undefined && shape.kind === "record";
  const index = shape.kind === "record" ? ctx.types.indexSignatureOf(name) : undefined;
  const written = type === undefined ? undefined : writtenValue(type, sourceFile);
  const keyNames = keys.map((key) => key.name).sort();
  const matching = unions.filter(
    (candidate) =>
      candidate.keys.length === keyNames.length &&
      candidate.keys.every((key, at) => key === keyNames[at]),
  );
  const [union] = matching;
  return {
    id,
    name: name.text,
    kind: shape.kind,
    start: name.getStart(sourceFile),
    end: name.end,
    literal: { start: literal.getStart(sourceFile), end: literal.end },
    declares: declaresOf(declaration),
    keys: keys.map((key) => key.name),
    labels: keys.map((key) => key.label),
    typeText:
      type === undefined || shape.kind === "map"
        ? ""
        : type.getText(sourceFile).replace(/\s+/g, " "),
    fix: annotated
      ? {
          removeStart: name.end,
          removeEnd: type.end,
          insertAt: initializer.end,
          typeStart: type.getStart(sourceFile),
        }
      : null,
    keyKind: index?.keyKind ?? "string",
    valueText: (written ?? index?.valueText ?? "").replace(/\s+/g, " "),
    keysType: shape.kind === "record" ? (union?.name ?? null) : null,
    keyTypes: shape.kind === "record" ? matching : [],
    importAt,
  };
}

/**
 * A union of string or number literals with a name in this file: `type Action = "a" | "b"`, by
 * the name the file uses, the name it is declared with (`declared`) and the file that declares it.
 */
type KeyUnion = { name: string; keys: readonly string[]; declared: string; file: string };

/** After the last import, else after the directives (`"use client"`), else the start of the file. */
function importPlace(sourceFile: ts.SourceFile): number {
  let at = 0;
  for (const statement of sourceFile.statements) {
    const directive =
      ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
    if (ts.isImportDeclaration(statement) || (directive && at === statement.pos))
      at = statement.end;
  }
  return at;
}

function unionKeys(node: ts.Node, ctx: FileContext): readonly string[] | undefined {
  const found = ctx.types.literalsOf(node);
  if (found === "not-finite" || found.length === 0) return undefined;
  const keys: string[] = [];
  for (const literal of found) {
    if (typeof literal.value !== "string" && typeof literal.value !== "number") return undefined;
    keys.push(String(literal.value));
  }
  return keys.sort();
}

/**
 * The literal unions a type in this file can name: its own top-level `type` aliases and the
 * aliases it imports (under the local name), in source order.
 */
function unionsInScope(ctx: FileContext): KeyUnion[] {
  const unions: KeyUnion[] = [];
  const add = (name: string, node: ts.TypeAliasDeclaration): void => {
    const keys = unionKeys(node.type, ctx);
    const file = node.getSourceFile().fileName;
    if (keys !== undefined) unions.push({ name, keys, declared: node.name.text, file });
  };
  for (const statement of ctx.sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.typeParameters === undefined) {
      add(statement.name.text, statement);
    }
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const symbol = ctx.types.symbolAt(element.name);
      const declared = symbol && ctx.types.declarationOf(symbol);
      const node = declared?.node;
      if (
        node !== undefined &&
        ts.isTypeAliasDeclaration(node) &&
        node.typeParameters === undefined
      ) {
        add(element.name.text, node);
      }
    }
  }
  return unions;
}

/** Whether the identifier only names something, so it is not a reference to a variable. */
function isNameOnly(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent)) {
    // `ns.labels` may reach a variable through a namespace import; `a.b.labels` cannot.
    return parent.name === identifier && !ts.isIdentifier(parent.expression);
  }
  if (ts.isBindingElement(parent)) return parent.initializer !== identifier;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isShorthandPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return parent.name === identifier;
  }
  return (
    ts.isTypeReferenceNode(parent) ||
    ts.isQualifiedName(parent) ||
    ts.isJsxAttribute(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent)
  );
}

function declaredFile(
  identifier: ts.Identifier,
  ctx: FileContext,
): { file: string; node: ts.Node; id: string } | undefined {
  const symbol = ctx.types.symbolAt(identifier);
  const declaration = symbol && ctx.types.declarationOf(symbol);
  return symbol && declaration ? { ...declaration, id: symbol.id } : undefined;
}

/** Records that this file passes the namespace of a module on as a whole. */
function visitNamespace(
  identifier: ts.Identifier,
  module: string,
  collector: Collector,
  ctx: FileContext,
): void {
  const parent = identifier.parent;
  const member = ts.isPropertyAccessExpression(parent) && parent.expression === identifier;
  const typeOnly = ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent);
  if (!member && !typeOnly && ctx.types.isOwnFile(module)) collector.moduleEscapes.add(module);
}

function visitReference(
  identifier: ts.Identifier,
  collector: Collector,
  ctx: FileContext,
  shapes: Map<string, Shape | null>,
): void {
  const declared = declaredFile(identifier, ctx);
  if (declared === undefined) return;
  if (ts.isSourceFile(declared.node)) {
    visitNamespace(identifier, declared.file, collector, ctx);
    return;
  }
  const own = ctx.types.isOwnFile(declared.file);
  const reference =
    ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier
      ? identifier.parent
      : identifier;
  if (own) {
    if (!shapes.has(declared.id))
      shapes.set(declared.id, shapeOf(declared.node, ctx.types) ?? null);
    const shape = shapes.get(declared.id);
    if (shape === null || shape === undefined) return;
    const parent = identifier.parent;
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) {
      if (parent.name === identifier)
        collector.aliases.push({ id: declared.id, name: identifier.text });
      return;
    }
    if (isTypeQuery(identifier)) return;
    addUse(collector, declared.id, classifyUse(reference, shape.kind, ctx.types));
    const keyType = shape.kind === "record" ? keyTypeOf(reference, declared.file, ctx) : undefined;
    if (keyType !== undefined) addKeyType(collector, declared.id, keyType);
    return;
  }
  visitForeign(identifier, reference, declared.node, collector, ctx);
}

function isTypeQuery(identifier: ts.Identifier): boolean {
  let current: ts.Node = identifier;
  while (ts.isQualifiedName(current.parent)) current = current.parent;
  return ts.isTypeQueryNode(current.parent);
}

function changes(use: Use): boolean {
  return use.kind === "write" || use.kind === "escape";
}

/**
 * A variable declared outside the checked files may be the compiled twin of one declared inside
 * them (a referenced project is read as `.d.ts`). When this file changes it or passes it on, the
 * name is recorded, and a fixed-key variable of that name stays quiet.
 */
function visitForeign(
  identifier: ts.Identifier,
  reference: ts.Expression,
  declaration: ts.Node,
  collector: Collector,
  ctx: FileContext,
): void {
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return;
  if (isTypeQuery(identifier)) return;
  const asRecord = changes(classifyUse(reference, "record", ctx.types));
  const asMap = changes(classifyUse(reference, "map", ctx.types));
  if (!asRecord && !asMap) return;
  const { type } = declaration;
  const isMap =
    type !== undefined && ts.isTypeReferenceNode(type) && type.typeName.getText() === "Map";
  const found = ctx.types.propertyKeysOf(declaration.name);
  const isRecord =
    found !== "not-object" &&
    found !== "generic" &&
    found.indexSignature &&
    found.required.length === 0 &&
    found.optional.length === 0;
  if ((isMap && asMap) || (isRecord && asRecord)) collector.foreign.add(identifier.text);
}

function visit(
  node: ts.Node,
  collector: Collector,
  candidates: Candidate[],
  ctx: FileContext,
  shapes: Map<string, Shape | null>,
  unions: () => readonly KeyUnion[],
): void {
  if (ts.isVariableDeclaration(node)) {
    const shape = shapeOf(node, ctx.types);
    const symbol = shape === undefined ? undefined : ctx.types.symbolAt(shape.name);
    if (shape !== undefined && symbol !== undefined) {
      shapes.set(symbol.id, shape);
      candidates.push(
        candidateOf(
          shape,
          symbol.id,
          ctx,
          shape.kind === "record" ? unions() : [],
          importPlace(ctx.sourceFile),
        ),
      );
    }
  } else if (ts.isShorthandPropertyAssignment(node)) {
    collector.shorthand.add(node.name.text);
  } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
    const symbol = ctx.types.symbolAt(node.moduleSpecifier);
    const module = symbol && ctx.types.declarationOf(symbol);
    if (module !== undefined && ctx.types.isOwnFile(module.file))
      collector.reexports.add(module.file);
  } else if (ts.isIdentifier(node) && !isNameOnly(node)) {
    visitReference(node, collector, ctx, shapes);
  }
  ts.forEachChild(node, (child) => {
    visit(child, collector, candidates, ctx, shapes, unions);
  });
}

function sorted<T extends string>(items: Iterable<T>): T[] {
  return [...items].sort();
}

/** The file's candidates and everything it does to fixed-key variables; undefined when nothing. */
export function summarizeFile(ctx: FileContext): FileSummary | undefined {
  const collector: Collector = {
    uses: new Map(),
    aliases: [],
    shorthand: new Set(),
    moduleEscapes: new Set(),
    reexports: new Set(),
    foreign: new Set(),
  };
  const candidates: Candidate[] = [];
  // Found once per file, and only when it declares a table.
  let unions: readonly KeyUnion[] | undefined;
  const inScope = (): readonly KeyUnion[] => (unions ??= unionsInScope(ctx));
  visit(ctx.sourceFile, collector, candidates, ctx, new Map(), inScope);
  const uses = [...collector.uses.values()]
    .map((use) => ({
      ...use,
      keys: use.keys.sort(),
      keyTypes: use.keyTypes.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
      ),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const summary: FileSummary = {
    candidates,
    uses,
    aliases: collector.aliases,
    shorthand: sorted(collector.shorthand),
    moduleEscapes: sorted(collector.moduleEscapes),
    reexports: sorted(collector.reexports),
    foreign: sorted(collector.foreign),
  };
  const empty =
    candidates.length === 0 &&
    uses.length === 0 &&
    collector.aliases.length === 0 &&
    collector.shorthand.size === 0 &&
    collector.moduleEscapes.size === 0 &&
    collector.reexports.size === 0 &&
    collector.foreign.size === 0;
  return empty ? undefined : summary;
}
