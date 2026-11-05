import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { limitFindings } from "./engine.js";
import type { CheckResult, Config, Finding } from "./types.js";

export const BASELINE_FILE = "stateward.baseline.json";
/**
 * Version 2 fingerprints a finding by its rule, file and code only, so rewording a message never
 * un-baselines it. Version 1 also hashed the headline; its entries are read as legacy entries.
 */
const BASELINE_VERSION = 2;
const LEGACY_VERSION = 1;

/** What `check` says once when the baseline still has entries an older stateward wrote. */
export const OUTDATED_BASELINE =
  "your baseline was written by an older stateward; run `stateward baseline` to refresh it (nothing is lost)";

/**
 * The baseline file cannot be used. The message says which file, why, and what to do;
 * `cause` carries the system error when there is one.
 */
export class BaselineError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "BaselineError";
    Object.setPrototypeOf(this, BaselineError.prototype);
  }
}

/**
 * One accepted finding (or `count` of them): the rule, the file (relative to the config, forward
 * slashes) and its headline for people reading the file. A `fingerprint` entry recognises its
 * findings after the code moves; a `legacy` entry was written by an older stateward, whose
 * fingerprints included the headline, and accepts up to `count` findings of its rule in its file.
 */
export type BaselineEntry =
  | {
      kind: "fingerprint";
      ruleId: string;
      file: string;
      fingerprint: string;
      message: string;
      /** How many findings share this fingerprint in the file; at least 1. */
      count: number;
    }
  | {
      kind: "legacy";
      ruleId: string;
      file: string;
      message: string;
      /** How many findings of the rule in the file it accepts; at least 1. */
      count: number;
    };

export type Baseline = { entries: readonly BaselineEntry[] };

/** Whether `baseline` still has entries an older stateward wrote (`OUTDATED_BASELINE`). */
export function isOutdated(baseline: Baseline | undefined): boolean {
  return baseline?.entries.some((entry) => entry.kind === "legacy") ?? false;
}

/** What fingerprinting needs: where paths are relative to, and the text the offsets point into. */
export type FingerprintContext = {
  configDir: string;
  /** The text of a file as the check saw it (unsaved editor text included), or undefined when unreadable. */
  readText: (file: string) => string | undefined;
};

