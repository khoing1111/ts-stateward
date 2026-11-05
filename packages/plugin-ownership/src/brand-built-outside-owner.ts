import path from "node:path";
import ts from "@stateward/core/typescript";
import { defineRule, matchesFile, option, type FileContext, type OptionsOf } from "@stateward/core";

const EXPLAIN = `# ownership/brand-built-outside-owner

A branded value that has a check is built only by that check, in the file that declares the brand.

## Why

A branded type like \`type UserId = string & { readonly __brand: "UserId" }\` promises that every value of it passed a check. A cast skips the check: \`input.qty as Positive\` compiles for \`-5\`, and \`charge(qty)\` then bills a negative amount. After one such cast, the brand no longer tells anyone anything.

## When to use it

Use it if you brand checked values: ids, amounts, non-empty names. It is on as an error in every preset. A brand is only worth having if it cannot be faked, so keep it on; if your brands have no checks, it never fires.

## What it catches

A cast to a branded type outside the file that declares it: \`x as Positive\`, \`<Positive>x\`, \`x as unknown as Positive\`, also inside a type (\`Positive | undefined\`, \`Positive[]\`, \`[string, Positive]\`, \`{ qty: Positive }\`) and through a local alias (\`type Qty = Positive\`). Also a type predicate or assertion function (\`(x): x is Positive\`, \`asserts x is Positive\`) outside the owner, since it tells every caller a value was checked.

A brand is recognised by its shape, so no library is needed: a type alias of your project that is an intersection with a tag property, either a string literal on a property whose name starts with \`_\` (\`T & { readonly __brand: "UserId" }\`) or a key that is a \`unique symbol\` (\`T & { readonly [brand]: "UserId" }\`), or that applies a generic helper of that shape (\`type Sku = Brand<string, "Sku">\` with \`type Brand<T, Name> = T & { readonly [brand]: Name }\`). The helper itself is a building block, not a brand. A brand is checked when the file that declares it exports its check: a function that builds the brand from another type (\`positive(value: number): Positive | undefined\`), or a type predicate or assertion function (\`isPositive(value: number): value is Positive\`). That file owns the brand: casts are allowed there, and only there, and the message names the check to call instead.

A brand whose file exports no check (\`type SocketId = string & { _brand: "SocketId" }\`, cast wherever an id arrives) is a label: there is no check to skip, so casting to it is not reported. Declare a constructor next to the brand to make the brand checked, or name the files that may build it under \`owners\`.

### Bad

\`\`\`ts
import type { Positive } from "./values";

const qty = input.qty as Positive;
\`\`\`

### Good

\`\`\`ts
// values.ts: the brand and its check, together
export type Positive = number & { readonly __brand: "Positive" };
export function positive(value: number): Positive | undefined {
  return value > 0 ? (value as Positive) : undefined;
}

// cart.ts
const qty = positive(input.qty);
if (qty === undefined) return;
charge(qty);
\`\`\`

### Fix

Call the brand's check, which the message names, or move the cast into the file that declares the brand. There is no quick fix.

## What it does not catch

- \`x as any\`, or any other \`any\` value: TypeScript lets \`any\` become \`Positive\` without a cast (\`const qty: Positive = JSON.parse(text)\`). Use typescript-eslint's \`no-explicit-any\` and \`no-unsafe-assignment\` for that.
- A cast that only removes \`undefined\` or \`null\` from a value that is already the brand (\`map.get(key) as Positive\`): it is allowed.
- A brand declared in a package, an interface, or written inline in the cast (\`x as string & { __brand: "Id" }\`): there is no owner file to name.
- A brand whose file exports no check, unless \`owners\` names it: declare a constructor to make the brand checked. A function made from nothing (\`newSessionId(): SessionId\`) or one that only takes the brand is not a check.
- Arithmetic on brands: \`a + b\` is a plain \`number\`, not a brand.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "ownership/brand-built-outside-owner": "off" } // or "warning"
rules: { "ownership/brand-built-outside-owner": ["error", { owners: { Sku: ["src/codecs/**"] } }] } // more files may build Sku; Sku is checked even with no constructor
groups: { "values/brands": "off" } // the whole group
\`\`\`
`;

/** A brand that a type assertion builds, and the file that may build it. */
type BuiltBrand = { name: string; file: string; declaration: ts.TypeAliasDeclaration };

/**
 * How other files get a checked brand: an exported function of the declaring file that builds it
 * from another type (`positive(value: number): Positive | undefined`), or a type predicate or
 * assertion function (`isPositive(value: number): value is Positive`).
 */
type Constructor = { name: string; kind: "build" | "check" };

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
  return `\`${brand.name}\` is built here without its check`;
}

function hint(brand: CheckedBrand, file: string): string {
  const owner = relativeTo(file, brand.file);
  const made = brand.checkedBy;
  if (made === undefined) return `build it in \`${owner}\`, its owner`;
  const verb = made.kind === "build" ? "build it with" : "check it with";
  return `${verb} \`${made.name}()\` from \`${owner}\``;
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

/** `__brand`, `_tag`: a property name that says it is not data. */
function isTagName(name: ts.PropertyName): boolean {
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text.startsWith("_");
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
  const found = symbol === undefined ? undefined : ctx.types.declarationOf(symbol);
  if (symbol === undefined || found === undefined || !ctx.types.isOwnFile(found.file)) {
    return undefined;
  }
  const declaration = found.node;
  if (!ts.isTypeAliasDeclaration(declaration)) return undefined;
  const parameters = (declaration.typeParameters ?? []).map((parameter) => parameter.name.text);
  const type = stripTypeParentheses(declaration.type);
  const own = { name: symbol.name, file: slashes(found.file), declaration };
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

/** The first function the brand's file exports to build or check it, in source order. */
function constructorOf(brand: BuiltBrand, ctx: FileContext): Constructor | undefined {
  for (const { name, fn } of exportedFunctions(brand.declaration.getSourceFile())) {
    const kind = constructorKind(fn, brand, ctx);
    if (kind !== undefined) return { name, kind };
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
  if (checkedBy === undefined && owners === undefined) return undefined;
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
    ? `An unnamed function says a value is \`${brand.name}\` without its check`
    : `\`${name}\` says a value is \`${brand.name}\` without its check`;
}

export const brandBuiltOutsideOwner = defineRule({
  kind: "file",
  meta: {
    description:
      "A branded value that has a check is built only by that check, in the file that declares the brand.",
    defaultSeverity: "error",
    tier: "core",
    group: "owners",
    options: OPTIONS,
    explain: EXPLAIN,
  },
  check(ctx) {
    const constructors: Constructors = new Map();
    const visit = (node: ts.Node): void => {
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        // `map.get(key) as Positive` from `Positive | undefined` builds nothing: it only drops undefined.
        const brand = ctx.types.isAssignableWithoutNullish(node.expression, node.type)
          ? undefined
          : offendingBrand(node.type, ctx, constructors);
        if (brand !== undefined) {
          ctx.report({ node, message: headline(brand), hint: hint(brand, slashes(ctx.file)) });
        }
      } else if (
        ctx.options.predicates &&
        ts.isTypePredicateNode(node) &&
        node.type !== undefined
      ) {
        // `x is Positive` tells every caller a value was checked, whatever the body did.
        const brand = offendingBrand(node.type, ctx, constructors);
        if (brand !== undefined) {
          ctx.report({
            node,
            message: predicateHeadline(functionName(node, ctx), brand),
            hint: hint(brand, slashes(ctx.file)),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ctx.sourceFile);
  },
});
