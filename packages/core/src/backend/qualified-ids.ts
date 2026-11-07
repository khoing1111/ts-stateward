import ts from "typescript";

/**
 * Qualified ids: `<file relative to the project>#<path>`, where the
 * path is the chain of declaration names from the file down (`src/cart.ts#useCart.onAdd`). A name
 * that repeats under the same parent gets a counter in file order (`#App.handler$2`); a declaration
 * without a name is `$<SyntaxKind>` (`#default.$ArrowFunction`). An assignment statement
 * `X.y = …` (or `X["y"] = …`), where TypeScript declares `y` on `X` (an expando), is
 * `$expando:y`, with a counter among the same-named ones under its parent (`#$expando:label$2`):
 * never its offset, so a comment above it keeps the id. The module itself is `<file>#`.
 * Syntax only: an edit that does not rename, add or remove a declaration of the same name before
 * this one under the same parent keeps every id, unlike an offset.
 */

/** The text of a declaration's name; undefined for a binding pattern or no name. */
function nameText(name: ts.Node | undefined, sourceFile: ts.SourceFile): string | undefined {
  if (name === undefined) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  // The file is passed: a file parsed for a read (`declarationAtPath`) may have no parents yet.
  if (ts.isComputedPropertyName(name)) return `[${name.expression.getText(sourceFile)}]`;
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`;
  return undefined;
}

function isDefaultExport(node: ts.FunctionDeclaration | ts.ClassDeclaration): boolean {
  return (
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false
  );
}

/** The path segment a node adds, when it is a named declaration. */
function declarationName(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    return nameText(node.name, sourceFile) ?? (isDefaultExport(node) ? "default" : undefined);
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isExportAssignment(node)) return node.isExportEquals === true ? "export=" : "default";
  if (
    ts.isFunctionExpression(node) ||
    ts.isClassExpression(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isExportSpecifier(node) ||
    ts.isNamespaceImport(node) ||
    ts.isNamespaceExport(node) ||
    ts.isImportClause(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isJsxAttribute(node)
  ) {
    return nameText(node.name, sourceFile);
  }
  return undefined;
}

const K = ts.SyntaxKind;

/**
 * The target of a statement `X.y = …`: the access expression TypeScript declares an expando
 * property by, with the name it declares. Undefined for any other statement. No parent pointers.
 */
function expandoOf(
  statement: ts.ExpressionStatement,
  sourceFile: ts.SourceFile,
): { readonly target: ts.Node; readonly name: string } | undefined {
  const { expression } = statement;
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== K.EqualsToken) {
    return undefined;
  }
  const { left } = expression;
  if (ts.isPropertyAccessExpression(left)) {
    const name = nameText(left.name, sourceFile);
    return name === undefined ? undefined : { target: left, name };
  }
  if (ts.isElementAccessExpression(left)) {
    const argument = left.argumentExpression;
    const name =
      ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)
        ? argument.text
        : `[${argument.getText(sourceFile)}]`;
    return { target: left, name };
  }
  return undefined;
}

/** The kinds `declarationName` names: a cheap test before the typed one, as the walk visits every node. */
const NAMED_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  K.FunctionDeclaration,
  K.ClassDeclaration,
  K.Constructor,
  K.ExportAssignment,
  K.FunctionExpression,
  K.ClassExpression,
  K.VariableDeclaration,
  K.Parameter,
  K.BindingElement,
  K.MethodDeclaration,
  K.MethodSignature,
  K.PropertyDeclaration,
  K.PropertySignature,
  K.PropertyAssignment,
  K.ShorthandPropertyAssignment,
  K.GetAccessor,
  K.SetAccessor,
  K.InterfaceDeclaration,
  K.TypeAliasDeclaration,
  K.EnumDeclaration,
  K.EnumMember,
  K.ModuleDeclaration,
  K.TypeParameter,
  K.ImportSpecifier,
  K.ExportSpecifier,
  K.NamespaceImport,
  K.NamespaceExport,
  K.ImportClause,
  K.ImportEqualsDeclaration,
  K.JsxAttribute,
]);

/** The kinds `isAnonymousDeclaration` accepts. */
const ANONYMOUS_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  K.ArrowFunction,
  K.FunctionExpression,
  K.ClassExpression,
  K.FunctionDeclaration,
  K.ClassDeclaration,
  K.ObjectLiteralExpression,
  K.TypeLiteral,
  K.MappedType,
  K.CallSignature,
  K.ConstructSignature,
  K.IndexSignature,
  K.FunctionType,
  K.ConstructorType,
  K.JsxAttributes,
]);

/** Nodes that declare a symbol without a name of their own. */
function isAnonymousDeclaration(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isObjectLiteralExpression(node) ||
    ts.isTypeLiteralNode(node) ||
    ts.isMappedTypeNode(node) ||
    ts.isCallSignatureDeclaration(node) ||
    ts.isConstructSignatureDeclaration(node) ||
    ts.isIndexSignatureDeclaration(node) ||
    ts.isFunctionTypeNode(node) ||
    ts.isConstructorTypeNode(node) ||
    ts.isJsxAttributes(node)
  );
}

/** Paths by node, per parsed file (a parsed file is immutable, so its paths never change). */
const pathsByFile = new WeakMap<ts.SourceFile, ReadonlyMap<ts.Node, string>>();

function computePaths(sourceFile: ts.SourceFile): ReadonlyMap<ts.Node, string> {
  const paths = new Map<ts.Node, string>([[sourceFile, ""]]);
  const counts = new Map<string, number>();
  const record = (node: ts.Node, base: string): string => {
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    const qualified = seen === 0 ? base : `${base}$${String(seen + 1)}`;
    paths.set(node, qualified);
    return qualified;
  };
  const visit = (node: ts.Node, parent: string): void => {
    const name = NAMED_KINDS.has(node.kind) ? declarationName(node, sourceFile) : undefined;
    let inner = parent;
    // Named by its ordinal, not its offset: a comment above it keeps the id (and the file's shape,
    // fingerprints.ts). What it assigns keeps the parent, as before.
    const expando = ts.isExpressionStatement(node) ? expandoOf(node, sourceFile) : undefined;
    if (expando !== undefined) {
      const segment = `$expando:${expando.name}`;
      record(expando.target, parent === "" ? segment : `${parent}.${segment}`);
    }
    if (name !== undefined) {
      inner = record(node, parent === "" ? name : `${parent}.${name}`);
    } else if (ANONYMOUS_KINDS.has(node.kind) && isAnonymousDeclaration(node)) {
      const segment = `$${ts.SyntaxKind[node.kind]}`;
      // Its own id only: what it contains keeps the named parent, so an anonymous callback added
      // above does not move the ids of the declarations below.
      record(node, parent === "" ? segment : `${parent}.${segment}`);
    }
    // Tokens and identifiers declare nothing and hold nothing that does.
    if (node.kind > K.LastToken) {
      ts.forEachChild(node, (child) => {
        visit(child, inner);
      });
    }
  };
  ts.forEachChild(sourceFile, (child) => {
    visit(child, "");
  });
  return paths;
}

function pathsOf(sourceFile: ts.SourceFile): ReadonlyMap<ts.Node, string> {
  let paths = pathsByFile.get(sourceFile);
  if (paths === undefined) {
    paths = computePaths(sourceFile);
    pathsByFile.set(sourceFile, paths);
  }
  return paths;
}

/** Declarations by path, per parsed file: the inverse of `pathsByFile`. */
const nodesByFile = new WeakMap<ts.SourceFile, ReadonlyMap<string, ts.Node>>();

/**
 * The declaration at `path` in `sourceFile` (see above; "" is the file itself), or undefined when
 * the file has none there: it was renamed, moved or removed. Only the paths the walk names: one
 * placed by its offset (`$Kind@12`) is not looked up. Needs no parent pointers.
 */
export function declarationAtPath(sourceFile: ts.SourceFile, path: string): ts.Node | undefined {
  let nodes = nodesByFile.get(sourceFile);
  if (nodes === undefined) {
    const inverse = new Map<string, ts.Node>();
    for (const [node, at] of pathsOf(sourceFile)) inverse.set(at, node);
    nodes = inverse;
    nodesByFile.set(sourceFile, nodes);
  }
  return nodes.get(path);
}

/** The path of `declaration` in its file (see above); "" for the file itself. */
export function declarationPath(declaration: ts.Node): string {
  const sourceFile = declaration.getSourceFile();
  const paths = pathsOf(sourceFile);
  const found = paths.get(declaration);
  if (found !== undefined) return found;
  // A declaration kind the walk does not name: placed under its nearest named ancestor, by its
  // offset from that ancestor (stable while that ancestor's own text above it does not change).
  let ancestor = declaration.parent;
  while (!paths.has(ancestor)) ancestor = ancestor.parent;
  const base = paths.get(ancestor) ?? "";
  const segment = `$${ts.SyntaxKind[declaration.kind]}@${String(declaration.getStart() - ancestor.getStart())}`;
  return base === "" ? segment : `${base}.${segment}`;
}
