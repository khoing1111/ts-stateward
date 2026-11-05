/** A headline is at most this long. */
export const HEADLINE_MAX = 100;
/** The first line of a fix is at most this long. */
export const HINT_MAX = 140;

/** The text on one line: all whitespace becomes a single space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The text as it is, or its first `max - 1` characters and `…` when it is longer than `max`. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Builds a message whose inserted names are shown whole, on one line: a developer's name is never
 * cut. A headline that is longer than the limit because of its names is allowed to be.
 * `build` applies the given `cut` to every name it inserts.
 */
export function fitted(build: (cut: (text: string) => string) => string): string {
  return build(oneLine);
}

/** The names that a list shows, at most this many; the rest are counted. */
const MAX_LISTED = 3;

/**
 * `` `A` ``, `` `A` and `B` ``, `` `A`, `B` and `C` ``, or the first three and `and N more`. Each
 * name is passed through `cut` and put in backticks.
 */
export function codeList(names: readonly string[], cut: (text: string) => string): string {
  const shown = names.slice(0, MAX_LISTED).map((name) => `\`${cut(name)}\``);
  const hidden = names.length - shown.length;
  if (hidden > 0) return `${shown.join(", ")} and ${String(hidden)} more`;
  const last = shown.at(-1);
  if (last === undefined || shown.length === 1) return last ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${last}`;
}

/** A fix line followed by a code example, each example line indented by 4 spaces. */
export function withExample(line: string, example: readonly string[]): string {
  return [line, ...example.map((text) => `    ${text}`)].join("\n");
}
