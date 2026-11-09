import {
  CodeActionKind,
  DiagnosticSeverity,
  SemanticTokensBuilder,
  type CodeAction,
  type Diagnostic,
  type Position,
  type Range,
  type SemanticTokens,
  type TextEdit as LspTextEdit,
} from "vscode-languageserver";
import { ignoreFix, laidOutHint } from "@stateward/core/internal";
import type {
  Finding,
  FixForm,
  HiddenFindings,
  Location,
  Severity,
  TextEdit,
  TokenType,
} from "@stateward/core/internal";

/** Where each line of a text starts, so offsets and positions convert without rescanning. */
export type LineIndex = { readonly starts: readonly number[]; readonly length: number };

export function buildLineIndex(text: string): LineIndex {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return { starts, length: text.length };
}

/** The 0-based line and UTF-16 character of `offset`, clamped to the text. */
export function positionAt(index: LineIndex, offset: number): Position {
  const clamped = Math.min(Math.max(offset, 0), index.length);
  let low = 0;
  let high = index.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((index.starts[middle] ?? 0) <= clamped) low = middle;
    else high = middle - 1;
  }
  return { line: low, character: clamped - (index.starts[low] ?? 0) };
}

/** The offset of `position`, clamped to the end of its line (and to the text). */
export function offsetAt(index: LineIndex, position: Position): number {
  const start = index.starts[position.line];
  if (start === undefined) return index.length;
  const next = index.starts[position.line + 1] ?? index.length + 1;
  return Math.min(start + position.character, next - 1, index.length);
}

export function toRange(index: LineIndex, location: Location): Range {
  return { start: positionAt(index, location.start), end: positionAt(index, location.end) };
}

export function toDiagnosticSeverity(severity: Severity): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default: {
      const unreachable: never = severity;
      return unreachable;
    }
  }
}

export type FileMapper = {
  uriOf: (file: string) => string;
  indexOf: (file: string) => LineIndex;
  /** The text of a file as the editor has it. */
  textOf: (file: string) => string;
};

/** The same words as the terminal: the headline, then the fix. */
function diagnosticMessage(finding: Finding, baselined: boolean): string {
  return `${baselined ? "baselined: " : ""}${finding.message}\nFix: ${laidOutHint(finding.hint, "")}`;
}

/**
 * A finding the baseline accepts is a Hint (shown faintly, not in the Problems count) whatever
 * its severity, and its message starts with `baselined: `.
 */
export function toDiagnostic(finding: Finding, files: FileMapper, baselined = false): Diagnostic {
  const range = toRange(files.indexOf(finding.location.file), finding.location);
  switch (finding.kind) {
    case "problem":
      return {
        range,
        severity: baselined ? DiagnosticSeverity.Hint : toDiagnosticSeverity(finding.severity),
        code: finding.ruleId,
        source: "stateward",
        message: diagnosticMessage(finding, baselined),
        ...(finding.related.length === 0
          ? {}
          : {
              relatedInformation: finding.related.map((related) => ({
                location: {
                  uri: files.uriOf(related.location.file),
                  range: toRange(files.indexOf(related.location.file), related.location),
                },
                message: related.message,
              })),
            }),
      };
    case "unknown":
      return {
        range,
        // A rule's place not checked is a faint hint (hundreds of info squiggles would
        // bury the problems); as a warning (`unknowns: "warning"`) it is something to act on,
        // and stateward's own (a file it could not read) stays an info.
        severity: baselined
          ? DiagnosticSeverity.Hint
          : finding.shown === "warning"
            ? DiagnosticSeverity.Warning
            : finding.ruleId.startsWith("stateward/")
              ? DiagnosticSeverity.Information
              : DiagnosticSeverity.Hint,
        code: finding.ruleId,
        source: "stateward",
        message: diagnosticMessage(finding, baselined),
      };
    case "failure":
      return {
        range,
        severity: DiagnosticSeverity.Warning,
        code: finding.ruleId,
        source: "stateward",
        message: diagnosticMessage(finding, false),
      };
    default: {
      const unreachable: never = finding;
      return unreachable;
    }
  }
}

/** An information at the start of the file for findings that are counted but not listed. */
export function toHiddenDiagnostic(hidden: HiddenFindings): Diagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: DiagnosticSeverity.Information,
    code: hidden.ruleId,
    source: "stateward",
    message: `${String(hidden.count)} more ${hidden.ruleId} findings in this file are not shown`,
  };
}

/** Core's edits as LSP edits, by document URI. */
export function toLspChanges(
  edits: readonly TextEdit[],
  files: FileMapper,
): Record<string, LspTextEdit[]> {
  const changes: Record<string, LspTextEdit[]> = {};
  for (const edit of edits) {
    const uri = files.uriOf(edit.location.file);
    const range = toRange(files.indexOf(edit.location.file), edit.location);
    (changes[uri] ??= []).push({ range, newText: edit.newText });
  }
  return changes;
}

/** A quickfix that applies `fix`; its edits may touch several files. */
function toCodeAction(fix: FixForm, diagnostic: Diagnostic, files: FileMapper): CodeAction {
  const changes = toLspChanges(fix.edits, files);
  return {
    title: fix.title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: { changes },
  };
}

/**
 * One quickfix per fix of a problem. Give it a finding whose fixes were tried (`reviewFixes`): a
 * fix that was not is offered as it is.
 */
export function toCodeActions(
  finding: Finding,
  diagnostic: Diagnostic,
  files: FileMapper,
): CodeAction[] {
  if (finding.kind !== "problem") return [];
  return finding.fixes.map((fix) => toCodeAction(fix, diagnostic, files));
}

/**
 * "Ignore this case here" (core's `ignoreFix`): offered for any finding that a comment can cover,
 * after the fixes, and never applied by "fix all".
 */
export function toIgnoreAction(
  finding: Finding,
  diagnostic: Diagnostic,
  files: FileMapper,
): CodeAction | undefined {
  const form = ignoreFix(finding, files.textOf(finding.location.file));
  return form === undefined ? undefined : toCodeAction(form, diagnostic, files);
}

function isBefore(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

/** Ranges that overlap or touch. */
export function rangesIntersect(a: Range, b: Range): boolean {
  return !isBefore(a.end, b.start) && !isBefore(b.end, a.start);
}

const TOKEN_INDEX = {
  class: 0,
  function: 1,
  variable: 2,
  type: 3,
  decorator: 4,
  keyword: 5,
} satisfies Record<TokenType, number>;

/** The LSP semantic token legend: the TokenType list, in index order. */
export const TOKEN_TYPES: readonly string[] = Object.entries(TOKEN_INDEX)
  .sort(([, a], [, b]) => a - b)
  .map(([name]) => name);

/**
 * Encodes tokens for LSP. Tokens are sorted by position; a token that spans lines is cut at the
 * end of its first line, because LSP semantic tokens are single-line.
 */
export function encodeTokens(
  tokens: readonly { location: Location; type: TokenType }[],
  index: LineIndex,
): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  const sorted = [...tokens].sort((a, b) => a.location.start - b.location.start);
  for (const { location, type } of sorted) {
    const start = positionAt(index, location.start);
    const lineEnd = (index.starts[start.line + 1] ?? index.length + 1) - 1;
    const length = Math.min(location.end, lineEnd) - location.start;
    if (length > 0) builder.push(start.line, start.character, length, TOKEN_INDEX[type], 0);
  }
  return builder.build();
}
