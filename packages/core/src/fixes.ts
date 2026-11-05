import type { ProjectUnit } from "./backend/typescript6.js";
import { toTypeScriptPath } from "./backend/typescript6.js";
import { sha1 } from "./cache.js";
import type { ResultCache } from "./cache.js";
import type {
  Finding,
  FixForm,
  FixReview,
  FixSetReview,
  FixVerdict,
  RejectedFix,
  TextEdit,
} from "./types.js";

/**
 * Fix review: a fix is built from syntax, so before it is offered its
 * edits are applied to a copy of the code and TypeScript is asked whether the edited lines now
 * have an error. Fixes of one program that do not overlap are tried together, in one extra
 * program; one that breaks there is tried again alone, since another fix may have caused the
 * error. A fix's forms (`Fix.alternatives`) are tried in order and the first that compiles is
 * the one offered. A fix that leaves an import unused removes it too.
 */

type Outcome =
  { kind: "offered"; form: FixForm } | { kind: "unchecked"; form: FixForm } | { kind: "none" };

/** One fix being tried: its forms in order, and the one tried now. */
type Trial = {
  finding: number;
  forms: readonly FixForm[];
  at: number;
  /** Tried alone next: it broke in a batch, where another fix may have caused the error. */
  alone: boolean;
  outcome?: Outcome;
  rejected: RejectedFix[];
};

type Span = { file: string; start: number; end: number; newText: string };

function spanOf(edit: TextEdit): Span {
  const { file, start, end } = edit.location;
  return { file: toTypeScriptPath(file), start, end, newText: edit.newText };
}

/**
 * Edits clash when they are in one file and share a character, or both insert at one point; two
 * equal edits (two fixes adding the same import) do not: the edit is made once.
 */
function clash(a: Span, b: Span): boolean {
  if (a.file !== b.file) return false;
  if (a.start === b.start && a.end === b.end && a.newText === b.newText) return false;
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  return a.start < b.end && b.start < a.end;
}

function clashesWithin(spans: readonly Span[]): boolean {
  return spans.some((span, i) => spans.slice(i + 1).some((other) => clash(span, other)));
}

/**
 * The verdict's key in the cache: the fingerprints of the files the form edits (equal fingerprints
 * mean the same code and everything it imports) and the edits. Undefined when a file has no
 * fingerprint (it is not an own file of the program), so its verdict is not kept.
 */
function verdictKey(unit: ProjectUnit, form: FixForm): string | undefined {
  const files = [...new Set(form.edits.map((edit) => toTypeScriptPath(edit.location.file)))].sort();
  const prints: string[] = [];
  for (const file of files) {
    const print = unit.fingerprint(file);
    if (print === undefined) return undefined;
    prints.push(print);
  }
  const edits = form.edits.map((edit) => {
    const span = spanOf(edit);
    return [span.file, span.start, span.end, edit.newText];
  });
  return sha1(JSON.stringify([prints, edits, form.changesType === true]));
}

/** The form with the edits that remove the imports it leaves unused. */
function withCleanup(form: FixForm, removes: readonly TextEdit[]): FixForm {
  return removes.length === 0
    ? form
    : { ...form, edits: [...form.edits, ...removes], importCleanup: removes };
}

/** The form's own edits, without the import removals core added (`FixForm.importCleanup`). */
function ownEdits(form: FixForm): readonly TextEdit[] {
  const cleanup = form.importCleanup ?? [];
  return form.edits.filter(
    (edit) =>
      !cleanup.some(
        (removal) =>
          removal.location.start === edit.location.start &&
          removal.location.end === edit.location.end &&
          removal.newText === edit.newText,
      ),
  );
}

