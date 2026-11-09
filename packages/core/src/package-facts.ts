/**
 * The `facts` line for a package function or property: the config's first, then the facts the
 * loaded plugins ship. Core reads the lines and knows no library; each line names a declaration
 * by its path in the package's types (`Observable.subscribe`) or by its own name (`onSnapshot`).
 */
import ts from "typescript";
import type { FileContext, FunctionFacts, PackageFactsConfig } from "./types.js";

/** What a lookup reads: the program's types, both sets of facts, and the file the code is in. */
export type FactContext = Pick<FileContext, "types" | "facts" | "shippedFacts" | "sourceFile">;

/** The facts line a declaration has, the package it is listed under, and which set it is from. */
export type PackageFact = {
  readonly package: string;
  readonly fact: FunctionFacts;
  readonly source: "config" | "shipped";
};

function unwrapped(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function declarationName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    return node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  if (ts.isModuleDeclaration(node)) return ts.isIdentifier(node.name) ? node.name.text : undefined;
  return undefined;
}

/** The declaration's path in its package's types: `["Observable", "subscribe"]`. */
export function pathOf(node: ts.Node): string[] {
  const names: string[] = [];
  for (let at: ts.Node = node; !ts.isSourceFile(at); at = at.parent) {
    const name = declarationName(at);
    if (name !== undefined) names.unshift(name);
  }
  return names;
}

/** The name the call is made through: `onSnapshot` of `onSnapshot(…)`, `subscribe` of `a.subscribe(…)`. */
export function calleeName(call: ts.CallExpression | ts.NewExpression): ts.Identifier | undefined {
  const callee = unwrapped(call.expression);
  if (ts.isIdentifier(callee)) return callee;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name;
  return undefined;
}

/** The module a file imports a name from: `"firebase/firestore"` for `onSnapshot`. */
export function importedFrom(sourceFile: ts.SourceFile, name: string): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined) continue;
    const bindings = clause.namedBindings;
    const named =
      clause.name?.text === name ||
      (bindings !== undefined &&
        (ts.isNamespaceImport(bindings)
          ? bindings.name.text === name
          : bindings.elements.some((element) => element.name.text === name)));
    if (named) return statement.moduleSpecifier.text;
  }
  return undefined;
}

/** The leftmost name of a callee: `db` of `db.users.watch`. */
export function rootName(expression: ts.Expression): string | undefined {
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return rootName(node.expression);
  }
  if (ts.isCallExpression(node)) return rootName(node.expression);
  return undefined;
}

function factOf(
  facts: PackageFactsConfig,
  packages: readonly string[],
  path: readonly string[],
): { package: string; fact: FunctionFacts } | undefined {
  for (const name of packages) {
    const functions = facts[name];
    if (functions === undefined) continue;
    const fact = functions[path.join(".")] ?? functions[path.at(-1) ?? ""];
    if (fact !== undefined) return { package: name, fact };
  }
  return undefined;
}

/**
 * The facts line for `declared`, a declaration in a package's types, reached in the file through
 * `through` (the callee or the object a property is read from, whose import names the package):
 * the config's line when it has one for the declaration, else a shipped one. Undefined for a
 * declaration of the project, or one no line names.
 */
export function packageFactOf(
  declared: { readonly file: string; readonly node: ts.Node },
  through: ts.Expression | undefined,
  ctx: FactContext,
): PackageFact | undefined {
  const { types } = ctx;
  if (types.isOwnFile(declared.file)) return undefined;
  const root = through === undefined ? undefined : rootName(through);
  const specifier = root === undefined ? undefined : importedFrom(ctx.sourceFile, root);
  const owner = types.packageOf(declared.file);
  const packages = [
    ...new Set([specifier, owner].filter((item): item is string => item !== undefined)),
  ];
  const path = pathOf(declared.node);
  const fromConfig = factOf(ctx.facts, packages, path);
  if (fromConfig !== undefined) return { ...fromConfig, source: "config" };
  const shipped = factOf(ctx.shippedFacts, packages, path);
  return shipped === undefined ? undefined : { ...shipped, source: "shipped" };
}

