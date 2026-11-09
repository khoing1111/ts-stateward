/**
 * How a fix line (`Finding.hint`) is laid out (contract M2, M22): the first line is the fix, or
 * `one of` when there are several ways; a line that starts with `- ` is one way; a line that
 * starts with 4 spaces is a code example of the way above it, or of the first line.
 */
export type HintLine = {
  readonly kind: "text" | "bullet" | "example";
  /** The line as the hint has it (an example keeps its 4 spaces). */
  readonly text: string;
  /** Whether the line follows a bullet: an example of that way, indented under it. */
  readonly underBullet: boolean;
};

export function hintLines(hint: string): readonly HintLine[] {
  let inBullet = false;
  return hint.split("\n").map((text): HintLine => {
    if (text.startsWith("- ")) {
      inBullet = true;
      return { kind: "bullet", text, underBullet: false };
    }
    if (text.startsWith("    ")) return { kind: "example", text, underBullet: inBullet };
    inBullet = false;
    return { kind: "text", text, underBullet: false };
  });
}

/**
 * The hint as it is printed under a label (`= fix: `), each line after the first starting with
 * `indent`: bullets 2 further in, their examples 4 further than the bullet's own.
 */
export function laidOutHint(hint: string, indent: string): string {
  return hintLines(hint)
    .map((line, index) => {
      const shift = line.kind === "bullet" ? "  " : line.underBullet ? "    " : "";
      return index === 0 ? line.text : `${indent}${shift}${line.text}`;
    })
    .join("\n");
}

/**
 * The hint without its code examples, for a place that cannot show code (a GitHub annotation): the
 * first line and each way on its own line, without their closing colons.
 */
export function hintWithoutExamples(hint: string): string {
  return hintLines(hint)
    .filter((line, index) => index === 0 || line.kind === "bullet")
    .map((line) => line.text.replace(/:$/, ""))
    .join("\n");
}