/** The baseline file of `config`: next to the config file. */
export function baselineFile(config: Pick<Config, "configDir">): string {
  return path.join(config.configDir, BASELINE_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function fingerprintOfEntry(entry: BaselineEntry): string {
  return entry.kind === "fingerprint" ? entry.fingerprint : "";
}

function compareEntries(a: BaselineEntry, b: BaselineEntry): number {
  return (
    compareText(a.file, b.file) ||
    compareText(a.ruleId, b.ruleId) ||
    compareText(fingerprintOfEntry(a), fingerprintOfEntry(b))
  );
}

function broken(file: string, why: string, fix: string): BaselineError {
  return new BaselineError(`${path.basename(file)} ${why}; ${fix}`);
}

const REPAIR = "fix it, or delete it and run `stateward baseline` to write it again";

function relativeFile(configDir: string, file: string): string {
  return path.relative(configDir, file).split(path.sep).join("/");
}

/**
 * The text of the lines a finding covers, whitespace collapsed: re-indenting or reflowing the
 * flagged code does not make it new, changing it does. A span that ends at the start of a line
 * does not take that line.
 */
function sourceLines(text: string, start: number, end: number): string {
  const first = Math.min(Math.max(start, 0), text.length);
  const last = Math.min(Math.max(end > start ? end - 1 : start, first), text.length);
  const lineStart = first === 0 ? 0 : text.lastIndexOf("\n", first - 1) + 1;
  const newline = text.indexOf("\n", last);
  const lineEnd = newline === -1 ? text.length : newline;
  return text.slice(lineStart, lineEnd).replace(/\s+/g, " ").trim();
}

/**
 * Recognises a finding without its line number: the rule, the file and the text of the flagged
 * line(s). Moving the code keeps it; editing the flagged code makes it a new finding. The message
 * is not in it, so rewording a message never makes a baselined finding new.
 */
export function fingerprintOf(input: {
  ruleId: string;
  file: string;
  text: string;
  start: number;
  end: number;
}): string {
  const lines = sourceLines(input.text, input.start, input.end);
  return createHash("sha256")
    .update(JSON.stringify([input.ruleId, input.file, lines]))
    .digest("hex")
    .slice(0, 16);
}

/** A finding as the baseline knows it: failures are never accepted (the check was incomplete). */
type Known = {
  ruleId: string;
  file: string;
  fingerprint: string;
  message: string;
};

function keyOf(known: Pick<Known, "ruleId" | "file" | "fingerprint">): string {
  return JSON.stringify([known.ruleId, known.file, known.fingerprint]);
}

/** The key of a legacy entry: its rule and file (a fingerprint key has three parts). */
function legacyKeyOf(known: Pick<Known, "ruleId" | "file">): string {
  return JSON.stringify([known.ruleId, known.file]);
}

function entryKey(entry: BaselineEntry): string {
  return entry.kind === "fingerprint" ? keyOf(entry) : legacyKeyOf(entry);
}

/** Reads each file once; throws `BaselineError` for one that cannot be read (C35). */
function fingerprinter(context: FingerprintContext): (finding: Finding) => Known {
  const texts = new Map<string, string>();
  return (finding) => {
    const { file, start, end } = finding.location;
    let text = texts.get(file);
    if (text === undefined) {
      text = context.readText(file);
      if (text === undefined) {
        throw new BaselineError(
          `${relativeFile(context.configDir, file)} cannot be read to match its findings with the baseline; check that the file exists and is readable, then run again`,
        );
      }
      texts.set(file, text);
    }
    const relative = relativeFile(context.configDir, file);
    return {
      ruleId: finding.ruleId,
      file: relative,
      message: finding.message,
      fingerprint: fingerprintOf({ ruleId: finding.ruleId, file: relative, text, start, end }),
    };
  };
}

/**
 * Only problems are accepted. A place not checked (an unknown) is not a problem to accept, and a
 * rule failure means stateward is broken there.
 */
function isAcceptable(finding: Finding): boolean {
  return finding.kind === "problem";
}

/** The baseline that accepts exactly the problems in `findings` (unknowns and failures are left out). */
export function baselineOf(findings: readonly Finding[], context: FingerprintContext): Baseline {
  const fingerprint = fingerprinter(context);
  const entries = new Map<string, BaselineEntry>();
  for (const finding of findings.filter(isAcceptable)) {
    const { ruleId, file, fingerprint: print, message } = fingerprint(finding);
    const key = keyOf({ ruleId, file, fingerprint: print });
    const before = entries.get(key);
    entries.set(key, {
      kind: "fingerprint",
      ruleId,
      file,
      fingerprint: print,
      message,
      count: (before?.count ?? 0) + 1,
    });
  }
  return { entries: [...entries.values()].sort(compareEntries) };
}

/**
 * `existing` with the entries of the rules in `ran` replaced by those of `built`: rules that did
 * not run this time (off, or not yet on in the rollout) keep what they had.
 */
export function mergeBaseline(
  existing: Baseline | undefined,
  ran: ReadonlySet<string>,
  built: Baseline,
): Baseline {
  const kept = (existing?.entries ?? []).filter((entry) => !ran.has(entry.ruleId));
  return { entries: [...kept, ...built.entries].sort(compareEntries) };
}

/** How many findings a baseline accepts and in how many files. */
export function sizeOf(baseline: Baseline): { findings: number; files: number } {
  return {
    findings: baseline.entries.reduce((sum, entry) => sum + entry.count, 0),
    files: new Set(baseline.entries.map((entry) => entry.file)).size,
  };
}

/** The result of laying a baseline over a check. */
export type BaselineView = {
  /** Only the new findings, capped per rule and file like a plain check. */
  fresh: CheckResult;
  /** The findings the baseline accepts. */
  baselined: readonly Finding[];
  /** Accepted findings of the rules that ran that are no longer found. */
  fixed: number;
  /** The baseline without the fixed ones (what `--prune` writes); undefined without a baseline. */
  pruned: Baseline | undefined;
};

/**
 * The entry a finding uses up: by its fingerprint, else a legacy entry of its rule in its file
 * (an older stateward's fingerprints cannot be recomputed, so those match by count).
 */
function matchingKey(known: Known, remaining: ReadonlyMap<string, number>): string | undefined {
  return [keyOf(known), legacyKeyOf(known)].find((key) => (remaining.get(key) ?? 0) > 0);
}

/**
 * Lays `baseline` over `result`, which must come from an uncapped run (the cap is applied here,
 * to the new findings only). A finding matches an entry by fingerprint, else a legacy entry of
 * its rule and file, and uses up one of its counts. Only the rules in `ran` are matched: an entry of a rule that did not run is neither
 * matched nor counted as fixed. Without a baseline everything is new.
 */
export function applyBaseline(
  baseline: Baseline | undefined,
  result: CheckResult,
  context: FingerprintContext & { ran: ReadonlySet<string> },
): BaselineView {
  const capped = (findings: readonly Finding[]): CheckResult => {
    const limited = limitFindings(findings);
    return { ...result, findings: limited.findings, hidden: limited.hidden };
  };
  if (baseline === undefined) {
    return { fresh: capped(result.findings), baselined: [], fixed: 0, pruned: undefined };
  }
  const fingerprint = fingerprinter(context);
  const remaining = new Map<string, number>();
  for (const entry of baseline.entries) {
    if (context.ran.has(entry.ruleId)) remaining.set(entryKey(entry), entry.count);
  }
  const total = new Map(remaining);
  const fresh: Finding[] = [];
  const baselined: Finding[] = [];
  for (const finding of result.findings) {
    const key =
      finding.kind === "failure" ? undefined : matchingKey(fingerprint(finding), remaining);
    const left = key === undefined ? undefined : remaining.get(key);
    if (key === undefined || left === undefined) {
      fresh.push(finding);
      continue;
    }
    remaining.set(key, left - 1);
    // An unknown an older baseline accepted uses up its entry, so it is not called fixed, but it
    // is still shown: a place not checked is never hidden.
    if (isAcceptable(finding)) baselined.push(finding);
    else fresh.push(finding);
  }
  const fixed = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  const entries = baseline.entries.flatMap((entry): BaselineEntry[] => {
    if (!context.ran.has(entry.ruleId)) return [entry];
    const key = entryKey(entry);
    const count = (total.get(key) ?? 0) - (remaining.get(key) ?? 0);
    return count === 0 ? [] : [{ ...entry, count }];
  });
  return { fresh: capped(fresh), baselined, fixed, pruned: { entries } };
}

/** An entry as it is in the file, before legacy entries of one rule and file are combined. */
type RawEntry = { entry: BaselineEntry; key: string };

function parseEntry(value: unknown, file: string, version: number): RawEntry {
  if (!isRecord(value)) {
    throw broken(file, "has a finding that is not an object", REPAIR);
  }
  const extra = Object.keys(value).find(
    (key) =>
      !["ruleId", "file", "fingerprint", "message", "count"].includes(key) &&
      !(version === BASELINE_VERSION && key === "legacy"),
  );
  if (extra !== undefined)
    throw broken(file, `has a finding with an unknown key "${extra}"`, REPAIR);
  const { ruleId, file: entryFile, fingerprint, message, count = 1, legacy = false } = value;
  if (legacy !== true && legacy !== false) {
    throw broken(
      file,
      `has "legacy" ${JSON.stringify(legacy)}; it must be true or left out`,
      REPAIR,
    );
  }
  const old = version === LEGACY_VERSION || legacy;
  if (
    typeof ruleId !== "string" ||
    typeof entryFile !== "string" ||
    typeof message !== "string" ||
    ruleId === "" ||
    entryFile === "" ||
    (!legacy && (typeof fingerprint !== "string" || fingerprint === ""))
  ) {
    throw broken(
      file,
      legacy
        ? 'has a legacy finding that needs "ruleId", "file" and "message" as text'
        : 'has a finding that needs "ruleId", "file", "fingerprint" and "message" as text',
      REPAIR,
    );
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    throw broken(
      file,
      `has "count" ${JSON.stringify(count)} for ${ruleId}; it must be a whole number of 1 or more`,
      REPAIR,
    );
  }
  if (legacy && fingerprint !== undefined) {
    throw broken(file, `has a legacy ${ruleId} finding with a "fingerprint"`, REPAIR);
  }
  const raw = JSON.stringify([
    ruleId,
    entryFile,
    typeof fingerprint === "string" ? fingerprint : "",
  ]);
  if (!old && typeof fingerprint === "string") {
    return {
      entry: { kind: "fingerprint", ruleId, file: entryFile, fingerprint, message, count },
      key: raw,
    };
  }
  // An entry an older stateward wrote: its fingerprint hashed the headline, so it is matched by
  // rule and file.
  return {
    entry: { kind: "legacy", ruleId, file: entryFile, message, count },
    key: raw,
  };
}

/** Legacy entries of one rule in one file are one entry, their counts added. */
function combineLegacy(entries: readonly BaselineEntry[]): BaselineEntry[] {
  const combined = new Map<string, BaselineEntry>();
  for (const entry of entries) {
    const key = entryKey(entry);
    const before = combined.get(key);
    combined.set(
      key,
      before === undefined ? entry : { ...before, count: before.count + entry.count },
    );
  }
  return [...combined.values()];
}

function parseBaseline(text: string, file: string): Baseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw broken(file, `is not valid JSON (${reasonOf(error)})`, REPAIR);
  }
  if (!isRecord(parsed)) {
    throw broken(
      file,
      `must be an object like { "version": ${String(BASELINE_VERSION)}, "findings": [] }`,
      REPAIR,
    );
  }
  const extra = Object.keys(parsed).find((key) => key !== "version" && key !== "findings");
  if (extra !== undefined) throw broken(file, `has an unknown key "${extra}"`, REPAIR);
  const { version } = parsed;
  if (version !== BASELINE_VERSION && version !== LEGACY_VERSION) {
    throw broken(
      file,
      `has version ${JSON.stringify(version)}, but this stateward reads versions ${String(LEGACY_VERSION)} and ${String(BASELINE_VERSION)}`,
      "update stateward, or delete the file and run `stateward baseline` to write it again",
    );
  }
  const { findings } = parsed;
  if (!Array.isArray(findings)) throw broken(file, '"findings" must be a list', REPAIR);
  const seen = new Set<string>();
  const entries = findings.map((value: unknown) => {
    const { entry, key } = parseEntry(value, file, version);
    if (seen.has(key)) {
      throw broken(
        file,
        `lists the same ${entry.ruleId} finding in ${entry.file} twice`,
        'remove one of the two and raise "count" on the other, or run `stateward baseline` to write the file again',
      );
    }
    seen.add(key);
    return entry;
  });
  return { entries: combineLegacy(entries).sort(compareEntries) };
}

