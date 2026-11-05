import { createHash } from "node:crypto";
import { realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Finding, Fix, FixForm, FixSetReview, TextEdit } from "@stateward/core/internal";

/** A fix that was taken, and where it came from. */
export type AppliedFix = { ruleId: string; file: string; finding: Finding };

export type FixedFile = {
  file: string;
  before: string;
  after: string;
  /** The edits that make `after`, by offsets into `before` without its byte order mark. */
  edits: readonly DiffEdit[];
  /** The hash of the text the fixes were planned on, without a byte order mark (`textHash`). */
  planned: string;
};

const BOM = "\uFEFF";

export function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/** The hash `--fix` compares to tell whether a file is still the text it planned on. */
export function textHash(text: string): string {
  return createHash("sha256").update(withoutBom(text)).digest("hex");
}

export type FixPlan = {
  /** The files that change, sorted by path. */
  files: readonly FixedFile[];
  applied: readonly AppliedFix[];
};

/**
 * Edits clash when their ranges share a character, or both insert at one point; two equal edits
 * (two fixes adding the same import) do not, and are made once.
 */
function clash(a: TextEdit, b: TextEdit): boolean {
  if (sameEdit(a, b)) return false;
  return overlap(a.location, b.location);
}

function sameEdit(a: TextEdit, b: TextEdit): boolean {
  return (
    a.location.start === b.location.start &&
    a.location.end === b.location.end &&
    a.newText === b.newText
  );
}

type Range = { start: number; end: number };

function overlap(a: Range, b: Range): boolean {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  return a.start < b.end && b.start < a.end;
}

