/** Longest path shown in a headline; a longer one is cut from the left. */
export const MAX_SHOWN = 30;

/** The most keys a note lists; the rest are counted. */
const MAX_KEYS = 5;

/** On one line, and at most `max` characters: a longer text keeps `max - 1` and ends in `…`. */
export function shorten(text: string, max: number = Number.POSITIVE_INFINITY): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** `keys: "idle", "done"`, or the first five and `and N more`. */
export function keysNote(labels: readonly string[]): string {
  const shown = labels.slice(0, MAX_KEYS);
  const more = labels.length - shown.length;
  return `keys: ${shown.join(", ")}${more > 0 ? ` and ${String(more)} more` : ""}`;
}

/** A headline is at most this long. */
export const MAX_HEADLINE = 100;
/** The first line of a fix is at most this long. */
export const MAX_HINT = 140;

/**
 * A message whose inserted names are shown whole, on one line: a developer's name is never cut. A
 * headline that is longer than the limit because of its names is allowed to be. `build`
 * applies the given `cut` to every name.
 */
export function fitted(build: (cut: (text: string) => string) => string): string {
  return build((inserted) => shorten(inserted));
}

/** The most names a headline lists; the rest are counted. */
const MAX_NAMES = 3;

/** `a`, `b` and `c`, or the first three and `and N more`, each name cut by `cut`. */
export function namesText(names: readonly string[], cut: (text: string) => string): string {
  const quoted = names.map((name) => `\`${cut(name)}\``);
  if (quoted.length <= MAX_NAMES) {
    const last = quoted.at(-1);
    return quoted.length < 2 || last === undefined
      ? quoted.join("")
      : `${quoted.slice(0, -1).join(", ")} and ${last}`;
  }
  return `${quoted.slice(0, MAX_NAMES).join(", ")} and ${String(quoted.length - MAX_NAMES)} more`;
}
