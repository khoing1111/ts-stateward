/**
 * Where the project's guarantees file is, and how a file imports from it, for a hint that shows
 * the `import` line. The same convention as the other plugins' (`src/guarantees.ts`, the nearest
 * `src` folder); a plugin reaches no other plugin, so it is found here too.
 */
import path from "node:path";
import ts from "@stateward/core/typescript";

/** The project's guarantees file: one file for every marker. */
const GUARANTEES_FILE = "guarantees.ts";

/** The nearest `src` folder above the file, else the file's own folder. */
function guaranteesFileFor(file: string): string {
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

/** The ending the file's own relative imports use (`.js`, `.ts`, none); `.js` when it has none. */
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
  return relative.length > 0 ? "" : ".js";
}

/** `import type { OpenUnion } from "./guarantees.js";`, with the path from the file to the guarantees file. */
export function openUnionImport(sourceFile: ts.SourceFile): string {
  const file = sourceFile.fileName.replaceAll("\\", "/");
  const relative = path.posix
    .relative(path.posix.dirname(file), guaranteesFileFor(file))
    .replace(/\.ts$/, "");
  const specifier = `${relative.startsWith(".") ? relative : `./${relative}`}${importEnding(sourceFile)}`;
  return `import type { OpenUnion } from ${JSON.stringify(specifier)};`;
}
