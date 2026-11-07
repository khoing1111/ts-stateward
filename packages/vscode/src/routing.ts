import path from "node:path";

/** Which language server answers for a document: the TypeScript one, or a folder's Python one. */
export type ServerRoute = { kind: "typescript" } | { kind: "python"; folder: string };

export type ActiveDocument = { fsPath: string; languageId: string };

/** Whether `file` is inside `folder` (both absolute, in the platform's spelling). */
export function isInside(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The Python folder that serves `file`: the deepest one holding it, undefined when none does. */
export function pythonFolderOf(file: string, folders: readonly string[]): string | undefined {
  return folders
    .filter((folder) => isInside(file, folder))
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * The server a command or the status item speaks to for the active document: a Python document
 * in a folder with a Python server goes to that server; anything else to the TypeScript server.
 * Without a TypeScript server, the first Python folder (sorted) answers, so explaining a rule
 * still works from the Markdown preview or the palette; undefined when no server runs.
 */
export function routeFor(
  active: ActiveDocument | undefined,
  pythonFolders: readonly string[],
  hasTypeScript: boolean,
): ServerRoute | undefined {
  if (active?.languageId === "python") {
    const folder = pythonFolderOf(active.fsPath, pythonFolders);
    if (folder !== undefined) return { kind: "python", folder };
  }
  if (hasTypeScript) return { kind: "typescript" };
  const first = [...pythonFolders].sort()[0];
  return first === undefined ? undefined : { kind: "python", folder: first };
}
