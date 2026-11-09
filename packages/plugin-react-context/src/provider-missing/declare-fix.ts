/**
 * The quick fixes of a stated guarantee: state that a context is required
 * (`createContext<User | undefined>(undefined)` → `requiredContext<User>()`, writing the guarantees
 * file the first time), and drop a run-time check the proof replaces.
 */
import path from "node:path";
import ts from "@stateward/core/typescript";
import type { TypeQueries } from "@stateward/core";
import type { DeclareFix, Edit } from "./summary.js";

/** The project's guarantees file, written by the first fix: one file for every marker. */
export const GUARANTEES_FILE = "guarantees.ts";

/** The helper the fix writes and imports. */
export const HELPER = "requiredContext";

/** What the fix writes in the guarantees file when there is none. */
export const GUARANTEES_TEXT = `// Stated guarantees: types that say what the code promises, so stateward proves it instead of
// guessing. Each marker has an optional \`"__guarantee:<name>"\` property that exists only in the type:
// nothing here adds code at run time. See https://github.com/khoing1111/ts-stateward/blob/main/docs/user/guarantees.md
import { createContext, type Context } from "react";

/**
 * A React context that every reader gets from a Provider: stateward proves each component that
 * reads it is rendered under its Provider, and reports any it cannot prove. Readers need no check
 * for a missing Provider.
 */
export type RequiredContext<T> = Context<T> & { readonly "__guarantee:required-context"?: true };

/** Creates a \`RequiredContext\`: it has no default, since no reader can run without a Provider. */
export function ${HELPER}<T>(): RequiredContext<T> {
  // The one cast: the default is never read, because every reader is under a Provider.
  return createContext<T>(undefined as never);
}
`;

/** `User | undefined` → `User`: the type argument without its `undefined` and `null` members. */
function valueType(type: ts.TypeNode): string | undefined {
  const inner = ts.isParenthesizedTypeNode(type) ? type.type : type;
  const members = ts.isUnionTypeNode(inner) ? inner.types : [inner];
  const kept = members.filter(
    (member) =>
      member.kind !== ts.SyntaxKind.UndefinedKeyword &&
      !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword),
  );
  if (kept.length === 0) return undefined;
  return kept.map((member) => member.getText().replace(/\s+/g, " ").trim()).join(" | ");
}

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

/** Inserts `import { requiredContext } from "<specifier>";` after the file's last import. */
function importEdit(sourceFile: ts.SourceFile, specifier: string): Edit {
  const line = `import { ${HELPER} } from ${JSON.stringify(specifier)};`;
  const last = sourceFile.statements.filter(ts.isImportDeclaration).at(-1);
  const file = sourceFile.fileName;
  if (last === undefined) return { file, start: 0, end: 0, newText: `${line}\n` };
  // On the next line, so the edit does not touch the import before it: core then removes that
  // one when the fix leaves it unused (`createContext`).
  const next = sourceFile.text.indexOf("\n", last.getEnd());
  return next === -1
    ? { file, start: last.getEnd(), end: last.getEnd(), newText: `\n${line}` }
    : { file, start: next + 1, end: next + 1, newText: `${line}\n` };
}

/**
 * Whether the guarantees file exists: `true` gives only the forms that import from it, `false`
 * only those that write it, `unknown` both (a summary is cached while the file may come later).
 */
export type HelperFile = "exists" | "missing" | "unknown";

/**
 * The fix that states a guessed context is required, or undefined when the call gives no type
 * argument to keep (`createContext(undefined)`).
 */
export function declareFixOf(
  call: ts.CallExpression,
  types: TypeQueries,
  helper: HelperFile,
): DeclareFix | undefined {
  const typeArgument = call.typeArguments?.[0];
  const type = typeArgument === undefined ? undefined : valueType(typeArgument);
  if (type === undefined) return undefined;
  const sourceFile = call.getSourceFile();
  const file = sourceFile.fileName;
  const helperFile = guaranteesFileFor(file);
  if (helperFile === file) return undefined;
  const text = `${HELPER}<${type}>()`;
  const rewrite: Edit = { file, start: call.getStart(), end: call.getEnd(), newText: text };
  const create: Edit = { file: helperFile, start: 0, end: 0, newText: GUARANTEES_TEXT };
  // As TypeScript's own auto-import writes it, once the file is there; else as this file's
  // relative imports end.
  const known = types.importSpecifierFor({ name: "RequiredContext", file: helperFile }, file);
  const specifiers = [
    ...new Set([
      ...(known === undefined ? [] : [known]),
      ...importEndings(sourceFile).map((ending) => importSpecifier(file, helperFile, ending)),
    ]),
  ];
  const imports = specifiers.map((specifier) => importEdit(sourceFile, specifier));
  return {
    call: text,
    forms: [
      ...(helper === "missing" ? [] : imports.map((added) => [rewrite, added])),
      ...(helper === "exists" ? [] : imports.map((added) => [create, rewrite, added])),
    ],
  };
}

/** Removes a statement with its line, when nothing else is written on that line. */
export function removalOf(statement: ts.Statement): Edit {
  const sourceFile = statement.getSourceFile();
  const text = sourceFile.text;
  let start = statement.getStart();
  let end = statement.getEnd();
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  if (text.slice(lineStart, start).trim() === "") start = lineStart;
  const rest = lineEnd === -1 ? text.slice(end) : text.slice(end, lineEnd);
  if (rest.trim() === "") end = lineEnd === -1 ? text.length : lineEnd + 1;
  return { file: sourceFile.fileName, start, end, newText: "" };
}
