import { createHash } from "node:crypto";
import { isQueryKind } from "./backend/program-record.js";
import type { HostQuery, ProgramRecord } from "./backend/program-record.js";
import type {
  Finding,
  Fix,
  FixForm,
  FixVerdict,
  Json,
  Location,
  RelatedLocation,
  Rule,
  Severity,
} from "./types.js";

/**
 * The results a checker keeps between runs, by content:
 *
 * - per own file, under its dependency fingerprint (backend/fingerprints.ts), and per rule under
 *   its rule key (`ruleKey`): the findings the rule reported on that file, and a project rule's
 *   summary; with the full fingerprint of each other file whose syntax the rules read there. A
 *   file whose fingerprint and reads are unchanged is not looked at again.
 * - per project rule, under its rule key: a hash of all its summaries, and the findings its check
 *   produced from them. Equal summaries give equal findings (a project rule decides from its
 *   summaries and options alone), so an edit that leaves every summary as it was does not run
 *   the check again (early cut-off).
 *
 * In memory in the checker (the language server keeps it for its life); the CLI and the language
 * server save it to disk between runs as a `CacheSnapshot` (disk-cache.ts).
 */

/** Bumped whenever what is stored, or how a key is computed, changes. */
export const CACHE_FORMAT = 5;

/**
 * A project rule's summary of one file: the hash of its JSON text, and either that text or, once a
 * rule or a hover needed the value (a run whose summaries are all unchanged never does), the parsed
 * value alone. Keeping both held the summaries twice in the language server; the text is
 * written again from the value when the cache is saved (`summaryText`).
 */
export type CachedSummary = {
  readonly hash: string;
  form:
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "parsed"; readonly value: Json };
};

/** What one rule produced on one file. */
export type RuleResult = { findings: readonly Finding[]; summary?: CachedSummary };

