import path from "node:path";
import ts from "@stateward/core/typescript";
import {
  defineRule,
  matchesFile,
  option,
  type FileContext,
  type Fix,
  type Json,
  type LedgerRef,
  type OptionsOf,
  type ReadOutcome,
  type SymbolRef,
} from "@stateward/core";
import { fitted, withFix } from "./text.js";
import { markerForms, OPAQUE_TEXT, type Edit } from "./declare-owned.js";

const EXPLAIN = `# ownership/brand-built-outside-owner

A cast to a checked brand like \`Positive\` outside its check skips the validation the brand stands for, so the type promises more than the value holds.

\`values.ts\` declares the brand and its check:

\`\`\`ts example-bad file=values.ts
export type Positive = number & { readonly __brand: "Positive" };

export function positive(value: number): Positive | undefined {
  return value > 0 ? (value as Positive) : undefined;
}
\`\`\`

\`cart.ts\` builds one with a cast:

\`\`\`ts example-bad file=cart.ts
import type { Positive } from "./values.js";

export function quantity(input: { qty: number }): Positive {
  return input.qty as Positive;
}
\`\`\`

In \`cart.ts\`, call the brand's check instead, and handle the value it rejects:

\`\`\`ts example-good file=cart.ts
import { positive, type Positive } from "./values.js";

export function quantity(input: { qty: number }): Positive | undefined {
  return positive(input.qty);
}
\`\`\`

Or move the cast into the file that declares the brand. There is no quick fix.

## Why it matters

A branded type promises that every value of it passed a check. A cast skips the check: \`input.qty as Positive\` compiles for \`-5\`, and \`charge(qty)\` then bills a negative amount. After one such cast, the brand no longer tells anyone anything.

## What it does not catch

It reports a cast to a branded type outside the file that declares it (\`x as Positive\`, \`<Positive>x\`, \`x as unknown as Positive\`, also inside a type such as \`Positive | undefined\`, \`Positive[]\` or \`{ qty: Positive }\`, and through a local alias), and a type predicate or assertion function (\`(x): x is Positive\`, \`asserts x is Positive\`) outside that file, since it tells every caller a value was checked. It does not see:

- \`x as any\`, or any other \`any\` value: TypeScript lets \`any\` become \`Positive\` without a cast (\`const qty: Positive = JSON.parse(text)\`). Use typescript-eslint's \`no-explicit-any\` and \`no-unsafe-assignment\` for that.
- A cast that only removes \`undefined\` or \`null\` from a value that is already the brand (\`map.get(key) as Positive\`): it is allowed.
- A brand declared in a package, an interface, or written inline in the cast (\`x as string & { __brand: "Id" }\`): there is no owner file to name.
- A brand whose file exports no check (\`type SocketId = string & { _brand: "SocketId" }\`, cast wherever an id arrives): it is a label, with no check to skip. A function made from nothing (\`newSessionId(): SessionId\`) or one that only takes the brand is not a check.
- Arithmetic on brands: \`a + b\` is a plain \`number\`, not a brand.

For a brand stated \`Opaque\`, every place a value of it is produced outside its module is listed and read: a value given to a place typed with it (an initializer, a default value, a returned value, also from an \`async\` function returning \`Promise<OrderId>\`, an argument, \`=\`, \`??=\`, \`||=\`, \`&&=\`, a property or element of a literal), a cast, a type predicate. A value built by the brand's check is fine; one built from anything else is an error. A value of a container given where a container of the brand is expected (\`string[]\` returned as \`OrderId[]\`, \`Map<string, string>\` as \`Map<string, OrderId>\`) is "not checked", as which element the check built cannot be followed: the guarantee reads "not checked", never "proven". Every other way a value of the brand is made, found by its type, is "not checked" at its place too: a generic call whose type arguments give the brand (\`getJson<Order>(url)\`), an overload's implementation, a cast to a type parameter that extends it, \`.call\`, \`.apply\`, \`.bind\`, \`Reflect.apply\`, a spread argument or JSX spread, a \`for…of\` target, \`Object.defineProperty\`, \`Reflect.set\`, \`Object.assign\`, a \`Proxy\`, a function given where one returning the brand is expected.

## Getting the best from it

A brand is recognised by its shape, so no library is needed: a type alias of your project that is an intersection with a tag, either a string literal on a property whose name starts with \`_\` (\`T & { readonly __brand: "UserId" }\`) or a key that is a \`unique symbol\` (\`T & { readonly [brand]: "UserId" }\`), or that applies a generic helper of that shape (\`type Sku = Brand<string, "Sku">\`). The helper itself is a building block, not a brand.

The brand is checked when the file that declares it exports its check: a function that builds the brand from another type (\`positive(value: number): Positive | undefined\`), or a type predicate or assertion function (\`isPositive(value: number): value is Positive\`). That file owns the brand: casts are allowed there, and only there, and the message names the check to call. To make a label brand checked, declare a constructor next to it, or name the files that may build it under \`owners\`.

## Turn it on or off

A brand is only worth having if it cannot be faked, so keep it on; if your brands have no checks, it never fires.

\`\`\`ts
rules: { "ownership/brand-built-outside-owner": "off" } // or "warning"
rules: { "ownership/brand-built-outside-owner": ["error", { owners: { Sku: ["src/codecs/**"] } }] } // more files may build Sku; Sku is checked even with no constructor
\`\`\`
`;

/**
 * A brand that a type assertion builds, and the file that may build it. `stated` when its type
 * states the `opaque` trait (`Opaque<string, "OrderId">`): then every value of it built outside
 * its module is reported, not only a cast.
 */
type BuiltBrand = {
  name: string;
  file: string;
  declaration: ts.TypeAliasDeclaration;
  stated: boolean;
  /** The declaring file's path from the project's folder (`src/ids.ts`), from the symbol's id. */
  relative: string;
};

/** The trait `Opaque<T, Name>` states: `"__guarantee:opaque"?: Name`. */
export const OPAQUE = "opaque";

/**
 * How other files get a checked brand: an exported function of the declaring file that builds it
 * from another type (`positive(value: number): Positive | undefined`), or a type predicate or
 * assertion function (`isPositive(value: number): value is Positive`).
 */
