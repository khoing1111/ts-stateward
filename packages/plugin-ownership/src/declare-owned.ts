/**
 * The quick fix that states a shared value owned: `export const settings = {…}` →
 * `export const settings: Owned<{ … }> = {…}`, importing `Owned` from the project's guarantees file
 * and writing it there when it is missing.
 *
 * The guarantees file is the one `react-context`'s fix writes (`src/guarantees.ts`); a plugin
 * reaches no other plugin (SW3), so where it lives and how it is imported are found here the same
 * way as there.
 */
import path from "node:path";
import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";

/** One text edit, kept in a summary (JSON). */
export type Edit = { file: string; start: number; end: number; newText: string };

/** The fix's title and its forms in order: the first that compiles is offered. */
export type DeclareFix = { title: string; forms: Edit[][] };

/** The project's guarantees file: one file for every marker. */
export const GUARANTEES_FILE = "guarantees.ts";

/** The header of the guarantees file, as the first fix that writes it writes it. */
const HEADER = `// Stated guarantees: types that say what the code promises, so stateward proves it instead of
// guessing. Each marker has an optional \`__guarantee\` property that exists only in the type:
// nothing here adds code at run time. See https://github.com/khoing1111/ts-stateward/blob/main/docs/user/guarantees.md
`;

/** The marker, added to the guarantees file when it does not have it yet. */
export const OWNED_TEXT = `/**
 * A module-level value that only the module declaring it changes: stateward proves that every
 * change from another module goes through that module's functions, and reports any it cannot prove.
 */
export type Owned<T> = T & { readonly __guarantee?: "owned" };
`;

/** The guarantees file this fix writes when there is none. */
export const GUARANTEES_TEXT = `${HEADER}\n${OWNED_TEXT}`;

/** The nearest `src` folder above the file, else the file's own folder. */
export function guaranteesFileFor(file: string): string {
  let directory = path.posix.dirname(file);
  for (let current = directory; ; current = path.posix.dirname(current)) {
    if (path.posix.basename(current) === "src") {
      directory = current;
      break;
    }
    if (path.posix.dirname(current) === current) break;
  }
  return path.posix.join(directory, GUARANTEES_FILE);
}

/** The endings the file's own relative imports use (`.js`, none), the likeliest first. */
function importEndings(sourceFile: ts.SourceFile): readonly string[] {
  const relative = sourceFile.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text.startsWith(".")
      ? [statement.moduleSpecifier.text]
      : [],
  );
  if (relative.some((specifier) => specifier.endsWith(".js"))) return [".js"];
  if (relative.some((specifier) => specifier.endsWith(".ts"))) return [".ts"];
  return relative.length > 0 ? [""] : ["", ".js"];
}

function importSpecifier(from: string, helperFile: string, ending: string): string {
  const relative = path.posix.relative(path.posix.dirname(from), helperFile).replace(/\.ts$/, "");
  return `${relative.startsWith(".") ? relative : `./${relative}`}${ending}`;
}

/** Inserts `import type { Owned } from "<specifier>";` on the line after the file's last import. */
function importEdit(sourceFile: ts.SourceFile, specifier: string): Edit {
  const line = `import type { Owned } from ${JSON.stringify(specifier)};`;
  const last = sourceFile.statements.filter(ts.isImportDeclaration).at(-1);
  const file = sourceFile.fileName;
  if (last === undefined) return { file, start: 0, end: 0, newText: `${line}\n\n` };
  const next = sourceFile.text.indexOf("\n", last.getEnd());
  return next === -1
    ? { file, start: last.getEnd(), end: last.getEnd(), newText: `\n${line}` }
    : { file, start: next + 1, end: next + 1, newText: `${line}\n` };
}

/** Whether the file already imports a name `Owned`. */
function importsOwned(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === "Owned")
    );
  });
}

/**
 * The fix that states a module-level variable owned by `owner` (its path, for the title), or
 * undefined when it cannot be written: a pattern, a declaration in the guarantees file itself, a
 * type stateward cannot write (`any`).
 */
export function declareOwnedFix(
  declaration: ts.VariableDeclaration,
  owner: string,
  types: TypeQueries,
): DeclareFix | undefined {
  if (!ts.isIdentifier(declaration.name)) return undefined;
  const sourceFile = declaration.getSourceFile();
  const file = sourceFile.fileName;
  const helperFile = guaranteesFileFor(file);
  if (helperFile === file) return undefined;
  const written = declaration.type?.getText(sourceFile) ?? types.typeTextOf(declaration.name);
  if (written === "any" || written === "unknown") return undefined;
  const mark: Edit =
    declaration.type === undefined
      ? {
          file,
          start: declaration.name.end,
          end: declaration.name.end,
          newText: `: Owned<${written}>`,
        }
      : {
          file,
          start: declaration.type.getStart(sourceFile),
          end: declaration.type.end,
          newText: `Owned<${written}>`,
        };
  const known = types.importSpecifierFor({ name: "Owned", file: helperFile }, file);
  const specifiers = [
    ...new Set([
      ...(known === undefined ? [] : [known]),
      ...importEndings(sourceFile).map((ending) => importSpecifier(file, helperFile, ending)),
    ]),
  ];
  const imports: Edit[][] = importsOwned(sourceFile)
    ? [[]]
    : specifiers.map((specifier) => [importEdit(sourceFile, specifier)]);
  const append: Edit = { file: helperFile, start: 0, end: 0, newText: `${OWNED_TEXT}\n` };
  const create: Edit = { file: helperFile, start: 0, end: 0, newText: GUARANTEES_TEXT };
  const plain = imports.map((added) => [mark, ...added]);
  const appended = imports.map((added) => [append, mark, ...added]);
  const created = imports.map((added) => [create, mark, ...added]);
  // A summary is cached while the guarantees file may come or go: every form is kept, the likely
  // one first, and the first that compiles is offered.
  const forms = types.isOwnFile(helperFile)
    ? [...plain, ...appended, ...created]
    : [...created, ...plain, ...appended];
  return { title: `Declare ${declaration.name.text} owned by ${owner}`, forms };
}