/**
 * The baseline, or undefined when there is no file. A file that cannot be read or understood
 * throws `BaselineError`, never "no baseline" (C35).
 */
export function readBaseline(config: Pick<Config, "configDir">): Baseline | undefined {
  const file = baselineFile(config);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new BaselineError(
      `${path.basename(file)} cannot be read (${reasonOf(error)}); fix the file or its permissions, then run again`,
      { cause: error },
    );
  }
  return parseBaseline(text, file);
}

function writtenEntry(entry: BaselineEntry): Record<string, unknown> {
  const count = entry.count > 1 ? { count: entry.count } : {};
  return entry.kind === "fingerprint"
    ? {
        ruleId: entry.ruleId,
        file: entry.file,
        fingerprint: entry.fingerprint,
        message: entry.message,
        ...count,
      }
    : { ruleId: entry.ruleId, file: entry.file, message: entry.message, ...count, legacy: true };
}

/**
 * Saves the baseline, sorted, in the current version (legacy entries kept, marked `"legacy"`).
 * Atomic: the text goes to a temp file beside the target, then one rename replaces it, so a crash
 * leaves the old file or the new one, never half of it.
 */
export function writeBaseline(config: Pick<Config, "configDir">, baseline: Baseline): void {
  const file = baselineFile(config);
  const temp = `${file}.${String(process.pid)}.tmp`;
  const findings = [...baseline.entries].sort(compareEntries).map(writtenEntry);
  const text = `${JSON.stringify({ version: BASELINE_VERSION, findings }, null, 2)}\n`;
  try {
    writeFileSync(temp, text);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw new BaselineError(
      `${path.basename(file)} cannot be written (${reasonOf(error)}); check that the folder is writable, then run again`,
      { cause: error },
    );
  }
}
