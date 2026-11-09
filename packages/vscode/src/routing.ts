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

/** The languages the TypeScript server checks, and the JavaScript ones next to them. */
const TYPESCRIPT_LANGUAGES: ReadonlySet<string> = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

/**
 * What the extension knows about the TypeScript side: whether its server is running, and whether
 * the workspace is a TypeScript project (it has a stateward config).
 */
export type TypeScriptSide = { running: boolean; project: boolean };

/**
 * The server a command or the status item speaks to for the active document: a Python document
 * in a folder with a Python server goes to that server; anything else to the TypeScript server.
 * Without a running TypeScript server, a TypeScript project (a TypeScript or JavaScript file is
 * active, or the workspace has a stateward config) gets no server, since a Python server cannot
 * answer for it. Elsewhere the first Python folder (sorted) answers, so explaining a rule still
 * works from the Markdown preview or the palette; undefined when no server can answer.
 */
export function routeFor(
  active: ActiveDocument | undefined,
  pythonFolders: readonly string[],
  typeScript: TypeScriptSide,
): ServerRoute | undefined {
  if (active?.languageId === "python") {
    const folder = pythonFolderOf(active.fsPath, pythonFolders);
    if (folder !== undefined) return { kind: "python", folder };
  }
  if (typeScript.running) return { kind: "typescript" };
  if (typeScript.project) return undefined;
  if (active !== undefined && TYPESCRIPT_LANGUAGES.has(active.languageId)) return undefined;
  const first = [...pythonFolders].sort()[0];
  return first === undefined ? undefined : { kind: "python", folder: first };
}

/**
 * Why no server answers a TypeScript command: the workspace has no stateward config, or the
 * server is not running (`failure`, the reason the log gives; undefined while it starts).
 */
export function noServerMessage(project: boolean, failure: string | undefined): string {
  if (!project) {
    return 'Stateward is not checking this folder: it has no stateward config. Run "Stateward: Set up the project".';
  }
  return failure === undefined
    ? "Stateward's TypeScript server is not running yet. Try again in a moment, or see View › Output › Stateward."
    : `Stateward's TypeScript server is not running: ${failure.replace(/\.$/, "")}. See View › Output › Stateward.`;
}
