import path from "node:path";

/** The part of a path module the display helpers use (`node:path` or `path.win32`). */
export type PathModule = Pick<typeof path, "relative" | "sep">;

/** `file` with every separator of `sep` written as `/`: one form on every system. */
export function slashed(file: string, sep: string = path.sep): string {
  return sep === "/" ? file : file.split(sep).join("/");
}

/**
 * A path as shown to the user, in a message, a diff, a location or a file written: relative to
 * `from` (when that gives a name) and always with `/`, also on Windows. `pathModule` is for tests.
 */
export function displayPath(from: string, file: string, pathModule: PathModule = path): string {
  return slashed(pathModule.relative(from, file) || file, pathModule.sep);
}