type Constructor = {
  name: string;
  kind: "build" | "check";
  /** What the constructor returns when the value fails its check, if its type says: `undefined`. */
  failure: "undefined" | "null" | undefined;
};

/** A brand that has a check to bypass: a constructor in its file, or files the config names. */
type CheckedBrand = BuiltBrand & { checkedBy: Constructor | undefined };

const OPTIONS = {
  owners: option.record({
    default: {},
    description:
      'Other files that may build a brand, by brand name: `{ "Sku": ["src/codecs/**"] }` (globs from the project\'s folder). A brand named here is checked even when its file exports no constructor.',
  }),
  predicates: option.boolean({
    default: true,
    description:
      "Also report a type predicate or assertion function (`x is Positive`) outside the brand's owner.",
  }),
};

type Settings = OptionsOf<typeof OPTIONS>;

function relativeTo(from: string, to: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return relative.startsWith("..") ? relative : `./${relative}`;
}

function headline(brand: BuiltBrand): string {
  return `\`${brand.name}\` is built without its check`;
}

/** The path of `file` from the project's folder, found by taking the brand file's relative path off its absolute one. */
function projectPath(brand: BuiltBrand, file: string): string {
  if (brand.relative === "" || !brand.file.endsWith(brand.relative)) return file;
  const root = brand.file.slice(0, brand.file.length - brand.relative.length);
  return file.startsWith(root) ? file.slice(root.length) : path.posix.basename(file);
}

/** The endings the file's own relative imports use (`.js`, `.ts`, none), the likeliest first. */
function importEnding(sourceFile: ts.SourceFile): string {
  const relative = sourceFile.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text.startsWith(".")
      ? [statement.moduleSpecifier.text]
      : [],
  );
  if (relative.some((specifier) => specifier.endsWith(".js"))) return ".js";
  if (relative.some((specifier) => specifier.endsWith(".ts"))) return ".ts";
  return "";
}

/**
 * The path the file imports the brand's module with, as the file writes it: the import it
 * already has of the brand, else what TypeScript's own auto-import writes, else the relative path
 * with the ending the file's other imports use.
 */
function importPath(brand: BuiltBrand, ctx: FileContext): string {
  for (const statement of ctx.sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some(
        (element) => (element.propertyName ?? element.name).text === brand.name,
      )
    ) {
      return statement.moduleSpecifier.text;
    }
  }
  const file = slashes(ctx.file);
  const known = ctx.types.importSpecifierFor({ name: brand.name, file: brand.file }, file);
  if (known !== undefined) return known;
  return `${relativeTo(file, brand.file).replace(/\.tsx?$/, "")}${importEnding(ctx.sourceFile)}`;
}

/** The option that lists this file as one that may build the brand, written as the option is. */
function ownersLines(brand: BuiltBrand, file: string): string[] {
  const entry = `{ owners: { ${JSON.stringify(brand.name)}: [${JSON.stringify(file)}] } }`;
  return [`    ${entry}`];
}

function hint(brand: CheckedBrand, ctx: FileContext): string {
  const owner = importPath(brand, ctx);
  const made = brand.checkedBy;
  const own = `or, if this file checks the value itself, list it under the rule's \`owners\` option for \`${brand.name}\`:`;
  const lines = ownersLines(brand, projectPath(brand, slashes(ctx.file)));
  if (made === undefined) {
    return ["one of", `- build it in \`${owner}\`, its owner`, `- ${own}`, ...lines].join("\n");
  }
  const verb = made.kind === "build" ? "build it with" : "check it with";
  const handled =
    made.failure === undefined ? "" : `, and handle the \`${made.failure}\` it returns`;
  return [
    "one of",
    `- ${verb} \`${made.name}()\` from \`${owner}\`${handled}`,
    `- ${own}`,
    ...lines,
  ].join("\n");
}

function slashes(file: string): string {
  return file.replaceAll("\\", "/");
}

/** A chain of aliases this long is a mistake, not a design; stop following it. */
const MAX_ALIAS_DEPTH = 10;

function nameOfReference(reference: ts.TypeReferenceNode): ts.Identifier {
  return ts.isQualifiedName(reference.typeName) ? reference.typeName.right : reference.typeName;
}

function stripTypeParentheses(type: ts.TypeNode): ts.TypeNode {
  let node = type;
  while (ts.isParenthesizedTypeNode(node)) node = node.type;
  return node;
}

/** The declaration a name resolves to (through imports and re-exports), when it is in the project. */
function ownDeclaration(name: ts.Node, ctx: FileContext): ts.Node | undefined {
  const symbol = ctx.types.symbolAt(name);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  return declaration !== undefined && ctx.types.isOwnFile(declaration.file)
    ? declaration.node
    : undefined;
}

/** `declare const brand: unique symbol`: a key no other code can write. */
function isUniqueSymbolKey(name: ts.PropertyName, ctx: FileContext): boolean {
  if (!ts.isComputedPropertyName(name) || !ts.isIdentifier(name.expression)) return false;
  const symbol = ctx.types.symbolAt(name.expression);
  const declaration = symbol === undefined ? undefined : ctx.types.declarationOf(symbol)?.node;
  if (declaration === undefined || !ts.isVariableDeclaration(declaration)) return false;
  const type = declaration.type;
  return (
    type !== undefined &&
    ts.isTypeOperatorNode(type) &&
    type.operator === ts.SyntaxKind.UniqueKeyword &&
    type.type.kind === ts.SyntaxKind.SymbolKeyword
  );
}

/**
 * `__brand`, `_tag`: a property name that says it is not data. A guarantee marker is not one
 * (`"__guarantee:owned"`, or `__guarantee` in the 1.1.0 form): it states a guarantee
 * (`RequiredContext<T>`), which is optional and builds no checked value.
 */
function isTagName(name: ts.PropertyName): boolean {
  return (
    (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
    name.text.startsWith("_") &&
    name.text !== "__guarantee" &&
    !name.text.startsWith("__guarantee:")
  );
}

/** What a tag property's type is: a literal (a brand), a type parameter (a helper), or neither. */
function tagValue(
  type: ts.TypeNode | undefined,
  parameters: readonly string[],
): "literal" | "parameter" | undefined {
  if (type === undefined) return undefined;
  const node = stripTypeParentheses(type);
  if (ts.isLiteralTypeNode(node)) return "literal";
  if (ts.isTemplateLiteralTypeNode(node)) return "literal";
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    parameters.includes(node.typeName.text)
  ) {
    return "parameter";
  }
  return undefined;
}