/** Frozen all the way down: a cached summary is shared between runs, so no rule may change it. */
function deepFreeze(value: Json): Json {
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

/**
 * A summary as JSON stores it (a Map becomes `{}`, `undefined` members disappear): a project rule
 * cannot depend on a value JSON drops, and equal texts are equal summaries.
 */
export function summaryOf(value: Json): CachedSummary {
  const text = JSON.stringify(value);
  return { hash: sha1(text), form: { kind: "text", text } };
}

/** A summary read back as its text and hash (the disk cache). */
export function summaryFromText(text: string, hash: string): CachedSummary {
  return { hash, form: { kind: "text", text } };
}

/** The summary's value, parsed from its text once and frozen; the text is then let go. */
export function summaryValue(summary: CachedSummary): Json {
  const { form } = summary;
  if (form.kind === "parsed") return form.value;
  const parsed: unknown = JSON.parse(form.text);
  const value = deepFreeze(isJson(parsed) ? parsed : null);
  summary.form = { kind: "parsed", value };
  return value;
}

/**
 * The summary's JSON text: kept, or written again from the parsed value. JSON text parsed and
 * written again is the same text (`JSON.stringify` wrote it), so the hash still matches it.
 */
export function summaryText(summary: CachedSummary): string {
  const { form } = summary;
  return form.kind === "text" ? form.text : JSON.stringify(form.value);
}
export type FileEntry = {
  fingerprint: string;
  rules: ReadonlyMap<string, RuleResult>;
  /**
   * The other files whose syntax the rules read on this file (`TypeQueries.declarationOf`), with
   * each one's full fingerprint then: the entry holds while each is the same.
   */
  reads: ReadonlyMap<string, string>;
};
export type ProjectEntry = {
  /** Hash of the rule's summaries, by file. */
  inputs: string;
  findings: readonly Finding[];
  /**
   * The summaries as the rule received them, handed to hovers (the same object while unchanged);
   * undefined until asked for when the entry came from disk.
   */
  summaries?: ReadonlyMap<string, Json>;
};

export type ResultCache = {
  files: Map<string, FileEntry>;
  projects: Map<string, ProjectEntry>;
  /** By tsconfig path: what its program was built from (backend/program-record.ts). */
  programs: Map<string, ProgramRecord>;
  /**
   * Whether a fix compiles (`Checker.reviewFixes`), by a hash of the fingerprints of the files it
   * edits and its edits: equal fingerprints mean the same code around the fix, so the same verdict.
   * A fix that could not be tried is not kept.
   */
  verdicts: Map<string, Exclude<FixVerdict, { kind: "unchecked" }>>;
  /** Set when a run stored or dropped anything: only then is there something new to save. */
  changed: boolean;
};

export function emptyCache(): ResultCache {
  return {
    files: new Map(),
    projects: new Map(),
    programs: new Map(),
    verdicts: new Map(),
    changed: false,
  };
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/**
 * What a rule's results depend on besides the file: the rule (its id, its code and its meta), how
 * the config runs it (severity, options, add-ons) and the cache format. The rule's code is part of
 * the key so that editing a rule's `check` or `summarize` (a team's own rule in its config) misses;
 * a change only in a helper it calls is caught on disk by the implementation id
 * (implementation.ts), which the CLI's cache file must match.
 */
export function ruleKey(input: {
  id: string;
  rule: Rule;
  severity: Severity;
  options: unknown;
  addons: readonly string[];
  /** The config's facts about packages: a rule that reads them decides differently when they change. */
  facts?: unknown;
}): string {
  const { rule } = input;
  const code =
    rule.kind === "project"
      ? [rule.summarize.toString(), rule.check.toString()]
      : [rule.check.toString()];
  return sha1(
    JSON.stringify([
      CACHE_FORMAT,
      input.id,
      rule.kind,
      input.severity,
      input.options,
      input.addons,
      input.facts ?? {},
      rule.meta,
      code,
    ]),
  );
}

// ---- snapshots: the cache as JSON, for the disk ------------------------------------------------

/** The cache as plain JSON. Read back with `parseSnapshot`, which checks every field. */
export type CacheSnapshot = {
  format: number;
  files: Record<
    string,
    {
      fingerprint: string;
      /** `summary` is the summary's JSON text, `hash` that text's hash. */
      rules: Record<string, { findings: readonly Finding[]; summary?: string; hash?: string }>;
      /** `FileEntry.reads`. */
      reads: Record<string, string>;
    }
  >;
  projects: Record<string, { inputs: string; findings: readonly Finding[] }>;
  programs: Record<string, ProgramRecord>;
  /** `ResultCache.verdicts`: `null` for a fix that compiles, else TypeScript's message. */
  verdicts?: Record<string, string | null>;
};

export function toSnapshot(cache: ResultCache): CacheSnapshot {
  const files: CacheSnapshot["files"] = {};
  for (const [file, entry] of [...cache.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const rules: CacheSnapshot["files"][string]["rules"] = {};
    for (const [key, result] of entry.rules) {
      rules[key] =
        result.summary === undefined
          ? { findings: result.findings }
          : {
              findings: result.findings,
              summary: summaryText(result.summary),
              hash: result.summary.hash,
            };
    }
    files[file] = {
      fingerprint: entry.fingerprint,
      rules,
      reads: Object.fromEntries([...entry.reads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    };
  }
  const projects: CacheSnapshot["projects"] = {};
  for (const [key, entry] of cache.projects) {
    projects[key] = { inputs: entry.inputs, findings: entry.findings };
  }
  return {
    format: CACHE_FORMAT,
    files,
    projects,
    programs: Object.fromEntries([...cache.programs]),
    verdicts: Object.fromEntries(
      [...cache.verdicts]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, verdict]) => [key, verdict.kind === "compiles" ? null : verdict.error]),
    ),
  };
}

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJson(value: unknown): value is Json {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJson);
  return isFields(value) && Object.values(value).every(isJson);
}

function parseLocation(value: unknown): Location | undefined {
  if (!isFields(value)) return undefined;
  const { file, start, end } = value;
  return typeof file === "string" && typeof start === "number" && typeof end === "number"
    ? { file, start, end }
    : undefined;
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: T[] = [];
  for (const item of value) {
    const one = parse(item);
    if (one === undefined) return undefined;
    parsed.push(one);
  }
  return parsed;
}

function parseRelated(value: unknown): RelatedLocation | undefined {
  if (!isFields(value) || typeof value.message !== "string") return undefined;
  const location = parseLocation(value.location);
  return location && { location, message: value.message };
}

function parseForm(value: unknown): FixForm | undefined {
  if (!isFields(value) || typeof value.title !== "string") return undefined;
  const edits = parseList(value.edits, (edit) => {
    if (!isFields(edit) || typeof edit.newText !== "string") return undefined;
    const location = parseLocation(edit.location);
    return location && { location, newText: edit.newText };
  });
  return (
    edits && {
      title: value.title,
      edits,
      // `safe: false` is kept as written: a cached finding prints exactly as a fresh one.
      ...(typeof value.safe === "boolean" ? { safe: value.safe } : {}),
      ...(value.changesType === true ? { changesType: true } : {}),
    }
  );
}

function parseFix(value: unknown): Fix | undefined {
  const form = parseForm(value);
  if (form === undefined || !isFields(value)) return undefined;
  if (value.alternatives === undefined) return form;
  const alternatives = parseList(value.alternatives, parseForm);
  return alternatives && { ...form, alternatives };
}

function isSeverity(value: unknown): value is Severity {
  return value === "error" || value === "warning" || value === "info";
}

function parseProgramRecord(value: unknown): ProgramRecord | undefined {
  if (
    !isFields(value) ||
    typeof value.inputs !== "string" ||
    !isFields(value.fingerprints) ||
    !isFields(value.reads)
  ) {
    return undefined;
  }
  const queries = parseList(value.queries, (query): HostQuery | undefined => {
    if (!Array.isArray(query) || query.length !== 3) return undefined;
    const parts: readonly unknown[] = query;
    const [kind, path, answer] = parts;
    return isQueryKind(kind) && typeof path === "string" && typeof answer === "string"
      ? [kind, path, answer]
      : undefined;
  });
  const files = parseList(value.files, (file) => (typeof file === "string" ? file : undefined));
  const fingerprints: Record<string, string> = {};
  for (const [file, fingerprint] of Object.entries(value.fingerprints)) {
    if (typeof fingerprint !== "string") return undefined;
    fingerprints[file] = fingerprint;
  }
  const reads = stringRecord(value.reads);
  if (queries === undefined || files === undefined || reads === undefined) return undefined;
  return { inputs: value.inputs, queries, files, fingerprints, reads };
}

/** A JSON object of strings, as a record; undefined when anything else. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isFields(value)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    record[key] = item;
  }
  return record;
}

export function parseFinding(value: unknown): Finding | undefined {
  if (!isFields(value)) return undefined;
  const { kind, ruleId, message, hint } = value;
  const location = parseLocation(value.location);
  if (
    typeof ruleId !== "string" ||
    typeof message !== "string" ||
    typeof hint !== "string" ||
    location === undefined
  ) {
    return undefined;
  }
  if (kind === "failure") return { kind, ruleId, message, hint, location };
  if (kind === "unknown") {
    return value.listed === true
      ? { kind, ruleId, message, hint, location, listed: true }
      : { kind, ruleId, message, hint, location };
  }
  if (kind !== "problem" || !isSeverity(value.severity)) return undefined;
  const related = parseList(value.related, parseRelated);
  const fixes = parseList(value.fixes, parseFix);
  if (related === undefined || fixes === undefined) return undefined;
  const { findingKind } = value;
  if (findingKind !== undefined && typeof findingKind !== "string") return undefined;
  const about = value.about === undefined ? undefined : parseLocation(value.about);
  if (value.about !== undefined && about === undefined) return undefined;
  return {
    kind,
    ruleId,
    severity: value.severity,
    message,
    hint,
    location,
    related,
    fixes,
    ...(findingKind === undefined ? {} : { findingKind }),
    ...(about === undefined ? {} : { about }),
  };
}

/**
 * A cache read back from JSON. Anything that does not have the expected shape, or another format,
 * is an empty cache: a broken cache costs a cold run, never findings (workspace C35).
 */
export function parseSnapshot(value: unknown): ResultCache {
  const cache = emptyCache();
  if (!isFields(value) || value.format !== CACHE_FORMAT) return cache;
  const { files, projects, programs, verdicts } = value;
  if (!isFields(files) || !isFields(projects) || !isFields(programs)) return cache;
  if (verdicts !== undefined && !isFields(verdicts)) return cache;
  for (const [key, verdict] of Object.entries(verdicts ?? {})) {
    if (verdict === null) cache.verdicts.set(key, { kind: "compiles" });
    else if (typeof verdict === "string")
      cache.verdicts.set(key, { kind: "breaks", error: verdict });
    else return emptyCache();
  }
  for (const [tsconfig, record] of Object.entries(programs)) {
    const parsed = parseProgramRecord(record);
    if (parsed === undefined) return emptyCache();
    cache.programs.set(tsconfig, parsed);
  }
  for (const [file, entry] of Object.entries(files)) {
    if (!isFields(entry) || typeof entry.fingerprint !== "string" || !isFields(entry.rules)) {
      return emptyCache();
    }
    const reads = stringRecord(entry.reads);
    if (reads === undefined) return emptyCache();
    const rules = new Map<string, RuleResult>();
    for (const [key, result] of Object.entries(entry.rules)) {
      if (!isFields(result)) return emptyCache();
      const findings = parseList(result.findings, parseFinding);
      if (findings === undefined) return emptyCache();
      const { summary, hash } = result;
      if (summary === undefined && hash === undefined) {
        rules.set(key, { findings });
      } else if (typeof summary === "string" && typeof hash === "string") {
        rules.set(key, { findings, summary: summaryFromText(summary, hash) });
      } else {
        return emptyCache();
      }
    }
    cache.files.set(file, {
      fingerprint: entry.fingerprint,
      rules,
      reads: new Map(Object.entries(reads)),
    });
  }
  for (const [key, entry] of Object.entries(projects)) {
    if (!isFields(entry) || typeof entry.inputs !== "string") return emptyCache();
    const findings = parseList(entry.findings, parseFinding);
    if (findings === undefined) return emptyCache();
    // The summaries are rebuilt from the file entries when the rule runs.
    cache.projects.set(key, { inputs: entry.inputs, findings });
  }
  return cache;
}
