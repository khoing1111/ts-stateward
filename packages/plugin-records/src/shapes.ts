import path from "node:path";
import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";

/** A key written in the source: `name` is what code reads it by, `label` how a message shows it. */
export type SourceKey = { name: string; label: string };

/** A variable that might have a fixed set of keys, judged from its declaration alone. */
export type Shape = {
  kind: "record" | "map";
  declaration: ts.VariableDeclaration;
  name: ts.Identifier;
  /** The object literal, or the `new Map(...)` expression. */
  literal: ts.Expression;
  keys: readonly SourceKey[];
};

/** A string or number literal: the same key wherever it is read. */
function literalKey(name: ts.Node): SourceKey | undefined {
  if (ts.isStringLiteral(name)) return { name: name.text, label: JSON.stringify(name.text) };
  if (ts.isNumericLiteral(name)) {
    const text = String(Number(name.text));
    return { name: text, label: text };
  }
  return undefined;
}

/** A property name in an object literal: an identifier is its own text, not a variable. */
function propertyKey(name: ts.PropertyName): SourceKey | undefined {
  if (ts.isIdentifier(name)) return { name: name.text, label: JSON.stringify(name.text) };
  return literalKey(name);
}

function literalKeys(literal: ts.ObjectLiteralExpression): readonly SourceKey[] | undefined {
  const keys: SourceKey[] = [];
  for (const property of literal.properties) {
    const named =
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property);
    const key = named ? propertyKey(property.name) : undefined;
    if (key === undefined) return undefined;
    keys.push(key);
  }
  return keys.length > 0 ? keys : undefined;
}

function pairKeys(pairs: ts.ArrayLiteralExpression): readonly SourceKey[] | undefined {
  const keys: SourceKey[] = [];
  for (const pair of pairs.elements) {
    if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2) return undefined;
    const first = pair.elements[0];
    const key = first === undefined ? undefined : literalKey(first);
    if (key === undefined) return undefined;
    keys.push(key);
  }
  return keys.length > 0 ? keys : undefined;
}

/** `const`, or `let`: a `let` is judged by whether anything assigns it (see uses.ts). */
function isConstOrLet(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent)) return false;
  // `using` declarations carry their own flag, and are disposed, not kept.
  if ((list.flags & ts.NodeFlags.Using) !== 0) return false;
  return (list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0;
}

/** The global `Map`: declared in a TypeScript library file, not in the project. */
function isGlobalMap(callee: ts.Expression, types: TypeQueries): boolean {
  if (!ts.isIdentifier(callee) || callee.text !== "Map") return false;
  const symbol = types.symbolAt(callee);
  const declaration = symbol && types.declarationOf(symbol);
  return (
    declaration !== undefined &&
    !types.isOwnFile(declaration.file) &&
    path.basename(declaration.file).startsWith("lib.")
  );
}

function recordShape(
  declaration: ts.VariableDeclaration,
  name: ts.Identifier,
  types: TypeQueries,
): Shape | undefined {
  const { initializer, type } = declaration;
  if (
    initializer === undefined ||
    type === undefined ||
    !ts.isObjectLiteralExpression(initializer)
  ) {
    return undefined;
  }
  const keys = literalKeys(initializer);
  if (keys === undefined) return undefined;
  const declared = types.propertyKeysOf(name);
  // A record whose keys are a type parameter is not an open-ended map: nothing to say.
  if (declared === "not-object" || declared === "generic") return undefined;
  const open = declared.required.length === 0 && declared.optional.length === 0;
  // `Partial<Record<string, V>>` or `{ [key: string]: V | undefined }`: an open dictionary, as
  // stated, whose lookups may find nothing (principle 5: the type says the intent).
  if (types.indexSignatureOf(name)?.valueCanBeUndefined === true) return undefined;
  return open && declared.indexSignature
    ? { kind: "record", declaration, name, literal: initializer, keys }
    : undefined;
}

function mapShape(
  declaration: ts.VariableDeclaration,
  name: ts.Identifier,
  types: TypeQueries,
): Shape | undefined {
  const { initializer, type } = declaration;
  if (initializer === undefined || !ts.isNewExpression(initializer)) return undefined;
  const pairs = initializer.arguments?.length === 1 ? initializer.arguments[0] : undefined;
  if (pairs === undefined || !ts.isArrayLiteralExpression(pairs)) return undefined;
  if (
    type !== undefined &&
    !(
      ts.isTypeReferenceNode(type) &&
      ts.isIdentifier(type.typeName) &&
      type.typeName.text === "Map"
    )
  ) {
    return undefined;
  }
  const keys = pairKeys(pairs);
  if (keys === undefined || !isGlobalMap(initializer.expression, types)) return undefined;
  return { kind: "map", declaration, name, literal: initializer, keys };
}

/**
 * Whether `node` declares a variable whose keys are fixed in its source: a `const` (or `let`)
 * initialised with an object literal and typed by an open index signature, or with a `new Map` of
 * literal pairs. Whether anything changes those keys is decided over the whole project.
 */
export function shapeOf(node: ts.Node, types: TypeQueries): Shape | undefined {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !isConstOrLet(node)) {
    return undefined;
  }
  return recordShape(node, node.name, types) ?? mapShape(node, node.name, types);
}