/**
 * The tag of a brand written as an intersection, `T & { readonly __brand: "X" }` or
 * `T & { readonly [brand]: "X" }`: "literal" for a brand, "parameter" when the tag is one of
 * the alias's own type parameters (a helper like `Brand<T, Name>`), undefined for no tag.
 */
function intersectionTag(
  type: ts.TypeNode,
  parameters: readonly string[],
  ctx: FileContext,
): "literal" | "parameter" | undefined {
  const node = stripTypeParentheses(type);
  if (!ts.isIntersectionTypeNode(node)) return undefined;
  for (const member of node.types) {
    const literal = stripTypeParentheses(member);
    if (!ts.isTypeLiteralNode(literal)) continue;
    for (const property of literal.members) {
      if (!ts.isPropertySignature(property)) continue;
      const unique = isUniqueSymbolKey(property.name, ctx);
      if (!unique && !isTagName(property.name)) continue;
      // A unique-symbol key brands whatever its value; a `_` name only with a literal value.
      const value = tagValue(property.type, parameters);
      if (value !== undefined) return value;
      if (unique) return "literal";
    }
  }
  return undefined;
}

/** A generic helper of the project that brands what it is given: `type Brand<T, Name> = T & { [brand]: Name }`. */
function isBrandHelper(reference: ts.TypeReferenceNode, ctx: FileContext): boolean {
  const declaration = ownDeclaration(nameOfReference(reference), ctx);
  if (declaration === undefined || !ts.isTypeAliasDeclaration(declaration)) return false;
  const parameters = (declaration.typeParameters ?? []).map((parameter) => parameter.name.text);
  return parameters.length > 0 && intersectionTag(declaration.type, parameters, ctx) !== undefined;
}

/**
 * The brand a name stands for, resolved to where it is really declared: the project alias that
 * first applies a brand's shape. A local alias of a brand (`type LocalQty = Positive`) is not a
 * declaration of one; it leads on to the real owner. A helper (`Brand<T, Name>`) is not a brand.
 */
function declaredBrand(
  name: ts.Identifier,
  ctx: FileContext,
  depth: number,
): BuiltBrand | undefined {
  const symbol = ctx.types.symbolAt(name);
  return symbol === undefined ? undefined : brandOfSymbol(symbol, ctx, depth);
}

/**
 * The alias states the `opaque` trait itself (`type OrderId = Opaque<string, "OrderId">`), rather
 * than renaming another alias that does (`type Id = OrderId`) or being the generic marker.
 */
function statesOpaque(declaration: ts.TypeAliasDeclaration, ctx: FileContext): boolean {
  if (declaration.typeParameters !== undefined) return false;
  if (!ctx.types.guaranteesOf(declaration.type).includes(OPAQUE)) return false;
  const type = stripTypeParentheses(declaration.type);
  if (!ts.isTypeReferenceNode(type) || type.typeArguments !== undefined) return true;
  const target = ownDeclaration(nameOfReference(type), ctx);
  return target === undefined || !ts.isTypeAliasDeclaration(target);
}

function brandOfSymbol(symbol: SymbolRef, ctx: FileContext, depth: number): BuiltBrand | undefined {
  const found = ctx.types.declarationOf(symbol);
  if (found === undefined || !ctx.types.isOwnFile(found.file)) return undefined;
  const declaration = found.node;
  if (!ts.isTypeAliasDeclaration(declaration)) return undefined;
  const parameters = (declaration.typeParameters ?? []).map((parameter) => parameter.name.text);
  const type = stripTypeParentheses(declaration.type);
  const own = {
    name: symbol.name,
    file: slashes(found.file),
    declaration,
    stated: false,
    relative: symbol.id.slice(0, Math.max(symbol.id.indexOf("#"), 0)),
  };
  // Asking an alias for its traits checks its whole type: only when some file states `Opaque`.
  if (ctx.types.declaresTrait(OPAQUE) && statesOpaque(declaration, ctx)) {
    return { ...own, stated: true };
  }
  const tag = intersectionTag(type, parameters, ctx);
  if (tag === "literal") return own;
  if (tag === "parameter") return undefined;
  if (ts.isIntersectionTypeNode(type)) {
    // `Brand<string, "Sku"> & Extra`: the helper applied inside an intersection.
    const applied = type.types.some(
      (member) => ts.isTypeReferenceNode(member) && isBrandHelper(member, ctx),
    );
    return applied ? own : undefined;
  }
  if (!ts.isTypeReferenceNode(type)) return undefined;
  if (isBrandHelper(type, ctx)) return own;
  return depth < MAX_ALIAS_DEPTH ? declaredBrand(nameOfReference(type), ctx, depth + 1) : undefined;
}

/** Each brand's constructor, found once per file checked. */
type Constructors = Map<ts.TypeAliasDeclaration, Constructor | undefined>;

function isBrand(name: ts.Identifier, brand: BuiltBrand, ctx: FileContext): boolean {
  return declaredBrand(name, ctx, 0)?.declaration === brand.declaration;
}

/** Whether a type names the brand anywhere in it: `Positive | undefined`, `Promise<Positive>`. */
function mentionsBrand(type: ts.Node, brand: BuiltBrand, ctx: FileContext): boolean {
  const visit = (node: ts.Node): boolean =>
    (ts.isTypeReferenceNode(node) && isBrand(nameOfReference(node), brand, ctx)) ||
    ts.forEachChild(node, visit) === true;
  return visit(type);
}

