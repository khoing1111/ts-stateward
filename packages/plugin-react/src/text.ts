/** Longest path shown in a headline; a longer one is cut from the left. */
export const MAX_SHOWN = 40;

/** A headline is at most this long. */
export const MAX_HEADLINE = 100;
/** The first line of a fix is at most this long. */
export const MAX_HINT = 140;

/** On one line, and at most `max` characters: a longer text keeps `max - 1` and ends in `…`. */
export function shorten(text: string, max: number = Number.POSITIVE_INFINITY): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** A path cut from the left, so the file name stays: `…/theme.ts`. */
export function shortenPath(file: string, max: number = MAX_SHOWN): string {
  return file.length > max ? `…${file.slice(file.length - (max - 1))}` : file;
}

/** The ways `fitted` cuts a name or a path that is too long for the line. */
export type Cut = { name: (text: string) => string; path: (text: string) => string };

/**
 * A message whose inserted names are shown whole, on one line: a developer's name is never cut.
 * Paths keep their file name (`…/theme.ts`). A headline that is longer than the limit because of
 * its names is allowed to be.
 */
export function fitted(build: (cut: Cut) => string): string {
  return build({
    name: (inserted) => shorten(inserted),
    path: (inserted) => shortenPath(inserted),
  });
}
