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

/** A fix line followed by a code example, each example line indented by 4 spaces. */
export function withExample(line: string, example: readonly string[]): string {
  return [line, ...example.map((text) => `    ${text}`)].join("\n");
}