/** A cast to the brand in a body: how a constructor with no declared return type builds one. */
function castsToBrand(body: ts.Node, brand: BuiltBrand, ctx: FileContext): boolean {
  const visit = (node: ts.Node): boolean =>
    ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      mentionsBrand(node.type, brand, ctx)) ||
    ts.forEachChild(node, visit) === true;
  return visit(body);
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** What a function does for the brand: builds it, checks it, or neither. */
function constructorKind(
  fn: FunctionNode,
  brand: BuiltBrand,
  ctx: FileContext,
): Constructor["kind"] | undefined {
  const returned = fn.type;
  if (returned !== undefined && ts.isTypePredicateNode(returned)) {
    return returned.type !== undefined && mentionsBrand(returned.type, brand, ctx)
      ? "check"
      : undefined;
  }
  // A function that only takes the brand (`normalize(id: UserId): UserId`) checks nothing new.
  const fromOther = fn.parameters.some(
    (parameter) => parameter.type === undefined || !mentionsBrand(parameter.type, brand, ctx),
  );
  if (!fromOther) return undefined;
  const builds =
    returned !== undefined
      ? mentionsBrand(returned, brand, ctx)
      : fn.body !== undefined && castsToBrand(fn.body, brand, ctx);
  return builds ? "build" : undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true
  );
}

/** The names a file exports its own declarations under: `export { make as userId }`, `export default make`. */
function exportListNames(file: ts.SourceFile): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      names.set(statement.expression.text, "default");
    }
    const clause = ts.isExportDeclaration(statement) ? statement.exportClause : undefined;
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      names.set((element.propertyName ?? element.name).text, element.name.text);
    }
  }
  return names;
}

/** The functions a file declares at its top level, each with the name another file imports it by. */
function exportedFunctions(file: ts.SourceFile): readonly { name: string; fn: FunctionNode }[] {
  const listed = exportListNames(file);
  const exported = (statement: ts.Statement, local: string): string | undefined =>
    hasExportModifier(statement) ? local : listed.get(local);
  const found: { name: string; fn: FunctionNode }[] = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const local = statement.name?.text ?? "default";
      const name = exported(statement, local);
      if (name !== undefined) found.push({ name, fn: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        let value = declaration.initializer;
        while (value !== undefined && ts.isParenthesizedExpression(value)) value = value.expression;
        if (!ts.isIdentifier(declaration.name) || value === undefined) continue;
        if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) continue;
        const name = exported(statement, declaration.name.text);
        if (name !== undefined) found.push({ name, fn: value });
      }
    }
  }
  return found;
}

/** `undefined` or `null` as a value an expression can give: itself, or a branch of a conditional. */
function emptyValue(expression: ts.Expression): Constructor["failure"] {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(node) && node.text === "undefined") return "undefined";
  if (ts.isConditionalExpression(node))
    return emptyValue(node.whenTrue) ?? emptyValue(node.whenFalse);
  return undefined;
}

/**
 * What a failed check gives: the `undefined` or `null` in a declared return type that is a union,
 * or, with no declared type, one the function returns (a `return` or the arrow's own value).
 */
function failureOf(fn: FunctionNode): Constructor["failure"] {
  const returned = fn.type;
  if (returned !== undefined) {
    if (!ts.isUnionTypeNode(returned)) return undefined;
    for (const member of returned.types) {
      if (member.kind === ts.SyntaxKind.UndefinedKeyword) return "undefined";
      if (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword) {
        return "null";
      }
    }
    return undefined;
  }
  if (fn.body === undefined) return undefined;
  if (!ts.isBlock(fn.body)) return emptyValue(fn.body);
  const visit = (node: ts.Node): Constructor["failure"] => {
    if (ts.isFunctionLike(node)) return undefined;
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      return emptyValue(node.expression);
    }
    let found: Constructor["failure"];
    ts.forEachChild(node, (child) => {
      found ??= visit(child);
    });
    return found;
  };
  return visit(fn.body);
}

/** The first function the brand's file exports to build or check it, in source order. */
function constructorOf(brand: BuiltBrand, ctx: FileContext): Constructor | undefined {
  for (const { name, fn } of exportedFunctions(brand.declaration.getSourceFile())) {
    const kind = constructorKind(fn, brand, ctx);
    if (kind !== undefined) return { name, kind, failure: failureOf(fn) };
  }
  return undefined;
}

/**
 * The brand a type reference names, when this file may not build it and the brand has a check to
 * bypass. A brand whose file exports no constructor, and that the config gives no owners, is a
 * label anyone may write: nothing checks it, so a cast skips nothing.
 */
function brandNamed(
  reference: ts.TypeReferenceNode,
  ctx: FileContext<Settings>,
  constructors: Constructors,
): CheckedBrand | undefined {
  const brand = declaredBrand(nameOfReference(reference), ctx, 0);
  if (brand === undefined || brand.file === slashes(ctx.file)) return undefined;
  // Files the config names as owners too: a parsing layer, test factories.
  const owners = ctx.options.owners[brand.name];
  if (owners !== undefined && matchesFile(ctx.file, owners)) return undefined;
  if (!constructors.has(brand.declaration)) {
    constructors.set(brand.declaration, constructorOf(brand, ctx));
  }
  const checkedBy = constructors.get(brand.declaration);
  // A brand stated `Opaque` is checked whether or not its module exports a constructor.
  if (checkedBy === undefined && owners === undefined && !brand.stated) return undefined;
  return { ...brand, checkedBy };
}

const ARRAY_TYPES: ReadonlySet<string> = new Set(["Array", "ReadonlyArray"]);

/** The type of a tuple slot; a rest slot (`...rest: Positive[]`) is the type of its items. */
function tupleItem(element: ts.TypeNode): ts.TypeNode {
  const named = ts.isNamedTupleMember(element);
  const slot = named ? element.type : element;
  const rest = named ? element.dotDotDotToken !== undefined : ts.isRestTypeNode(slot);
  const inner = ts.isRestTypeNode(slot) || ts.isOptionalTypeNode(slot) ? slot.type : slot;
  return rest && ts.isArrayTypeNode(inner) ? inner.elementType : inner;
}

/** The types an array, tuple or object type holds: one level of what an assertion can smuggle in. */
function heldTypes(type: ts.TypeNode): readonly ts.TypeNode[] {
  if (ts.isArrayTypeNode(type)) return [type.elementType];
  if (ts.isTupleTypeNode(type)) return type.elements.map(tupleItem);
  if (ts.isTypeLiteralNode(type)) {
    return type.members.flatMap((member) =>
      ts.isPropertySignature(member) && member.type !== undefined ? [member.type] : [],
    );
  }
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    ARRAY_TYPES.has(type.typeName.text)
  ) {
    return type.typeArguments ?? [];
  }
  return [];
}

