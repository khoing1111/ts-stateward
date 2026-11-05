import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { stronglyConnectedComponents } from "../graph.js";

/**
 * Dependency fingerprints: a file's fingerprint changes whenever anything a rule could learn on
 * that file changes, and only then. A rule reads the file's syntax and asks the type checker about
 * it; the checker's answers for a file depend on:
 *
 * - the file's own text, and whether it is an own file;
 * - what every file it imports, transitively, shows its importers (types flow through imports):
 *   the file's *shape* (`shapeText`), with how each import resolved (adding a file can change
 *   where an import goes);
 * - everything global: TypeScript's lib files, script files (no import or export), files with
 *   `declare global` or `declare module "…"`, and the compiler options;
 * - the package each file belongs to (`TypeQueries.packageOf`): a rule may tell a library by the
 *   name in its package.json, so renaming a package changes what it decides;
 * - for an own file, the packages its package.json depends on (`TypeQueries.dependenciesOf`): a
 *   rule may turn itself off for a tool the project uses.
 *
 * So the fingerprint is a Merkle hash over the import graph: a strongly connected component
 * (import cycle) hashes its members' shapes and import resolutions, then the hashes of the
 * components it imports; a file's fingerprint is its own full text with its component's hash and
 * the global hash. Two equal fingerprints mean the same inputs to the type checker, so a result
 * computed for one is the result for the other. Files that do not reach an edited file, or reach
 * it only through a shape the edit left as it was (a comment, a function body), keep their
 * fingerprint.
 *
 * A rule can also be handed another file's syntax (`TypeQueries.declarationOf`) and read beyond
 * its shape: a function's body, a `const`'s initializer. Each file a rule on a file was handed is
 * recorded with the hash of its text (`ProjectUnit.readsOf`), and a result is reused only while
 * each of those is the same (docs/architecture.md, "Incremental runs").
 */

const textHashes = new WeakMap<ts.SourceFile, string>();

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** The hash of a parsed file's text, computed once per parsed file. */
export function textHash(sourceFile: ts.SourceFile): string {
  let hash = textHashes.get(sourceFile);
  if (hash === undefined) {
    hash = sha1(sourceFile.text);
    textHashes.set(sourceFile, hash);
  }
  return hash;
}

const shapeHashes = new WeakMap<ts.SourceFile, string>();

/**
 * The hash of what a file shows its importers through the type checker (`shapeText`), or of its
 * full text when it has no smaller shape. Computed once per parsed file: it is syntax only.
 */
export function shapeHash(sourceFile: ts.SourceFile): string {
  let hash = shapeHashes.get(sourceFile);
  if (hash === undefined) {
    const shape = shapeText(sourceFile);
    hash = shape === undefined ? textHash(sourceFile) : sha1(`shape\u0000${shape}`);
    shapeHashes.set(sourceFile, hash);
  }
  return hash;
}

const TYPESCRIPT_SOURCE = /\.(?:[cm]?ts|tsx)$/;

type Stripped = "block" | "expression";

/** The names a top-level statement declares when nothing outside the module sees it unless named. */
function localNames(statement: ts.Statement): readonly string[] | undefined {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    return undefined;
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return [statement.name.text];
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  ) {
    return [statement.name.text];
  }
  if (
    ts.isModuleDeclaration(statement) &&
    ts.isIdentifier(statement.name) &&
    (statement.flags & ts.NodeFlags.GlobalAugmentation) === 0
  ) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    const names: string[] = [];
    const bind = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) names.push(name.text);
      else {
        for (const element of name.elements) {
          if (ts.isBindingElement(element)) bind(element.name);
        }
      }
    };
    for (const declaration of statement.declarationList.declarations) bind(declaration.name);
    return names;
  }
  return undefined;
}

/** `X.y = …` at the top of a module: TypeScript declares `y` on `X` there (an expando). */
function isExpandoAssignment(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) return false;
  const { expression } = statement;
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    (ts.isPropertyAccessExpression(expression.left) ||
      ts.isElementAccessExpression(expression.left))
  );
}

/** The text of each parsed JSDoc comment on `node` (parsed only in the modes that read it). */
function jsDocTexts(node: ts.Node, text: string, into: string[]): void {
  const docs: unknown = Reflect.get(node, "jsDoc");
  if (!Array.isArray(docs)) return;
  const items: readonly unknown[] = docs;
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const pos: unknown = Reflect.get(item, "pos");
    const end: unknown = Reflect.get(item, "end");
    if (typeof pos === "number" && typeof end === "number") into.push(text.slice(pos, end));
  }
}