function realOrSelf(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

/** Whether `file` is a path inside `root`, after links are followed. */
export function insideProject(root: string, file: string): boolean {
  const relative = path.relative(realOrSelf(root), realOrSelf(file));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

type Candidate = { finding: Extract<Finding, { kind: "problem" }>; fix: Fix };

/** The first fix of each finding that is marked safe, in the order of the findings. */
function safeFixes(findings: readonly Finding[]): Candidate[] {
  const found: Candidate[] = [];
  for (const finding of findings) {
    if (finding.kind !== "problem") continue;
    const fix = finding.fixes.find((candidate) => candidate.safe === true);
    if (fix !== undefined && fix.edits.length > 0) found.push({ finding, fix });
  }
  return found;
}

/** The number of findings that have a safe fix: what `--fix` would try. */
export function countFixable(findings: readonly Finding[]): number {
  return safeFixes(findings).length;
}

/**
 * Chooses the fixes to apply, like the editor's fix-all (language-server/fix-all.ts): every fix
 * marked safe goes in whole or not at all. It is left out when it edits a file outside the project
 * (or outside `only`, the files of `--changed` and `--staged`), cannot be read, or clashes with
 * a fix already taken (the earlier finding wins). With `verify` (`Checker.verifyFixSet`), the
 * fixes taken are then tried together: one that breaks with the others is left out, and every
 * import the set leaves unused is removed. Edits are applied to the text `readText` gives
 * (the CLI passes the text the check read), from the end of the file backwards, so offsets stay
 * right; `writeFixes` writes a file only if it still holds that text.
 */
export function planFixes(
  findings: readonly Finding[],
  input: {
    root: string;
    readText: (file: string) => string | undefined;
    /** The files `--changed` or `--staged` chose (real paths); left out, any file of the project. */
    only?: ReadonlySet<string>;
    /** Verifies the fixes taken as one set (`Checker.verifyFixSet`). */
    verify?: (forms: readonly FixForm[]) => FixSetReview;
  },
): FixPlan {
  const texts = new Map<string, string | undefined>();
  const textOf = (file: string): string | undefined => {
    if (!texts.has(file)) {
      texts.set(file, insideProject(input.root, file) ? input.readText(file) : undefined);
    }
    return texts.get(file);
  };
  const taken = new Map<string, TextEdit[]>();
  let applied: (AppliedFix & { fix: Fix })[] = [];
  const ordered = [...safeFixes(findings)].sort(
    (a, b) =>
      a.finding.location.file.localeCompare(b.finding.location.file) ||
      a.finding.location.start - b.finding.location.start ||
      a.finding.ruleId.localeCompare(b.finding.ruleId),
  );
  for (const { finding, fix } of ordered) {
    const usable = fix.edits.every((edit) => {
      const text = textOf(edit.location.file);
      return (
        text !== undefined &&
        (input.only === undefined || input.only.has(realOrSelf(edit.location.file))) &&
        edit.location.start >= 0 &&
        edit.location.start <= edit.location.end &&
        edit.location.end <= text.length
      );
    });
    if (!usable) continue;
    const clashes = fix.edits.some(
      (edit, i) =>
        (taken.get(edit.location.file) ?? []).some((other) => clash(edit, other)) ||
        fix.edits.slice(i + 1).some((other) => clash(edit, other)),
    );
    if (clashes) continue;
    for (const edit of fix.edits) {
      const list = taken.get(edit.location.file) ?? [];
      list.push(edit);
      taken.set(edit.location.file, list);
    }
    applied.push({ ruleId: finding.ruleId, file: finding.location.file, finding, fix });
  }
  if (input.verify !== undefined && applied.length > 0) {
    const review = input.verify(applied.map((entry) => entry.fix));
    applied = applied.filter((_, i) => review.kept[i] === true);
    taken.clear();
    for (const edit of review.edits) {
      // The import removals are in files the kept fixes edit, which were read above.
      if (textOf(edit.location.file) === undefined) continue;
      taken.set(edit.location.file, [...(taken.get(edit.location.file) ?? []), edit]);
    }
  }
  const files: FixedFile[] = [];
  for (const [file, edits] of [...taken].sort(([a], [b]) => a.localeCompare(b))) {
    const raw = textOf(file) ?? "";
    // The analysis reads a file without its byte order mark, so offsets count from after it.
    const bom = raw.startsWith("﻿") ? "﻿" : "";
    const before = raw.slice(bom.length);
    let after = before;
    const once = edits.filter(
      (edit, i) => !edits.slice(0, i).some((other) => sameEdit(edit, other)),
    );
    for (const edit of [...once].sort(
      (a, b) => b.location.start - a.location.start || b.location.end - a.location.end,
    )) {
      after = after.slice(0, edit.location.start) + edit.newText + after.slice(edit.location.end);
    }
    if (after !== before) {
      files.push({
        file,
        before: raw,
        after: bom + after,
        edits: once.map(({ location, newText }) => ({
          start: location.start,
          end: location.end,
          newText,
        })),
        planned: textHash(before),
      });
    }
  }
  return {
    files,
    applied: applied.map(({ ruleId, file, finding }) => ({ ruleId, file, finding })),
  };
}

/**
 * The files of `plan` whose text now (`readText`) is not the text the fixes were planned on: the
 * developer saved, or a formatter ran, while stateward was checking. Their edits would land on
 * the wrong characters.
 */
export function changedSincePlan(
  plan: FixPlan,
  readText: (file: string) => string | undefined,
): Set<string> {
  const changed = new Set<string>();
  for (const file of plan.files) {
    const now = readText(file.file);
    if (now === undefined || textHash(now) !== file.planned) changed.add(file.file);
  }
  return changed;
}

/**
 * Writes the fixed files of `plan`, each only if its text is still the one planned on (checked
 * right before it is written). Keeps the byte order mark the file has now. Returns the files
 * left alone, sorted.
 */
export function writeFixes(
  plan: FixPlan,
  readText: (file: string) => string | undefined,
  write: (file: string, text: string) => void = writeAtomically,
): string[] {
  const skipped: string[] = [];
  for (const file of plan.files) {
    const now = readText(file.file);
    if (now === undefined || textHash(now) !== file.planned) {
      skipped.push(file.file);
      continue;
    }
    write(file.file, (now.startsWith(BOM) ? BOM : "") + withoutBom(file.after));
  }
  return skipped;
}

/** Writes `text` to `file` through a temporary file in the same folder, so a crash never leaves half a file. */
export function writeAtomically(file: string, text: string): void {
  const target = realOrSelf(file);
  const mode = statSync(target).mode;
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.stateward-${String(process.pid)}.tmp`,
  );
  try {
    writeFileSync(temporary, text, { mode });
    renameSync(temporary, target);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing was written, so there is nothing to remove.
    }
    throw error;
  }
}

const CONTEXT = 3;

/** One edit of a file, by offsets into its text before any edit. */
export type DiffEdit = { start: number; end: number; newText: string };

/** The offset each line of `text` starts at, and one past the end. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  if (starts.at(-1) !== text.length) starts.push(text.length);
  return starts;
}

/** The index of the line that holds `offset` (binary search over `starts`). */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** A run of whole lines the edits change: lines `from` to `to` (exclusive) become `lines`. */
type Change = { from: number; to: number; lines: string[] };

/**
 * A unified diff of one file (`--- a/<name>`, `+++ b/<name>`, hunks with 3 lines of context),
 * built from the edits themselves: only the lines they touch are compared, so a 40,000-line file
 * with an import added costs as much as a 10-line one. Empty when the edits change nothing.
 */
export function unifiedDiff(name: string, before: string, edits: readonly DiffEdit[]): string {
  const starts = lineStarts(before);
  const old = splitLines(before);
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  // Edits on the same or neighbouring lines become one change, applied to those lines' text.
  const groups: { from: number; to: number; edits: DiffEdit[] }[] = [];
  for (const edit of sorted) {
    const from = lineAt(starts, edit.start);
    const to = Math.max(from, lineAt(starts, Math.max(edit.start, edit.end - 1))) + 1;
    const last = groups.at(-1);
    if (last !== undefined && from <= last.to) {
      last.to = Math.max(last.to, to);
      last.edits.push(edit);
    } else {
      groups.push({ from, to, edits: [edit] });
    }
  }
  const changes: Change[] = [];
  for (const group of groups) {
    const textStart = starts[group.from] ?? 0;
    const textEnd = starts[group.to] ?? before.length;
    let text = before.slice(textStart, textEnd);
    for (const edit of [...group.edits].reverse()) {
      text =
        text.slice(0, edit.start - textStart) + edit.newText + text.slice(edit.end - textStart);
    }
    const lines = splitLines(text);
    // Lines the edits leave as they were, at either end, are context, not a change.
    let from = group.from;
    let head = 0;
    while (from < group.to && head < lines.length && old[from] === lines[head]) {
      from++;
      head++;
    }
    let to = group.to;
    let tail = lines.length;
    while (to > from && tail > head && old[to - 1] === lines[tail - 1]) {
      to--;
      tail--;
    }
    if (to > from || tail > head) changes.push({ from, to, lines: lines.slice(head, tail) });
  }
  if (changes.length === 0) return "";
  const out = [`--- a/${name}`, `+++ b/${name}`];
  // How many lines the changes before the current hunk added (or removed, when negative).
  let shift = 0;
  let at = 0;
  while (at < changes.length) {
    const hunk: Change[] = [];
    let next = changes[at];
    while (next !== undefined) {
      const previous = hunk.at(-1);
      if (previous !== undefined && next.from - previous.to > 2 * CONTEXT) break;
      hunk.push(next);
      at++;
      next = changes[at];
    }
    const first = hunk[0];
    const lastChange = hunk.at(-1);
    if (first === undefined || lastChange === undefined) break;
    const from = Math.max(0, first.from - CONTEXT);
    const to = Math.min(old.length, lastChange.to + CONTEXT);
    const body: string[] = [];
    let line = from;
    let added = 0;
    for (const change of hunk) {
      for (; line < change.from; line++) body.push(` ${old[line] ?? ""}`);
      for (; line < change.to; line++) body.push(`-${old[line] ?? ""}`);
      for (const text of change.lines) body.push(`+${text}`);
      added += change.lines.length - (change.to - change.from);
    }
    for (; line < to; line++) body.push(` ${old[line] ?? ""}`);
    const oldCount = to - from;
    const newCount = oldCount + added;
    const newFrom = from + shift;
    out.push(
      `@@ -${String(oldCount === 0 ? from : from + 1)},${String(oldCount)} +${String(newCount === 0 ? newFrom : newFrom + 1)},${String(newCount)} @@`,
      ...body,
    );
    shift += added;
  }
  return `${out.join("\n")}\n`;
}

/** The number of findings per rule and file: what a second check is compared with. */
export function countBy(findings: readonly Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.kind !== "problem") continue;
    const key = `${finding.location.file}\0${finding.ruleId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * How many findings the second check has that the first, minus the fixes applied, does not
 * explain: problems the fixes caused (or moved a baseline fingerprint onto).
 */
export function introducedBy(
  before: readonly Finding[],
  applied: readonly AppliedFix[],
  after: readonly Finding[],
): number {
  const expected = countBy(before);
  for (const { file, ruleId } of applied) {
    const key = `${file}\0${ruleId}`;
    expected.set(key, Math.max(0, (expected.get(key) ?? 0) - 1));
  }
  let extra = 0;
  for (const [key, count] of countBy(after)) extra += Math.max(0, count - (expected.get(key) ?? 0));
  return extra;
}