/**
 * The first brand in the asserted type that this file may not build. Unions and intersections are
 * read member by member; an array, tuple or object type is entered once (`Positive[]`,
 * `{ qty: Positive }`, `Positive | undefined`), but not what lies inside its members.
 */
function offendingBrand(
  type: ts.TypeNode,
  ctx: FileContext<Settings>,
  constructors: Constructors,
  mayEnter = true,
): CheckedBrand | undefined {
  if (ts.isParenthesizedTypeNode(type) || ts.isTypeOperatorNode(type)) {
    return offendingBrand(type.type, ctx, constructors, mayEnter);
  }
  if (ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      const found = offendingBrand(member, ctx, constructors, mayEnter);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const held = mayEnter ? heldTypes(type) : [];
  if (held.length > 0) {
    for (const member of held) {
      const found = offendingBrand(member, ctx, constructors, false);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!ts.isTypeReferenceNode(type) || ts.isConstTypeReference(type)) return undefined;
  return brandNamed(type, ctx, constructors);
}

/**
 * Whether a type predicate only takes `undefined` or `null` away from a value that already is the
 * type (`(x): x is OrderId => x !== undefined` over `OrderId | undefined`): it builds nothing.
 */
function onlyDropsNullish(predicate: ts.TypePredicateNode, ctx: FileContext): boolean {
  const signature = predicate.parent;
  const named = predicate.parameterName;
  if (!ts.isIdentifier(named) || predicate.type === undefined || !ts.isFunctionLike(signature)) {
    return false;
  }
  const param = signature.parameters.find(
    (one) => ts.isIdentifier(one.name) && one.name.text === named.text,
  );
  if (param === undefined) return false;
  const wanted = predicate.type.getText(ctx.sourceFile).replace(/\s+/g, "");
  const members = ctx.types
    .typeTextOf(param.name)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "undefined" && part !== "null");
  return members.length > 0 && members.every((part) => part.replace(/\s+/g, "") === wanted);
}

/** The name a type predicate's function is known by, when it has one. */
function functionName(predicate: ts.TypePredicateNode, ctx: FileContext): string | undefined {
  const signature = predicate.parent;
  if (
    (ts.isFunctionDeclaration(signature) ||
      ts.isFunctionExpression(signature) ||
      ts.isMethodDeclaration(signature) ||
      ts.isMethodSignature(signature)) &&
    signature.name !== undefined
  ) {
    return signature.name.getText(ctx.sourceFile);
  }
  const holder = signature.parent;
  if (
    ts.isVariableDeclaration(holder) ||
    ts.isPropertyAssignment(holder) ||
    ts.isPropertyDeclaration(holder) ||
    ts.isPropertySignature(holder) ||
    ts.isTypeAliasDeclaration(holder)
  ) {
    return holder.name.getText(ctx.sourceFile);
  }
  return undefined;
}

function predicateHeadline(name: string | undefined, brand: BuiltBrand): string {
  return name === undefined
    ? `an unnamed function says a value is \`${brand.name}\` without its check`
    : `\`${name}\` says a value is \`${brand.name}\` without its check`;
}

/**
 * The quick fix that states an unmarked brand opaque: `number & { readonly __brand: "Positive" }`
 * becomes `Opaque<number, "Positive">`, with `Opaque` imported from the project's guarantees file
 * (written there when it is missing). Only for a brand written as an intersection with its tag;
 * offered when the result compiles.
 */
function opaqueFix(brand: BuiltBrand, ctx: FileContext): Fix[] {
  if (brand.stated) return [];
  const declaration = brand.declaration;
  const type = stripTypeParentheses(declaration.type);
  if (!ts.isIntersectionTypeNode(type)) return [];
  const sourceFile = declaration.getSourceFile();
  const parameters = (declaration.typeParameters ?? []).map((parameter) => parameter.name.text);
  if (parameters.length > 0) return [];
  const base = type.types.filter((member) => !isTagLiteral(member, ctx));
  if (base.length === 0 || base.length === type.types.length) return [];
  const written = `Opaque<${base.map((member) => member.getText(sourceFile)).join(" & ")}, ${JSON.stringify(brand.name)}>`;
  const mark: Edit = {
    file: sourceFile.fileName,
    start: type.getStart(sourceFile),
    end: type.end,
    newText: written,
  };
  const forms = markerForms({
    sourceFile,
    marker: "Opaque",
    text: OPAQUE_TEXT,
    mark,
    types: ctx.types,
  });
  const [first, ...rest] = forms.map((edits) => ({
    title: `State \`${brand.name}\` opaque: \`${written}\``,
    edits: edits.map((edit) => ({
      location: { file: edit.file, start: edit.start, end: edit.end },
      newText: edit.newText,
    })),
    changesType: true as const,
  }));
  return first === undefined ? [] : [{ ...first, alternatives: rest }];
}

/** A `{ readonly __brand: "X" }` or `{ readonly [brand]: "X" }` member: the tag of a brand. */
function isTagLiteral(member: ts.TypeNode, ctx: FileContext): boolean {
  const literal = stripTypeParentheses(member);
  return (
    ts.isTypeLiteralNode(literal) &&
    literal.members.some(
      (property) =>
        ts.isPropertySignature(property) &&
        (isUniqueSymbolKey(property.name, ctx) || isTagName(property.name)),
    )
  );
}

/** The note at the declaration of a brand stated `Opaque`: where the trait is stated. */
function statedNote(brand: BuiltBrand): readonly { node: ts.Node; message: string }[] {
  return brand.stated
    ? [{ node: brand.declaration, message: `\`${brand.name}\` is stated \`Opaque\` here` }]
    : [];
}

/** Wrappers that hand their operand's value through: the operand is the place a value is built. */
function passesThrough(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isConditionalExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    (ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.CommaToken,
      ].includes(node.operatorToken.kind))
  );
}

/**
 * Where a value goes into a place with a declared type: an initializer, a returned value, an
 * argument, the right side of `=`, a property or element of a literal, a JSX attribute.
 */