/**
 * What an own TypeScript module shows the files that import it, as canonical text; undefined for
 * any other file (a declaration file, JavaScript, a script, a library file): its full text is its
 * shape. Syntax only.
 *
 * The module's statements as their tokens, without comments or layout, except:
 *
 * - a body the type checker never reads for the function's type: a function, method or getter
 *   with a declared return type, a setter, a constructor, a static block;
 * - the initializer of a variable, property or parameter with a declared type (only that the
 *   initializer is there is kept: it makes a parameter optional);
 * - a declaration the module does not export and that nothing kept names (it is only used inside
 *   a body left out): nothing outside the module can reach it through types.
 *
 * Kept as well: every parsed JSDoc comment on what is kept (`TypeQueries.calleeTags` reads its
 * tags), the comments at the top of the file that hold a pragma or a directive (`@jsx…`,
 * `/// <reference …/>`), and the offset of each top-level `X.y = …` (the qualified id of `y`
 * counts from the top of the file: qualified-ids.ts).
 *
 * A function without a declared return type keeps its body: its type is inferred from it.
 */
export function shapeText(sourceFile: ts.SourceFile): string | undefined {
  if (
    sourceFile.isDeclarationFile ||
    !TYPESCRIPT_SOURCE.test(sourceFile.fileName) ||
    !ts.isExternalModule(sourceFile)
  ) {
    return undefined;
  }
  const { text } = sourceFile;
  const stripped = new Map<ts.Node, Stripped>();
  const notes: string[] = [];
  /** The tokens of the statement being visited, each followed by a space. */
  let tokens = "";
  /** The declarations the module does not export, by name, while nothing kept names them. */
  const unnamed = new Map<string, number[]>();
  /** Those of them a kept part named: to keep in turn. */
  const named: number[] = [];
  const scanner = ts.createScanner(sourceFile.languageVersion, true, sourceFile.languageVariant);
  /**
   * The tokens between a node's children (punctuation, keywords and operators that are no node of
   * their own), without the comments and layout around them. Every literal, template part, JSX
   * text and regular expression is a node, so a stretch between children scans as code.
   */
  const gap = (start: number, end: number): void => {
    if (end <= start) return;
    scanner.setText(text, start, end - start);
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      tokens += `${scanner.getTokenText()} `;
    }
  };
  const strip = (node: ts.Node | undefined, kind: Stripped): void => {
    if (node !== undefined) stripped.set(node, kind);
  };
  const bodyKind = (body: ts.Node): Stripped => (ts.isBlock(body) ? "block" : "expression");
  const visit = (node: ts.Node): void => {
    const kind = stripped.get(node);
    if (kind !== undefined) {
      tokens += kind === "block" ? "{} " : "__stripped ";
      return;
    }
    if (ts.isIdentifier(node)) {
      const declarations = unnamed.get(node.text);
      if (declarations !== undefined) {
        named.push(...declarations);
        unnamed.delete(node.text);
      }
    }
    if (node.kind <= ts.SyntaxKind.LastToken) {
      // A token, a literal, an identifier: its own text (JSX text keeps its spaces).
      tokens += `${text.slice(node.getStart(sourceFile), node.end)} `;
      return;
    }
    jsDocTexts(node, text, notes);
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.type !== undefined &&
      node.body !== undefined
    ) {
      strip(node.body, bodyKind(node.body));
    } else if (ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node)) {
      strip(node.body, "block");
    } else if (ts.isClassStaticBlockDeclaration(node)) {
      strip(node.body, "block");
    } else if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node)) &&
      node.type !== undefined
    ) {
      strip(node.initializer, "expression");
    }
    let at = node.pos;
    ts.forEachChild(node, (child) => {
      gap(at, child.pos);
      visit(child);
      at = child.end;
    });
    gap(at, node.end);
  };

  const { statements } = sourceFile;
  const printed: string[] = statements.map(() => "");
  const kept = new Set<number>();
  const keep = (index: number): void => {
    const statement = statements[index];
    if (statement === undefined || kept.has(index)) return;
    kept.add(index);
    if (isExpandoAssignment(statement)) {
      notes.push(`expando at ${String(statement.getStart(sourceFile))}`);
    }
    tokens = "";
    visit(statement);
    printed[index] = tokens;
  };
  const roots: number[] = [];
  statements.forEach((statement, index) => {
    const names = localNames(statement);
    if (names === undefined) roots.push(index);
    for (const name of names ?? []) {
      const declarations = unnamed.get(name) ?? [];
      declarations.push(index);
      unnamed.set(name, declarations);
    }
  });
  for (const index of roots) keep(index);
  for (let next = named.pop(); next !== undefined; next = named.pop()) keep(next);

  const header = (ts.getLeadingCommentRanges(text, 0) ?? [])
    .map((range) => text.slice(range.pos, range.end))
    .filter((comment) => comment.startsWith("///") || comment.includes("@"));
  return [...header, ...printed.filter((statement) => statement !== ""), ...notes].join("\n");
}

