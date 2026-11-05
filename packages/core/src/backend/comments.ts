import ts from "typescript";

/** A comment that holds the marker: where it is and its text, with its `//` or `/*` marks. */
export type MarkedComment = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Before the first statement of the file. */
  readonly beforeCode: boolean;
  /**
   * The statement (or declaration, member, property) that starts at the next code after the
   * comment: where it starts and where it ends. Undefined when no node starts there (the comment
   * sits inside an expression), or the next code is a lone token.
   */
  readonly next: { readonly start: number; readonly end: number } | undefined;
};

/** The offset of the first code after `from`, skipping blanks and comments. */
function codeAfter(text: string, from: number): number {
  let at = from;
  for (;;) {
    while (at < text.length && /\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith("//", at)) {
      const newline = text.indexOf("\n", at);
      if (newline === -1) return text.length;
      at = newline + 1;
    } else if (text.startsWith("/*", at)) {
      const close = text.indexOf("*/", at + 2);
      if (close === -1) return text.length;
      at = close + 2;
    } else return at;
  }
}

/** The body of a compound statement: an ignore above `if (x) {` covers its head, not its body. */
function bodyOf(node: ts.Node): ts.Node | undefined {
  if (ts.isIfStatement(node)) return node.thenStatement;
  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isLabeledStatement(node) ||
    ts.isWithStatement(node)
  ) {
    return ts.isLabeledStatement(node) ? undefined : node.statement;
  }
  if (ts.isTryStatement(node)) return node.tryBlock;
  if (ts.isSwitchStatement(node)) return node.caseBlock;
  return ts.isBlock(node) ? node : undefined;
}

/**
 * The outermost node that starts exactly at `offset`, as the range an ignore above it covers: the
 * whole statement or declaration; for `if`, loops, `try` and `switch` only up to the `{` of the
 * body, so an ignore above `if (x) {` does not hide the findings inside it.
 */
function nodeStartingAt(
  sourceFile: ts.SourceFile,
  offset: number,
): { start: number; end: number } | undefined {
  let node: ts.Node = sourceFile;
  for (;;) {
    let next: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      if (next === undefined && child.getStart(sourceFile) <= offset && offset < child.end) {
        next = child;
      }
    });
    if (next === undefined) return undefined;
    if (next.getStart(sourceFile) === offset) {
      const body = bodyOf(next);
      return {
        start: offset,
        end:
          body === undefined
            ? next.end
            : ts.isBlock(body) || ts.isCaseBlock(body)
              ? body.getStart(sourceFile) + 1
              : body.end,
      };
    }
    node = next;
  }
}

/** The comment that contains `offset`, found through the tokens, so text in a string or JSX is not one. */
function commentAt(sourceFile: ts.SourceFile, offset: number): ts.CommentRange | undefined {
  let node: ts.Node = sourceFile;
  for (;;) {
    const child: ts.Node | undefined = node
      .getChildren(sourceFile)
      .find((candidate) => candidate.pos <= offset && offset < candidate.end);
    if (child === undefined || ts.isJSDoc(child)) return undefined;
    if (offset < child.getStart(sourceFile)) {
      // Comments after the previous token on its own line are trailing ones; the rest are leading.
      const ranges = [
        ...(ts.getTrailingCommentRanges(sourceFile.text, child.pos) ?? []),
        ...(ts.getLeadingCommentRanges(sourceFile.text, child.pos) ?? []),
      ];
      return ranges.find((range) => range.pos <= offset && offset < range.end);
    }
    if (child.getChildCount(sourceFile) === 0) return undefined;
    node = child;
  }
}

/**
 * The comments of a file that contain `marker`, in order. Syntax only (no type checker): a marker
 * inside a string, a template or JSX text is not in a comment and is left out.
 */
export function markedComments(sourceFile: ts.SourceFile, marker: string): MarkedComment[] {
  const { text } = sourceFile;
  const firstStatement = sourceFile.statements[0]?.getStart(sourceFile) ?? text.length;
  const found: MarkedComment[] = [];
  let from = text.indexOf(marker);
  while (from !== -1) {
    const range = commentAt(sourceFile, from);
    if (range !== undefined) {
      const code = codeAfter(text, range.end);
      found.push({
        next: code >= text.length ? undefined : nodeStartingAt(sourceFile, code),
        start: range.pos,
        end: range.end,
        text: text.slice(range.pos, range.end),
        beforeCode: range.end <= firstStatement,
      });
    }
    // Continue after this comment, so two markers in one comment give one result.
    from = text.indexOf(marker, Math.max(from + marker.length, range?.end ?? 0));
  }
  return found;
}