function isFlowPosition(start: ts.Expression): boolean {
  let node: ts.Node = start;
  // `flag ? raw : undefined`, `(raw)`, `raw ?? fallback`: the value is the branch, not the wrapper.
  while (passesThrough(node.parent)) {
    const wrapper = node.parent;
    if (
      ts.isAsExpression(wrapper) ||
      ts.isTypeAssertionExpression(wrapper) ||
      ts.isSatisfiesExpression(wrapper) ||
      (ts.isConditionalExpression(wrapper) && wrapper.condition === node) ||
      (ts.isBinaryExpression(wrapper) &&
        wrapper.operatorToken.kind === ts.SyntaxKind.CommaToken &&
        wrapper.left === node)
    ) {
      return false;
    }
    node = wrapper;
  }
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyAssignment(parent)) &&
    parent.initializer === node
  ) {
    return true;
  }
  if (ts.isYieldExpression(parent)) return true;
  if (ts.isReturnStatement(parent) || ts.isJsxExpression(parent)) return true;
  if (ts.isArrowFunction(parent)) return parent.body === node;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    return parent.arguments?.some((argument) => argument === node) === true;
  }
  if (ts.isArrayLiteralExpression(parent) || ts.isSpreadElement(parent)) return true;
  return (
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken) &&
    parent.right === node
  );
}

/** Types whose values are no brand at all. */
const NOTHING: ReadonlySet<string> = new Set(["undefined", "null", "never", "void"]);

/** The value as the headline names it: `"abc"`, `input.id`, a long one by its type. */
function valueText(node: ts.Expression, ctx: FileContext): string {
  const type = ctx.types.typeTextOf(node);
  if (type === "any") return "an `any` value";
  const text = node.getText(ctx.sourceFile).replace(/\s+/g, " ");
  // A template literal holds backticks of its own: a code span around it would show two pairs.
  if (text.includes("`")) return "a template literal";
  return text.length <= 30 ? `\`${text}\`` : `a \`${type.length <= 30 ? type : "value"}\``;
}

/** What a value of a container type is given as: a brand inside a type the rule does not enter. */
type HeldBrand = { brand: CheckedBrand; given: string; expected: string };

/**
 * A value whose type holds no brand stated `Opaque`, given where the surrounding code expects a
 * container of one (`string[]` returned as `OrderId[]`, a `Map<string, string>` as
 * `Map<string, OrderId>`): which element is checked cannot be followed. Array and object literals
 * are read element by element, so they are left out; a value that holds the brand already, too.
 */
function heldBrandOf(
  node: ts.Expression,
  ctx: FileContext<Settings>,
  constructors: Constructors,
): HeldBrand | undefined {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (ts.isArrayLiteralExpression(inner) || ts.isObjectLiteralExpression(inner)) return undefined;
  // A function written in place (`(prev) => [...prev, id]`): what it returns is read where it
  // returns it.
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return undefined;
  if (NOTHING.has(ctx.types.typeTextOf(node))) return undefined;
  const expected = ctx.types.heldAliasesOf(node, true);
  if (expected.length === 0) return undefined;
  const own = new Set(ctx.types.heldAliasesOf(node).map((alias) => alias.id));
  const file = slashes(ctx.file);
  for (const alias of expected) {
    if (own.has(alias.id)) continue;
    const found = brandOfSymbol(alias, ctx, 0);
    if (found === undefined || !found.stated || found.file === file) continue;
    const owners = ctx.options.owners[found.name];
    if (owners !== undefined && matchesFile(ctx.file, owners)) continue;
    if (!constructors.has(found.declaration)) {
      constructors.set(found.declaration, constructorOf(found, ctx));
    }
    return {
      brand: { ...found, checkedBy: constructors.get(found.declaration) },
      given: ctx.types.typeTextOf(node),
      expected: ctx.types.contextualTypeTextOf(node) ?? found.name,
    };
  }
  return undefined;
}

/** Whether a flow position is one the rule reads: not a wrapper, and a value given to a typed place. */
function readsValue(node: ts.Expression): boolean {
  return !passesThrough(node) && isFlowPosition(node);
}

/** The message of a place not checked, after "not checked: ". */
function heldReason(held: HeldBrand, node: ts.Expression, ctx: FileContext): string {
  const text = node.getText(ctx.sourceFile).replace(/\s+/g, " ");
  const value = text.includes("`")
    ? "a template literal"
    : text.length <= 30
      ? `\`${text}\``
      : "a value";
  return `${value} (\`${held.given}\`) is given as \`${held.expected}\`, so which element is built by the check of \`${held.brand.name}\` is not known`;
}

/** The hint of a place not checked: what makes it readable. */
function heldHint(held: HeldBrand, ctx: FileContext): string {
  const made = held.brand.checkedBy;
  const owner = importPath(held.brand, ctx);
  return made === undefined
    ? `build each element in \`${owner}\`, its owner, so the elements are values of \`${held.brand.name}\``
    : `${made.kind === "build" ? "build" : "check"} each element with \`${made.name}()\` from \`${owner}\` (for example with \`map\`), so the value holds \`${held.brand.name}\` already`;
}

/**
 * A value that becomes a brand stated `Opaque` outside its module without a cast: `"abc"` given
 * where `OrderId` is expected, an object literal, an `any`. The marker is optional, so TypeScript
 * accepts a plain value there; the brand's module is the only place that may build one.
 */
function checkBuiltValue(
  node: ts.Expression,
  ctx: FileContext<Settings>,
  constructors: Constructors,
): void {
  if (!readsValue(node)) return;
  const held = heldBrandOf(node, ctx, constructors);
  if (held !== undefined) {
    ctx.unknown({
      node,
      message: fitted((cut) => `not checked: ${cut.name(heldReason(held, node, ctx))}`),
      hint: heldHint(held, ctx),
    });
    return;
  }
  const expected = ctx.types.guaranteeValuesOf(node, OPAQUE, true);
  if (expected === undefined || expected === "not-finite") return;
  const own = ctx.types.guaranteeValuesOf(node, OPAQUE);
  if (
    own !== undefined &&
    own !== "not-finite" &&
    own.some((value) => expected.some((wanted) => wanted.label === value.label))
  ) {
    return;
  }
  // `undefined` given where `OrderId | undefined` is expected builds no `OrderId`.
  if (NOTHING.has(ctx.types.typeTextOf(node))) return;
  const alias = ctx.types.contextualAliasOf(node);
  const found = alias === undefined ? undefined : brandOfSymbol(alias, ctx, 0);
  if (found === undefined || !found.stated || found.file === slashes(ctx.file)) return;
  const owners = ctx.options.owners[found.name];
  if (owners !== undefined && matchesFile(ctx.file, owners)) return;
  if (!constructors.has(found.declaration)) {
    constructors.set(found.declaration, constructorOf(found, ctx));
  }
  const brand: CheckedBrand = { ...found, checkedBy: constructors.get(found.declaration) };
  const file = slashes(ctx.file);
  ctx.report({
    node,
    message: fitted(
      (cut) =>
        `\`${cut.name(brand.name)}\` is built from ${valueText(node, ctx)} outside \`${cut.path(relativeTo(file, brand.file))}\``,
    ),
    hint: hint(brand, ctx),
    related: statedNote(brand),
  });
}

