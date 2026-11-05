import type ts from "@stateward/core/typescript";

/** At most this many names are listed in a message; the rest are counted. */
const MAX_LISTED = 3;

/** The node's text with all whitespace removed: two spellings of one expression compare equal. */
export function compactText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, "");
}

/** The node's text on one line, for showing in a message or inserting in code. */
export function oneLineText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

/**
 * The first three items, then `and N more`. With `lastSeparator` the last of a short list is
 * joined by it ("a and b"); without, items are only separated by commas.
 */
export function listItems(items: readonly string[], lastSeparator?: " and "): string {
  const shown = items.slice(0, MAX_LISTED);
  const hidden = items.length - shown.length;
  if (hidden > 0) return `${shown.join(", ")} and ${String(hidden)} more`;
  const last = shown.at(-1);
  if (lastSeparator === undefined || last === undefined || shown.length < 2) {
    return shown.join(", ");
  }
  return `${shown.slice(0, -1).join(", ")}${lastSeparator}${last}`;
}

/** A headline is at most this long. */
export const HEADLINE_MAX = 100;
/** A fix line is at most this long. */
export const HINT_MAX = 140;

/** An inserted name or type is cut to this many characters (the last one is `…`). */
export const INSERTED_MAX = 30;
/** The text as it is, or its first `max - 1` characters and `…` when it is longer than `max`. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** The text on one line: all whitespace becomes a single space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Builds a message whose inserted subjects (names, code) are shown whole, on one line: a
 * developer's name is never cut. A headline that is longer than the limit because of its names is
 * allowed to be. A type text is cut once with `shorten(type, INSERTED_MAX)`, and listed
 * labels are not cut (use `listItems`).
 */
export function fitted(build: (cut: (text: string) => string) => string): string {
  return build(oneLine);
}

/**
 * The first wording that fits `max` with every name whole; when none fits, the last wording (the
 * shortest) is used, and it is allowed to be longer because of the names (see `fitted`).
 */
export function fittedOneOf(
  max: number,
  wordings: readonly ((cut: (text: string) => string) => string)[],
): string {
  for (const build of wordings.slice(0, -1)) {
    const text = build(oneLine);
    if (text.length <= max) return text;
  }
  const fallback = wordings.at(-1);
  return fallback === undefined ? "" : fitted(fallback);
}

/** `Enum.Member` (or `ns.Enum.Member`) as `Member`; any other label as it is. */
export function memberName(label: string): string {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(label)
    ? label.slice(label.lastIndexOf(".") + 1)
    : label;
}

/**
 * A headline that names a subject and lists case labels, fitted to `max` without cutting the
 * subject to a stub: every label (up to three) first; then enum members by their own name
 * (`DATABASE` for `StorageType.DATABASE`); then only the first label and a count of the rest.
 */
export function fittedCases(
  max: number,
  labels: readonly string[],
  build: (cut: (text: string) => string, listed: string) => string,
): string {
  const [first] = labels;
  const fewer =
    first === undefined || labels.length < 2
      ? listItems(labels.map(memberName))
      : `${memberName(first)} and ${String(labels.length - 1)} more`;
  return fittedOneOf(max, [
    (cut) => build(cut, listItems(labels)),
    (cut) => build(cut, listItems(labels.map(memberName))),
    (cut) => build(cut, fewer),
  ]);
}