const DRIVE_ROOT = /^[A-Za-z]:\/?$/;
const UNC_ROOT = /^\/\/[^/]+(\/[^/]+)?\/?$/;

/**
 * The folder above a forward-slash folder, or none at a root: `/`, a drive (`C:`, `C:/`) or a UNC
 * share (`//server/share`). `path.posix.dirname("C:")` is `"."`, which would read the working
 * directory's package.json, so a relative result is never returned either.
 */
export function parentFolder(folder: string): string | undefined {
  if (DRIVE_ROOT.test(folder) || UNC_ROOT.test(folder)) return undefined;
  const parent = path.posix.dirname(folder);
  return parent === folder || parent === "." ? undefined : parent;
}

/** The name of the package a file belongs to, as `TypeQueries.packageOf` answers it. */
export type PackageOf = (file: string) => string | undefined;

/**
 * `packageOf` for one program, reading package.json files through the program's compiler host, so
 * a recorded program (`program-record.ts`) records them and a changed one is not replayed. Each
 * folder is read once per program.
 */
export function packageNames(host: ts.CompilerHost): PackageOf {
  const byFolder = new Map<string, string | undefined>();
  const named = (folder: string): string | undefined => {
    if (byFolder.has(folder)) return byFolder.get(folder);
    const manifest = path.posix.join(folder, "package.json");
    const own = host.fileExists(manifest) ? nameIn(host.readFile(manifest)) : undefined;
    const parent = parentFolder(folder);
    const name = own ?? (parent === undefined ? undefined : named(parent));
    byFolder.set(folder, name);
    return name;
  };
  return (file) => named(path.posix.dirname(file.replaceAll("\\", "/")));
}

/**
 * The hash of the nearest package.json above a file, read through the program's compiler host as
 * `packageNames` reads it: a library file's fingerprint carries its package's manifest, so a new
 * version of a package (whose facts a rule may have read) changes the
 * fingerprints of the files that import it, even when its declarations are the same.
 */
export function packageManifests(host: ts.CompilerHost): PackageOf {
  const byFolder = new Map<string, string | undefined>();
  const hashed = (folder: string): string | undefined => {
    if (byFolder.has(folder)) return byFolder.get(folder);
    const manifest = path.posix.join(folder, "package.json");
    const text = host.fileExists(manifest) ? host.readFile(manifest) : undefined;
    const parent = parentFolder(folder);
    const hash =
      text !== undefined ? sha1(text) : parent === undefined ? undefined : hashed(parent);
    byFolder.set(folder, hash);
    return hash;
  };
  return (file) => hashed(path.posix.dirname(file.replaceAll("\\", "/")));
}

/** The `name` of a package.json text: none when it is missing, not JSON or has no string name. */
function nameIn(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const name: unknown = Reflect.get(parsed, "name");
  return typeof name === "string" ? name : undefined;
}

/** Whether a file is an entry of its package, as `TypeQueries.isPackageEntry` answers it. */
export type IsPackageEntry = (file: string) => boolean;

/** The strings in a package.json value (`exports` nests them in objects and arrays). */
function stringLeaves(value: unknown, into: string[]): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    for (const item of items) stringLeaves(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) stringLeaves(item, into);
  }
  return into;
}

const SOURCE_EXTENSION = /\.(?:d\.[cm]?ts|[cm]?[jt]sx?)$/;
const BUILD_FOLDER = /^(?:dist|build|lib|out)\//;

/** `./dist/index.js` and `src/index.ts` both become `index`: the entry without folder or extension. */
function entryKeys(target: string): string[] {
  if (target.includes("*")) return [];
  const bare = target.replace(/^\.\//, "").replace(SOURCE_EXTENSION, "");
  const keys = [bare];
  if (BUILD_FOLDER.test(bare)) keys.push(bare.replace(BUILD_FOLDER, "src/"));
  return keys;
}

/** The entry keys named by a package.json text; none when it is missing or not JSON. */
function entriesIn(text: string | undefined): ReadonlySet<string> {
  const keys = new Set<string>();
  if (text === undefined) return keys;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A package.json that is not JSON names no entry.
    return keys;
  }
  if (typeof parsed !== "object" || parsed === null) return keys;
  for (const field of ["main", "module", "types", "typings", "exports"]) {
    for (const target of stringLeaves(Reflect.get(parsed, field), [])) {
      for (const key of entryKeys(target)) keys.add(key);
    }
  }
  return keys;
}