function settle(trial: Trial, verdict: FixVerdict): void {
  const form = trial.forms[trial.at];
  if (form === undefined) return;
  switch (verdict.kind) {
    case "compiles":
      trial.outcome = { kind: "offered", form: withCleanup(form, verdict.removesImports ?? []) };
      return;
    case "unchecked":
      trial.outcome = { kind: "unchecked", form };
      return;
    case "breaks":
      trial.rejected.push({ title: form.title, reason: verdict.error });
      trial.at += 1;
      trial.alone = false;
      if (trial.at >= trial.forms.length) trial.outcome = { kind: "none" };
      return;
  }
}

/** Tries the fixes of one program until each has a form that compiles, or none is left. */
function tryInUnit(unit: ProjectUnit, trials: readonly Trial[], cache: ResultCache): void {
  const open = (): Trial[] => trials.filter((trial) => trial.outcome === undefined);
  for (;;) {
    for (const trial of open()) {
      const form = trial.forms[trial.at];
      if (form === undefined) continue;
      if (clashesWithin(form.edits.map(spanOf))) {
        settle(trial, { kind: "unchecked", reason: "its edits overlap" });
        continue;
      }
      const key = verdictKey(unit, form);
      const known = key === undefined ? undefined : cache.verdicts.get(key);
      if (known !== undefined) settle(trial, known);
    }
    const left = open();
    if (left.length === 0) return;
    const batch: Trial[] = [];
    const taken: Span[] = [];
    const alone = left.find((trial) => trial.alone);
    for (const trial of alone === undefined ? left : [alone]) {
      const spans = (trial.forms[trial.at]?.edits ?? []).map(spanOf);
      if (spans.some((span) => taken.some((other) => clash(span, other)))) continue;
      batch.push(trial);
      taken.push(...spans);
    }
    const { verdicts } = unit.tryEdits(
      batch.map((trial) => trial.forms[trial.at] ?? { title: "", edits: [] }),
    );
    batch.forEach((trial, i) => {
      const verdict = verdicts[i] ?? { kind: "unchecked", reason: "it was not tried" };
      if (verdict.kind === "breaks" && batch.length > 1) {
        trial.alone = true;
        return;
      }
      const form = trial.forms[trial.at];
      const key = form === undefined ? undefined : verdictKey(unit, form);
      // A verdict that removes imports is not kept: the disk cache holds only compiles or the error.
      const plain = verdict.kind !== "compiles" || verdict.removesImports === undefined;
      if (key !== undefined && verdict.kind !== "unchecked" && plain) {
        cache.verdicts.set(key, verdict);
        cache.changed = true;
      }
      settle(trial, verdict);
    });
  }
}

/**
 * The findings with only the fixes that compile on `units` (the programs the findings came from),
 * in the same order. Verdicts are read from and kept in `cache.verdicts`.
 */
export function reviewFixes(
  findings: readonly Finding[],
  units: readonly ProjectUnit[],
  cache: ResultCache,
): readonly FixReview[] {
  const owners = new Map<string, ProjectUnit>();
  for (const unit of units) {
    for (const file of unit.files) if (!owners.has(file)) owners.set(file, unit);
  }
  const trials: Trial[] = [];
  const byUnit = new Map<ProjectUnit, Trial[]>();
  findings.forEach((finding, index) => {
    if (finding.kind !== "problem") return;
    for (const { alternatives, ...first } of finding.fixes) {
      const trial: Trial = {
        finding: index,
        forms: [first, ...(alternatives ?? [])],
        at: 0,
        alone: false,
        rejected: [],
      };
      trials.push(trial);
      const unit = owners.get(toTypeScriptPath(finding.location.file));
      if (unit === undefined) {
        trial.outcome = { kind: "unchecked", form: first };
        continue;
      }
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), trial]);
    }
  });
  for (const [unit, list] of byUnit) tryInUnit(unit, list, cache);
  return findings.map((finding, index): FixReview => {
    if (finding.kind !== "problem" || finding.fixes.length === 0) {
      return { finding, unchecked: [], rejected: [] };
    }
    const mine = trials.filter((trial) => trial.finding === index);
    const offered: FixForm[] = [];
    const unchecked: FixForm[] = [];
    for (const { outcome } of mine) {
      if (outcome?.kind === "offered") offered.push(outcome.form);
      if (outcome?.kind === "unchecked") unchecked.push(outcome.form);
    }
    const rejected = mine.flatMap((trial) => trial.rejected);
    const [first] = rejected;
    const noFix = offered.length === 0 && unchecked.length === 0 && first !== undefined;
    return {
      finding: {
        ...finding,
        fixes: offered,
        hint: noFix ? `${finding.hint}\nno automatic fix: ${first.reason}` : finding.hint,
      },
      unchecked,
      rejected,
    };
  });
}

