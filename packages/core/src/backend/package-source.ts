import path from "node:path";
import ts from "typescript";

/** The folder of a package by its name, from `from` up through node_modules folders. */
export function findPackageRoot(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (ts.sys.fileExists(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return undefined;
  }
}

const withJsDoc = new WeakMap<ts.SourceFile, ts.SourceFile>();

/**
 * The same file parsed again with all of its JSDoc: a library's declaration files are parsed as
 * tsc parses them (no `@throws`), and a plugin that reads a package's `@throws {X}` (source 3)
 * finds the declaration at the same offsets here. Once per parsed file.
 */
export function reparsedWithJsDoc(sourceFile: ts.SourceFile): ts.SourceFile {
  let parsed = withJsDoc.get(sourceFile);
  if (parsed === undefined) {
    parsed = ts.createSourceFile(
      sourceFile.fileName,
      sourceFile.text,
      {
        languageVersion: sourceFile.languageVersion,
        jsDocParsingMode: ts.JSDocParsingMode.ParseAll,
      },
      true,
    );
    withJsDoc.set(sourceFile, parsed);
  }
  return parsed;
}