/**
 * `isPackageEntry` for one program: the nearest package.json (any, named or not) is read through
 * the program's compiler host, like `packageNames`, so a changed manifest is seen by a recorded
 * program.
 */
export function packageEntries(host: ts.CompilerHost): IsPackageEntry {
  const byFolder = new Map<string, { folder: string; keys: ReadonlySet<string> } | null>();
  const manifestOf = (folder: string): { folder: string; keys: ReadonlySet<string> } | null => {
    const known = byFolder.get(folder);
    if (known !== undefined) return known;
    const manifest = path.posix.join(folder, "package.json");
    const parent = parentFolder(folder);
    const found = host.fileExists(manifest)
      ? { folder, keys: entriesIn(host.readFile(manifest)) }
      : parent === undefined
        ? null
        : manifestOf(parent);
    byFolder.set(folder, found);
    return found;
  };
  return (file) => {
    const name = file.replaceAll("\\", "/");
    const manifest = manifestOf(path.posix.dirname(name));
    if (manifest === null || name.includes("/node_modules/")) return false;
    const relative = path.posix.relative(manifest.folder, name).replace(SOURCE_EXTENSION, "");
    return manifest.keys.has(relative);
  };
}

/** The packages a file's project depends on, as `TypeQueries.dependenciesOf` answers it. */
export type DependenciesOf = (file: string) => readonly string[];

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** The package names a package.json text depends on, sorted, each once; none when it is not JSON. */
function dependenciesIn(text: string | undefined): readonly string[] {
  if (text === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A package.json that is not JSON lists no dependency.
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const listed: unknown = Reflect.get(parsed, field);
    if (typeof listed !== "object" || listed === null || Array.isArray(listed)) continue;
    for (const name of Object.keys(listed)) names.add(name);
  }
  return [...names].sort();
}

/**
 * `dependenciesOf` for one program: the nearest package.json above a file (any, named or not) is
 * read through the program's compiler host, like `packageEntries`, so a changed manifest is seen
 * by a recorded program and changes the fingerprints of the files under it.
 */
export function packageDependencies(host: ts.CompilerHost): DependenciesOf {
  const byFolder = new Map<string, readonly string[]>();
  const listed = (folder: string): readonly string[] => {
    const known = byFolder.get(folder);
    if (known !== undefined) return known;
    const manifest = path.posix.join(folder, "package.json");
    const parent = parentFolder(folder);
    const found = host.fileExists(manifest)
      ? dependenciesIn(host.readFile(manifest))
      : parent === undefined
        ? []
        : listed(parent);
    byFolder.set(folder, found);
    return found;
  };
  return (file) => listed(path.posix.dirname(file.replaceAll("\\", "/")));
}

/** A resolution as TypeScript keeps it: the resolved file, if any, under one of two names. */
function resolvedFileName(resolution: unknown): string | undefined {
  if (typeof resolution !== "object" || resolution === null) return undefined;
  for (const key of ["resolvedModule", "resolvedTypeReferenceDirective"]) {
    const resolved: unknown = Reflect.get(resolution, key);
    if (typeof resolved !== "object" || resolved === null) continue;
    const name: unknown = Reflect.get(resolved, "resolvedFileName");
    if (typeof name === "string") return name;
  }
  return undefined;
}

type ResolutionWalk = (
  file: ts.SourceFile,
  visit: (specifier: string, resolved: string | undefined) => void,
) => void;

/**
 * The program's own record of how each import and type reference of a file resolved. TypeScript
 * keeps it on the program (`forEachResolvedModule`) without a public type; it is read through
 * reflection, checked at run time, and undefined when this TypeScript does not have it (the
 * caller then treats every file as depending on every other: slower, never wrong).
 */
function resolutionWalk(program: ts.Program): ResolutionWalk | undefined {
  const modules: unknown = Reflect.get(program, "forEachResolvedModule");
  const types: unknown = Reflect.get(program, "forEachResolvedTypeReferenceDirective");
  if (typeof modules !== "function" || typeof types !== "function") return undefined;
  return (file, visit) => {
    for (const walk of [modules, types]) {
      Reflect.apply(walk, program, [
        (resolution: unknown, name: unknown) => {
          visit(typeof name === "string" ? name : "", resolvedFileName(resolution));
        },
        file,
      ]);
    }
  };
}