/**
 * Verifies fixes as the set that is applied together (`check --fix`, the editor's fix-all), after
 * each was offered on its own (`reviewFixes`). The set is tried in one program per project; a fix
 * that breaks there is left out and the rest tried again, until the set compiles. Every import
 * the kept fixes leave unused is removed once, for the set: two fixes that each replace one use of
 * an import leave it unused only together.
 */
export function verifyFixSet(
  forms: readonly FixForm[],
  units: readonly ProjectUnit[],
): FixSetReview {
  const owners = new Map<string, ProjectUnit>();
  for (const unit of units) {
    for (const file of unit.files) if (!owners.has(file)) owners.set(file, unit);
  }
  const own = forms.map((form): FixForm => ({ ...form, edits: ownEdits(form) }));
  const kept = forms.map(() => false);
  const byUnit = new Map<ProjectUnit, number[]>();
  own.forEach((form, index) => {
    const [first] = form.edits;
    const unit =
      first === undefined ? undefined : owners.get(toTypeScriptPath(first.location.file));
    if (unit === undefined) return;
    // A fix whose edits clash with one taken before it, or with each other, is left out whole.
    const taken = (byUnit.get(unit) ?? []).flatMap((at) => (own[at]?.edits ?? []).map(spanOf));
    const spans = form.edits.map(spanOf);
    if (clashesWithin(spans) || spans.some((span) => taken.some((other) => clash(span, other)))) {
      return;
    }
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), index]);
  });
  const edits: TextEdit[] = [];
  for (const [unit, indices] of byUnit) {
    let left = indices;
    for (;;) {
      const trial = unit.tryEdits(left.map((at) => own[at] ?? { title: "", edits: [] }));
      const kinds = left.map((_, i) => trial.verdicts[i]?.kind ?? "unchecked");
      if (kinds.every((kind) => kind === "compiles")) {
        for (const at of left) kept[at] = true;
        edits.push(...trial.cleanup);
        break;
      }
      // One that could not be tried is never applied. Of those that break, the last is left out
      // first: an error is blamed on every fix whose lines it is on, and an earlier fix wins.
      const tried = left.filter((_, i) => kinds[i] !== "unchecked");
      const lastBroken = kinds.lastIndexOf("breaks");
      left = tried.length < left.length ? tried : left.filter((_, i) => i !== lastBroken);
      if (left.length === 0) break;
    }
  }
  const seen: Span[] = [];
  for (const [at, form] of own.entries()) {
    if (kept[at] !== true) continue;
    for (const edit of form.edits) {
      const span = spanOf(edit);
      // Two fixes that make the same edit share it.
      if (seen.some((other) => sameSpan(span, other))) continue;
      seen.push(span);
      edits.push(edit);
    }
  }
  return { kept, edits: sortEdits(edits) };
}

function sameSpan(a: Span, b: Span): boolean {
  return a.file === b.file && a.start === b.start && a.end === b.end && a.newText === b.newText;
}

/** By file, then from the start of the file. */
function sortEdits(edits: readonly TextEdit[]): TextEdit[] {
  return [...edits].sort(
    (a, b) =>
      (a.location.file < b.location.file ? -1 : a.location.file > b.location.file ? 1 : 0) ||
      a.location.start - b.location.start ||
      a.location.end - b.location.end,
  );
}
