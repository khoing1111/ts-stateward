import type ts from "@stateward/core/typescript";

/** The node's text with all whitespace removed: two spellings of one expression compare equal. */
export function compactText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, "");
}

/** The node's text on one line, for showing in a message or inserting in code. */
export function oneLineText(node: ts.Node, sourceFile: ts.SourceFile): string {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

/** `undefined` and `null` first (they are the cases easiest to overlook), the rest as they came. */
export function nullishFirst(labels: readonly string[]): readonly string[] {
  const rank = (label: string): number => (label === "undefined" ? 0 : label === "null" ? 1 : 2);
  return labels
    .map((label, index) => ({ label, index }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.index - b.index)
    .map(({ label }) => label);
}

/**
 * Every item, comma separated; with `lastSeparator` the last of a list is joined by it ("a and
 * b"). Nothing is left out or counted: a list that is too long is the caller's to replace by a
 * count.
 */
export function listItems(items: readonly string[], lastSeparator?: " and "): string {
  const last = items.at(-1);
  if (lastSeparator === undefined || last === undefined || items.length < 2) {
    return items.join(", ");
  }
  return `${items.slice(0, -1).join(", ")}${lastSeparator}${last}`;
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

/** How many cases a headline names when there are more than `maxHidden`. */
export const NAMED_ABOVE_MAX = 3;

/**
 * A headline that starts with the case labels, as `"a", "b" and "c"` before the part `build`
 * writes (M18: the cases first, as the reader scans for them). Every hidden case is listed,
 * `undefined` and `null` first, up to `maxHidden`; above it the first 3 are named and the rest
 * counted (`undefined, null, "a" and 9 more`), so the developer still sees which kind of case it
 * is. When the list is too long, enum members go by their own name (`DATABASE` for
 * `StorageType.DATABASE`); a case is never dropped silently.
 */
export function fittedCases(
  max: number,
  labels: readonly string[],
  maxHidden: number,
  build: (cut: (text: string) => string, listed: string) => string,
): string {
  const ordered = nullishFirst(labels);
  if (labels.length > maxHidden && labels.length > NAMED_ABOVE_MAX) {
    const more = labels.length - NAMED_ABOVE_MAX;
    const first = (items: readonly string[]): string =>
      `${items.slice(0, NAMED_ABOVE_MAX).join(", ")} and ${String(more)} more`;
    return fittedOneOf(max, [
      (cut) => build(cut, first(ordered)),
      (cut) => build(cut, first(ordered.map(memberName))),
    ]);
  }
  const list = (items: readonly string[]): string => listItems(items, " and ");
  return fittedOneOf(max, [
    (cut) => build(cut, list(ordered)),
    (cut) => build(cut, list(ordered.map(memberName))),
  ]);
}