/** Whether a file can change the types of files that do not import it. */
function affectsGlobalScope(program: ts.Program, sourceFile: ts.SourceFile): boolean {
  if (program.isSourceFileDefaultLibrary(sourceFile)) return true;
  if (sourceFile.fileName.endsWith(".json")) return false;
  if (!ts.isExternalModule(sourceFile)) return true;
  return sourceFile.statements.some(
    (statement) =>
      ts.isModuleDeclaration(statement) &&
      (ts.isStringLiteral(statement.name) ||
        (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0),
  );
}

/** The fingerprint of each source file of `program`, by file name; see above. */
export function computeFingerprints(
  program: ts.Program,
  own: ReadonlySet<string>,
  packageOf: PackageOf,
  isEntry: IsPackageEntry,
  dependenciesOf: DependenciesOf,
  /** `packageManifests`: a library file's label carries its package.json's hash. */
  manifestOf?: PackageOf,
): ReadonlyMap<string, string> {
  const files = [...program.getSourceFiles()].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  );
  const walk = resolutionWalk(program);
  const edges = new Map<ts.SourceFile, ts.SourceFile[]>();
  /** Each file's label with its full text's hash, and with its shape's. */
  const fullLabels = new Map<ts.SourceFile, string>();
  const shapeLabels = new Map<ts.SourceFile, string>();
  for (const file of files) {
    const imports: string[] = [];
    const targets: ts.SourceFile[] = [];
    const add = (specifier: string, resolved: string | undefined): void => {
      const target = resolved === undefined ? undefined : program.getSourceFile(resolved);
      imports.push(`${specifier}\u0001${target?.fileName ?? resolved ?? "?"}`);
      if (target !== undefined) targets.push(target);
    };
    walk?.(file, add);
    for (const reference of file.referencedFiles) {
      add(
        `/// ${reference.fileName}`,
        path.resolve(path.dirname(file.fileName), reference.fileName).replaceAll("\\", "/"),
      );
    }
    edges.set(file, targets);
    const isOwn = own.has(file.fileName);
    const label = (text: string): string =>
      [
        file.fileName,
        isOwn ? "own" : "lib",
        text,
        `package ${packageOf(file.fileName) ?? ""}`,
        `entry ${String(isEntry(file.fileName))}`,
        isOwn ? "" : `manifest ${manifestOf?.(file.fileName) ?? ""}`,
        isOwn ? `dependencies ${dependenciesOf(file.fileName).join(" ")}` : "",
        ...imports.sort(),
      ].join("\u0000");
    fullLabels.set(file, label(textHash(file)));
    // A library file's shape is its text: it rarely changes, and its comments are its docs.
    shapeLabels.set(file, isOwn ? label(shapeHash(file)) : label(textHash(file)));
  }

  const fingerprints = new Map<string, string>();
  if (walk === undefined) {
    // No import graph: one fingerprint for the whole program.
    const whole = sha1(
      [JSON.stringify(program.getCompilerOptions()), ...files.map((f) => fullLabels.get(f))].join(
        "\n",
      ),
    );
    for (const file of files) fingerprints.set(file.fileName, whole);
    return fingerprints;
  }

  const componentHash = new Map<ts.SourceFile, string>();
  for (const component of stronglyConnectedComponents(files, (file) => edges.get(file) ?? [])) {
    const members = new Set(component);
    const below = new Set<string>();
    for (const member of component) {
      for (const target of edges.get(member) ?? []) {
        if (!members.has(target)) below.add(componentHash.get(target) ?? "");
      }
    }
    const hash = sha1(
      [...component.map((member) => shapeLabels.get(member) ?? ""), "", ...[...below].sort()].join(
        "\n",
      ),
    );
    for (const member of component) componentHash.set(member, hash);
  }

  const global = sha1(
    [
      ts.version,
      JSON.stringify(program.getCompilerOptions()),
      ...files
        .filter((file) => affectsGlobalScope(program, file))
        .map((file) => componentHash.get(file) ?? ""),
    ].join("\n"),
  );
  for (const file of files) {
    // The file's own text in full (its rules read all of it), the shapes of what it imports.
    fingerprints.set(
      file.fileName,
      sha1(`${global}\n${sha1(fullLabels.get(file) ?? "")}\n${componentHash.get(file) ?? ""}`),
    );
  }
  return fingerprints;
}
