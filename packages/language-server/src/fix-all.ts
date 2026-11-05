import type { FixForm } from "@stateward/core/internal";
import type { CodeAction, Range, TextEdit, WorkspaceEdit } from "vscode-languageserver/node";

/**
 * Where one finding is, and the quick fixes it offers (the first is the one "fix all" applies).
 * `extra` are offered after them but never applied by "fix all": "Ignore this case here" is a
 * decision for a person, not a fix.
 */
export type FixSite = {
  range: Range;
  actions: readonly CodeAction[];
  extra?: readonly CodeAction[];
  /** The fix of the first action as core offered it, for verifying the fixes of a file together. */
  form?: FixForm;
};

/**
 * Verifies the fixes "fix all" chose (by site index) as one set (`Checker.verifyFixSet`): which
 * are kept, and the edits of this file that apply them, imports they leave unused removed.
 */
export type VerifyFixSet = (chosen: readonly number[]) => {
  kept: readonly boolean[];
  edits: readonly TextEdit[];
};

type Position = Range["start"];

function compare(a: Position, b: Position): number {
  return a.line - b.line || a.character - b.character;
}

/**
 * Edits clash when their ranges share a character, or both insert at one point; two equal edits
 * (two fixes adding the same import) do not, and are made once.
 */
function clashes(a: TextEdit, b: TextEdit): boolean {
  if (a.newText === b.newText && compare(a.range.start, b.range.start) === 0) {
    if (compare(a.range.end, b.range.end) === 0) return false;
  }
  return clash(a.range, b.range);
}

function clash(a: Range, b: Range): boolean {
  if (compare(a.start, a.end) === 0 && compare(b.start, b.end) === 0) {
    return compare(a.start, b.start) === 0;
  }
  return compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0;
}

function independent(edits: readonly TextEdit[]): boolean {
  return edits.every((edit, i) =>
    edits.slice(i + 1).every((other) => !clash(edit.range, other.range)),
  );
}

/**
 * One edit for the file `uri` that applies the first fix of every site, in file order. A fix goes
 * in whole or not at all: it is left out when it edits another file, or clashes with a fix already
 * taken (the earlier site wins). With `verify`, the fixes taken are then tried together: one
 * that breaks with the others is left out, and imports the set leaves unused are removed. `count` is the number of fixes taken.
 */
export function fixAllEdits(
  sites: readonly FixSite[],
  uri: string,
  verify?: VerifyFixSet,
): { edits: readonly TextEdit[]; count: number } {
  const taken: TextEdit[] = [];
  const chosen: number[] = [];
  for (const [index, site] of sites.entries()) {
    const changes = site.actions[0]?.edit?.changes;
    if (changes === undefined) continue;
    const files = Object.keys(changes);
    const edits = changes[uri];
    if (files.length !== 1 || edits === undefined || edits.length === 0) continue;
    if (!independent(edits)) continue;
    if (edits.some((edit) => taken.some((other) => clashes(edit, other)))) continue;
    taken.push(...edits.filter((edit) => !taken.some((other) => same(edit, other))));
    chosen.push(index);
  }
  if (verify === undefined || chosen.length === 0) {
    return {
      edits: taken.sort((a, b) => compare(a.range.start, b.range.start)),
      count: chosen.length,
    };
  }
  const review = verify(chosen);
  return {
    edits: [...review.edits].sort((a, b) => compare(a.range.start, b.range.start)),
    count: review.kept.filter((kept) => kept).length,
  };
}

function same(a: TextEdit, b: TextEdit): boolean {
  return (
    a.newText === b.newText &&
    compare(a.range.start, b.range.start) === 0 &&
    compare(a.range.end, b.range.end) === 0
  );
}

/** Whether a code action request with these `only` kinds wants an action of `kind` (`source` covers `source.fixAll`). */
export function kindWanted(only: readonly string[] | undefined, kind: string): boolean {
  if (only === undefined || only.length === 0) return true;
  return only.some((wanted) => kind === wanted || kind.startsWith(`${wanted}.`));
}

/**
 * The same edit as `documentChanges`, each document with the version the fixes were computed
 * against (`null`: the file is not open, so there is no version to check). The editor rejects an
 * edit whose version is not the document's current one, so a fix computed before an edit can
 * never be applied to the text after it.
 */
export function versionedEdit(
  changes: Readonly<Record<string, readonly TextEdit[]>>,
  versionOf: (uri: string) => number | null,
): WorkspaceEdit {
  return {
    documentChanges: Object.entries(changes).map(([uri, edits]) => ({
      textDocument: { uri, version: versionOf(uri) },
      edits: [...edits],
    })),
  };
}

/** `action` with its `changes` edit turned into versioned `documentChanges`; unchanged when it has none. */
export function versionedAction(
  action: CodeAction,
  versionOf: (uri: string) => number | null,
): CodeAction {
  const changes = action.edit?.changes;
  if (changes === undefined) return action;
  return { ...action, edit: versionedEdit(changes, versionOf) };
}