/** How many `const` names are followed back to the promise they hold. */
const MAX_ALIASES = 4;

/**
 * The package function a name of the project stands for: `listen` in `const listen = onSnapshot`,
 * `const listen = db.onSnapshot` or `const { onSnapshot: listen } = firestore`. Only a name or a
 * property read is followed, never a call: `const stop = onSnapshot(…)` holds what the call
 * returned, not the function.
 */
export function packageFunctionOf(
  name: ts.Identifier,
  ctx: FactContext,
): { declared: { file: string; node: ts.Node }; through: ts.Expression | undefined } | undefined {
  const { types } = ctx;
  let current: ts.Expression = name;
  for (let depth = 0; depth <= MAX_ALIASES; depth++) {
    const node = unwrapped(current);
    const id = ts.isIdentifier(node)
      ? node
      : ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)
        ? node.name
        : undefined;
    if (id === undefined) return undefined;
    const symbol = types.symbolAt(id);
    const declared = symbol === undefined ? undefined : types.declarationOf(symbol);
    if (declared === undefined) return undefined;
    if (!types.isOwnFile(declared.file)) {
      return { declared, through: ts.isPropertyAccessExpression(node) ? node.expression : node };
    }
    const local = declared.node;
    if (ts.isBindingElement(local)) {
      const property = types.bindingPropertyOf(local);
      const source = property === undefined ? undefined : types.declarationOf(property);
      return source === undefined || types.isOwnFile(source.file)
        ? undefined
        : { declared: source, through: undefined };
    }
    if (
      !ts.isVariableDeclaration(local) ||
      (ts.getCombinedNodeFlags(local) & ts.NodeFlags.Const) === 0 ||
      local.initializer === undefined
    ) {
      return undefined;
    }
    current = local.initializer;
  }
  return undefined;
}

/**
 * The package declaration an awaited expression comes from: the function of a call, the property
 * read (`api.cacheEntryRemoved`), or, for a name, the property it was destructured from
 * (`{ cacheEntryRemoved }` of a parameter) or the `const` it was given.
 */
function promiseSource(
  expression: ts.Expression,
  ctx: FactContext,
  depth: number,
): { declared: { file: string; node: ts.Node }; through: ts.Expression | undefined } | undefined {
  const { types } = ctx;
  const node = unwrapped(expression);
  const name = ts.isCallExpression(node)
    ? calleeName(node)
    : ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)
      ? ts.isIdentifier(node)
        ? node
        : node.name
      : undefined;
  if (name === undefined || !ts.isIdentifier(name)) return undefined;
  const symbol = types.symbolAt(name);
  const declared = symbol === undefined ? undefined : types.declarationOf(symbol);
  if (declared === undefined) return undefined;
  const through = ts.isCallExpression(node)
    ? node.expression
    : ts.isPropertyAccessExpression(node)
      ? node.expression
      : node;
  if (!ts.isIdentifier(node) || !types.isOwnFile(declared.file)) return { declared, through };
  const local = declared.node;
  if (ts.isBindingElement(local)) {
    const property = types.bindingPropertyOf(local);
    const source = property === undefined ? undefined : types.declarationOf(property);
    return source === undefined ? undefined : { declared: source, through: undefined };
  }
  if (
    ts.isVariableDeclaration(local) &&
    (ts.getCombinedNodeFlags(local) & ts.NodeFlags.Const) !== 0 &&
    local.initializer !== undefined &&
    depth < MAX_ALIASES
  ) {
    return promiseSource(local.initializer, ctx, depth + 1);
  }
  return undefined;
}

/**
 * The facts line that says an awaited promise never rejects (`neverRejects: true`), when one
 * does: an `await` of it is then not a way out of the function. Undefined otherwise.
 */
export function neverRejectsFactOf(
  expression: ts.Expression,
  ctx: FactContext,
): PackageFact | undefined {
  const source = promiseSource(expression, ctx, 0);
  const found =
    source === undefined ? undefined : packageFactOf(source.declared, source.through, ctx);
  return found?.fact.neverRejects === true ? found : undefined;
}