/** A place in a file, kept in a summary (JSON). */
type Place = { file: string; start: number; end: number };

/**
 * What the rule keeps of a file for `stateward guarantees`, hover and code lens: the brands it
 * states `Opaque`, and the places in their own module that build one (`id` is the declaration's
 * `<file>#<offset>`).
 */
export type OpaqueSummary = {
  opaque: (Place & { name: string })[];
  builds: (Place & { id: string })[];
  /** Places outside the module that give a value as a container of the brand (not followed). */
  unchecked: (Place & { id: string; reason: string })[];
};

function placeOf(node: ts.Node): Place {
  const sourceFile = node.getSourceFile();
  return { file: slashes(sourceFile.fileName), start: node.getStart(sourceFile), end: node.end };
}

/** `<file>#<offset>` of a brand's declaration: how a build names the brand it builds. */
export function brandId(place: Place): string {
  return `${place.file}#${String(place.start)}`;
}

function opaqueSummary(ctx: FileContext<Settings>): OpaqueSummary | undefined {
  if (!ctx.types.declaresTrait(OPAQUE)) return undefined;
  const summary: OpaqueSummary = { opaque: [], builds: [], unchecked: [] };
  const constructors: Constructors = new Map();
  const file = slashes(ctx.file);
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && statesOpaque(node, ctx)) {
      summary.opaque.push({ name: node.name.text, ...placeOf(node) });
    } else if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const brand = ts.isTypeReferenceNode(node.type)
        ? declaredBrand(nameOfReference(node.type), ctx, 0)
        : undefined;
      if (brand?.stated === true && brand.file === file) {
        summary.builds.push({ ...placeOf(node), id: brandId(placeOf(brand.declaration)) });
      }
    } else if (ts.isExpression(node) && !passesThrough(node) && isFlowPosition(node)) {
      const alias = ctx.types.guaranteesOf(node).includes(OPAQUE)
        ? undefined
        : ctx.types.contextualAliasOf(node);
      const brand = alias === undefined ? undefined : brandOfSymbol(alias, ctx, 0);
      if (
        brand?.stated === true &&
        brand.file === file &&
        !NOTHING.has(ctx.types.typeTextOf(node))
      ) {
        summary.builds.push({ ...placeOf(node), id: brandId(placeOf(brand.declaration)) });
      }
    }
    if (ts.isExpression(node) && readsValue(node)) {
      const held = heldBrandOf(node, ctx, constructors);
      if (held !== undefined) {
        summary.unchecked.push({
          ...placeOf(node),
          id: brandId(placeOf(held.brand.declaration)),
          reason: withFix(heldReason(held, node, ctx), heldHint(held, ctx)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return summary.opaque.length > 0 || summary.builds.length > 0 || summary.unchecked.length > 0
    ? summary
    : undefined;
}

/** Where a node is: its start (after trivia) and end. */
type Range = { start: number; end: number };

function rangeOf(node: ts.Node): Range {
  return { start: node.getStart(node.getSourceFile()), end: node.end };
}

function overlaps(a: Range, b: Range): boolean {
  return (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end);
}

const NOT_CHECKED = "not checked: ";

/** An `unknown` message without its "not checked: ". */
function reasonOf(message: string): string {
  return message.startsWith(NOT_CHECKED) ? message.slice(NOT_CHECKED.length) : message;
}

/** Why a value made of a brand stated `Opaque` that no check here reads is not checked, by how it is made. */
function producedReason(ref: LedgerRef): string {
  const code = `\`${ref.text}\``;
  const brand = `\`${ref.name}\``;
  // What to write instead, the same for every way: the value comes from the brand's own check.
  const fix = `build the value with the check of ${brand}, in its module, and pass that`;
  switch (ref.via) {
    case "generic-call":
      return `${code} makes ${brand} by its type arguments, so what the value holds is not checked: ${fix}`;
    case "indirect-call":
      return `${code} passes arguments past their types to a function that takes ${brand} (\`.call\`, \`.apply\`, \`.bind\`, \`Reflect\`): call the function directly`;
    case "spread":
      return `${code} spreads values into places typed ${brand}, which stateward does not follow: pass each value by name`;
    case "reflect":
      return `${code} writes a value typed ${brand} by reflection or through a \`Proxy\`: assign it directly, with a value built by the check of ${brand}`;
    case "overload":
      return `${code} is returned as ${brand} by an overload's implementation, whose own type does not say it: type the implementation's return ${brand}`;
    case "override":
      return `${code} is given by a class member whose base member (the one it overrides or implements) is typed ${brand}: type the member ${brand} itself`;
    case "function-type":
      return `${code} is a function given where one that returns ${brand} is expected: type its return ${brand}`;
    case "for-of":
      return `${code} writes a place typed ${brand} from a loop: assign it in the loop's body`;
    case "any":
      return `${code} is an \`any\` given as ${brand}: ${fix}`;
    case "cast":
      return `${code} is cast to a type that holds ${brand}: ${fix}`;
    case "value":
    case "literal":
    case "derived":
    case "call":
    case "stopped":
    case undefined:
      return `${code} is given as ${brand} where stateward does not check it: ${fix}`;
    default: {
      const unreachable: never = ref.via;
      return unreachable;
    }
  }
}

/**
 * Marks every flow that makes a value of a brand stated `Opaque` (the reference ledger's
 * `produced` flows), and every name of it: a name in a type, an import or an export is
 * irrelevant; a value made in the brand's own module, or in a file `owners` lists, is decided (it
 * may build one); a value a finding of this rule is about is decided (the error stands against the
 * guarantee); a value a place not checked is about reads that place's reason; anything else (a
 * generic call such as `getJson<Order>(url)`, `.call` or `Reflect.apply`, a spread, a reflective
 * write, an overload's implementation, a function given as one returning the brand, a `for…of`
 * target, a cast to a type parameter) is not checked.
 */
function markProducedFlows(
  ctx: FileContext<Settings>,
  reported: readonly Range[],
  unread: readonly (Range & { reason: string })[],
): void {
  const file = slashes(ctx.file);
  for (const ref of ctx.ledger) {
    if (ref.trait !== OPAQUE) continue;
    ctx.read(ref, producedOutcome(ref, ctx, file, reported, unread));
  }
}

/**
 * The name a type reference of the ledger is the declared type of, when that declaration is
 * ambient (`declare const magic: OrderId`, `declare let …`): its value comes from nowhere the
 * proof reads.
 */
function ambientHolder(ref: LedgerRef, ctx: FileContext): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || node.end < ref.location.start || node.pos > ref.location.end) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.type !== undefined &&
      node.type.getStart(ctx.sourceFile) <= ref.location.start &&
      node.type.end >= ref.location.end &&
      ts.isVariableStatement(node.parent.parent) &&
      node.parent.parent.modifiers?.some((one) => one.kind === ts.SyntaxKind.DeclareKeyword) ===
        true
    ) {
      found = node.name.getText(ctx.sourceFile);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

function producedOutcome(
  ref: LedgerRef,
  ctx: FileContext<Settings>,
  file: string,
  reported: readonly Range[],
  unread: readonly (Range & { reason: string })[],
): ReadOutcome {
  if (ref.form === "type") {
    // `declare const magic: OrderId`: a value of the brand that no code here makes.
    const ambient = ambientHolder(ref, ctx);
    const owner = slashes(ref.declaration.slice(0, ref.declaration.lastIndexOf("#")));
    return ambient === undefined || owner === file
      ? { kind: "irrelevant" }
      : {
          kind: "unchecked",
          reason: `\`${ambient}\` is declared with \`declare\`, so where its \`${ref.name}\` comes from is not checked: build the value with the check of \`${ref.name}\` and pass it in`,
        };
  }
  if (ref.form === "import" || ref.form === "export") return { kind: "irrelevant" };
  if (ref.form !== "produced") {
    return {
      kind: "unchecked",
      reason: `\`${ref.text}\` is a use of \`${ref.name}\` that stateward does not read for \`Opaque\`: build the value with the check of \`${ref.name}\`, in its module, and pass that`,
    };
  }
  const owner = slashes(ref.declaration.slice(0, ref.declaration.lastIndexOf("#")));
  const owners = ctx.options.owners[ref.name];
  if (owner === file || (owners !== undefined && matchesFile(ctx.file, owners))) {
    return { kind: "decided" };
  }
  const at = { start: ref.location.start, end: ref.location.end };
  if (reported.some((one) => overlaps(one, at))) return { kind: "decided" };
  const place = unread.find((one) => overlaps(one, at));
  if (place !== undefined) return { kind: "unchecked", reason: place.reason };
  return { kind: "unchecked", reason: producedReason(ref) };
}

export const brandBuiltOutsideOwner = defineRule({
  kind: "file",
  meta: {
    description:
      "A cast to a checked brand like `Positive` outside its check skips the validation the brand stands for, so the type promises more than the value holds.",
    summary: "a cast to a checked brand like `as Positive` outside the file that owns its check",
    defaultSeverity: "error",
    tier: "core",
    group: "owners",
    proves: { flows: { produced: [OPAQUE] } },
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(given) {
    // What the checks below report, kept to mark the flows they read (`markProducedFlows`).
    const reported: Range[] = [];
    const unread: (Range & { reason: string })[] = [];
    const ctx: FileContext<Settings> = {
      ...given,
      report(problem) {
        reported.push(rangeOf(problem.node));
        given.report(problem);
      },
      unknown(unknown) {
        unread.push({
          ...rangeOf(unknown.node),
          reason: withFix(reasonOf(unknown.message), unknown.hint),
        });
        given.unknown(unknown);
      },
    };
    const constructors: Constructors = new Map();
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        // `map.get(key) as Positive` from `Positive | undefined` builds nothing: it only drops undefined.
        const found = offendingBrand(node.type, ctx, constructors);
        // A brand stated `Opaque` accepts any plain value, so only a value that already is one
        // passes; an unmarked brand rejects plain values, so being assignable says the same.
        const already =
          found === undefined
            ? true
            : found.stated
              ? ctx.types.guaranteesOf(node.expression).includes(OPAQUE)
              : ctx.types.isAssignableWithoutNullish(node.expression, node.type);
        const brand = already ? undefined : found;
        if (brand !== undefined) {
          ctx.report({
            node,
            message: headline(brand),
            hint: hint(brand, ctx),
            related: statedNote(brand),
            fixes: opaqueFix(brand, ctx),
          });
        }
      } else if (
        ctx.options.predicates &&
        ts.isTypePredicateNode(node) &&
        node.type !== undefined
      ) {
        // `x is Positive` tells every caller a value was checked, whatever the body did.
        const brand = offendingBrand(node.type, ctx, constructors);
        if (brand !== undefined && !(brand.stated && onlyDropsNullish(node, ctx))) {
          ctx.report({
            node,
            message: predicateHeadline(functionName(node, ctx), brand),
            hint: hint(brand, ctx),
            related: statedNote(brand),
          });
        }
      } else if (opaque && ts.isExpression(node)) {
        checkBuiltValue(node, ctx, constructors);
      }
      ts.forEachChild(node, visit);
    };
    // Every value flowing into a typed place is asked about only when some file states `Opaque`.
    const opaque = ctx.types.declaresTrait(OPAQUE);
    visit(ctx.sourceFile);
    markProducedFlows(ctx, reported, unread);
  },
  summarize(ctx): Json | undefined {
    return opaqueSummary(ctx);
  },
});
