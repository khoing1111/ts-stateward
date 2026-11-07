import path from "node:path";
import type ts from "typescript";
import { readRollout } from "./rollout.js";
import { ruleKey, sha1, summaryOf, summaryText, summaryValue } from "./cache.js";
import type { CachedSummary, FileEntry, ResultCache, RuleResult } from "./cache.js";
import { defaultOptions } from "./options.js";
import { codeOf, loadRule } from "./lazy.js";
import { IGNORE_EXPLAIN, IGNORE_RULE_ID, applyIgnores, fileDirectives } from "./ignores.js";
import type { IgnoreDirective, IgnoreScope } from "./ignores.js";
import {
  addonsWith,
  appliedOverrides,
  ruleIsOn,
  ruleSetting,
  ruleSettingWith,
} from "./severity.js";
import { matchingOverrides } from "./overrides.js";
import { defaults } from "./config.js";
import picomatch from "picomatch";
import { isGlob } from "./tsconfigs.js";
import type { ProjectUnit } from "./backend/typescript6.js";
import type { TimingRecorder } from "./timing.js";
import type {
  PackageFactsConfig,
  CheckNotes,
  CheckResult,
  MissingTypes,
  Config,
  FileContext,
  Finding,
  Fix,
  HiddenFindings,
  Json,
  Location,
  Options,
  OptionValue,
  ProjectContext,
  RelatedLocation,
  Rule,
  RuleSelection,
  RuleSetting,
  Severity,
  TypeQueries,
  UnknownsSetting,
} from "./types.js";

const RULE_SETTINGS: readonly RuleSetting[] = ["error", "warning", "info", "off"];

/** More findings of one rule in one file than this are counted, not listed. */
export const MAX_FINDINGS_PER_RULE_PER_FILE = 20;

/**
 * The id of the finding for a file TypeScript could not parse cleanly, and the key it is cached
 * under in the file's entry (no rule key is this short, so they never meet).
 */
export const SYNTAX_RULE_ID = "stateward/syntax";

/** The one `unknown` finding for a file with a syntax error (never checked silently). */
function syntaxFinding(unit: ProjectUnit, file: string, cwd: string): Finding[] {
  const error = unit.syntaxError(file);
  if (error === undefined) return [];
  const name = path.relative(cwd, file).split(path.sep).join("/");
  return [
    {
      kind: "unknown",
      ruleId: SYNTAX_RULE_ID,
      message: `not checked: \`${name}\`: it has a syntax error`,
      hint: `fix the syntax error at line ${String(error.line)}:${String(error.column)} (${error.message}), then check again`,
      location: { file, start: error.start, end: error.end },
    },
  ];
}

/** The id of the finding for a file with imports that do not resolve; cached like the syntax one. */
export const IMPORTS_RULE_ID = "stateward/imports";

const MAX_HEADLINE = 100;

/** `text` cut in the middle with `…` to at most `max` characters. */
function squeeze(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(2, max - 1);
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/**
 * The headline of an imports finding (M19), in at most 100 characters: the specifier is shortened
 * in the middle when it does not fit; the location shows the file.
 */
function importsMessage(specifier: string, untyped: boolean): string {
  const relative = specifier.startsWith(".") || specifier.startsWith("/");
  const why = untyped
    ? "it has no types"
    : relative
      ? "the file is not found"
      : "the package is not installed";
  const form = (spec: string): string => `not checked: code using \`${spec}\`: ${why}`;
  const whole = form(specifier);
  if (whole.length <= MAX_HEADLINE) return whole;
  const room = MAX_HEADLINE - form("").length;
  return form(squeeze(specifier, room));
}

/** The one `unknown` finding for a file whose imports do not resolve (types from them are unknown). */
function importsFinding(unit: ProjectUnit, file: string, cwd: string): Finding[] {
  const [first, ...rest] = unit.unresolvedImports(file);
  if (first === undefined) return [];
  const more = rest.length > 0 ? `; ${String(rest.length)} more unresolved in the file` : "";
  // Imports resolve by the project's options: a file two projects list says which one decided.
  const project = unit.listedElsewhere(file)
    ? ` (checked as part of \`${path.relative(cwd, unit.tsconfig).split(path.sep).join("/")}\`)`
    : "";
  const untyped = first.kind === "untyped";
  const types = `@types/${first.specifier.replace(/^@([^/]+)\//, "$1__")}`;
  return [
    {
      kind: "unknown",
      ruleId: IMPORTS_RULE_ID,
      message: importsMessage(first.specifier, untyped),
      hint: untyped
        ? `install its types (\`${types}\`) or declare the module${more}${project}`
        : `install the project's packages (or build its workspace packages) and check again${more}${project}`,
      location: { file, start: first.start, end: first.end },
    },
  ];
}

/** The remedy said once when a project checks without `strictNullChecks`. */
export const STRICT_NULLS_REMEDY =
  "set `strict: true` or `strictNullChecks: true` in tsconfig.json";

/** Added to the fix line of a finding whose fix relies on `strictNullChecks` in a project without it. */
export const LOOSE_NULLS_FIX = `\`strictNullChecks\` is off in this project, so TypeScript does not check \`null\` and \`undefined\` in this fix: ${STRICT_NULLS_REMEDY}`;

/** Why rules that read a library by its types could not run: "React's types are not installed (…)". */
export function missingTypesReason(library: string): string {
  return `${library}'s types are not installed (install the app's dependencies)`;
}

/**
 * What the run cannot check as a whole (`CheckResult.notes`): the rules among `rules` whose
 * library's types do not resolve in some project with files, and the projects without
 * `strictNullChecks`. Undefined when there is nothing to say.
 */
function notesOf(
  units: readonly ProjectUnit[],
  rules: readonly { id: string; rule: Rule }[],
): CheckNotes | undefined {
  const missing = new Map<string, Set<string>>();
  const looseNulls: string[] = [];
  for (const unit of units) {
    if (unit.files.length === 0) continue;
    if (!unit.strictNullChecks) looseNulls.push(unit.tsconfig);
    for (const entry of rules) {
      const needs = entry.rule.meta.needsTypes;
      if (needs === undefined || needs.modules.some((module) => unit.typesResolve(module)))
        continue;
      const ids = missing.get(needs.library) ?? new Set<string>();
      ids.add(entry.id);
      missing.set(needs.library, ids);
    }
  }
  if (missing.size === 0 && looseNulls.length === 0) return undefined;
  const missingTypes: MissingTypes[] = [...missing]
    .sort(([a], [b]) => compareText(a, b))
    .map(([library, ids]) => ({
      library,
      reason: missingTypesReason(library),
      rules: [...ids].sort(compareText),
    }));
  return { missingTypes, looseNulls };
}

/** The own files of the projects without `strictNullChecks`. */
function looseNullFiles(units: readonly ProjectUnit[]): ReadonlySet<string> {
  return new Set(units.flatMap((unit) => (unit.strictNullChecks ? [] : unit.files)));
}

/**
 * `findings` with `LOOSE_NULLS_FIX` added to the fix line of each problem whose rule's fix needs
 * `strictNullChecks` (`RuleInfo.fixNeedsStrictNulls`) in a file of a project without it.
 */
function withLooseNullFixes(
  findings: Finding[],
  rules: readonly { id: string; rule: Rule }[],
  loose: ReadonlySet<string>,
): Finding[] {
  if (loose.size === 0) return findings;
  const affected = new Set(
    rules.filter((entry) => entry.rule.meta.fixNeedsStrictNulls === true).map((entry) => entry.id),
  );
  if (affected.size === 0) return findings;
  return findings.map((finding) =>
    finding.kind === "problem" && affected.has(finding.ruleId) && loose.has(finding.location.file)
      ? { ...finding, hint: `${finding.hint}\n${LOOSE_NULLS_FIX}` }
      : finding,
  );
}

/** What ignore comments may name, and what ran: the config's rules and what stateward reports itself. */
function ignoreScope(config: Config, ran: readonly ActiveRule[]): IgnoreScope {
  const known = new Set([SYNTAX_RULE_ID, IMPORTS_RULE_ID]);
  for (const plugin of config.plugins) {
    for (const key of Object.keys(plugin.rules)) known.add(`${plugin.name}/${key}`);
  }
  return {
    known,
    ran: new Set([SYNTAX_RULE_ID, IMPORTS_RULE_ID, ...ran.map((entry) => entry.id)]),
    options: config.ignores,
  };
}

const FAILURE_HINT = "report this to the rule's authors; the rest of the check ran normally";

type ActiveRule = {
  id: string;
  /** The plugin's name and the rule's name within it: `id` is "<plugin>/<name>". */
  plugin: string;
  name: string;
  rule: Rule;
  severity: Severity;
  /** The config's add-ons of the rule's plugin, without the "<plugin>/" prefix. */
  addons: readonly string[];
  options: Options;
  /** The config's facts about packages, for every rule: part of its cache key. */
  facts: PackageFactsConfig;
};

function nodeLocation(node: ts.Node): Location {
  return { file: node.getSourceFile().fileName, start: node.getStart(), end: node.getEnd() };
}

/**
 * The rules a run uses, with the settings of the files they run on. A rule that is on in the
 * config or in some override is in `anywhere` (a project rule reads every file, and filters its
 * findings by file); a file rule is run on a file at the severity and with the add-ons that file
 * has once the `overrides` matching it are applied (`forFile`).
 */
type RuleSets = {
  anywhere: readonly RuleEntry[];
  /** What to run on `file`: the project rules (for their summaries) and the file rules that are on there. */
  forFile(file: string): readonly RuleEntry[];
  /** Whether findings need to be judged by the file they are in. */
  perFile: boolean;
  /** The setting of a rule at a file, "off" when it is not on there. */
  settingAt(ruleId: string, file: string): RuleSetting;
};

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The rule's options with each shared list joined with the other rule's (`RuleInfo.sharedOptions`). */
function withSharedOptions(config: Config, plugin: string, rule: Rule, options: Options): Options {
  const shared = Object.entries(rule.meta.sharedOptions ?? {});
  if (shared.length === 0) return options;
  const merged: Record<string, OptionValue> = { ...options };
  for (const [name, owner] of shared) {
    const own = options[name];
    const theirs = config.ruleOptions[`${plugin}/${owner}`]?.[name];
    if (isStrings(own) && isStrings(theirs)) merged[name] = [...new Set([...theirs, ...own])];
  }
  return merged;
}

/** A rule with the settings it runs under, and the key its cached results are kept under. */
function entryOf(
  config: Config,
  plugin: string,
  name: string,
  rule: Rule,
  severity: Severity,
  addons: readonly string[],
): RuleEntry {
  const id = `${plugin}/${name}`;
  const options = withSharedOptions(
    config,
    plugin,
    rule,
    config.ruleOptions[id] ?? defaultOptions(rule.meta.options),
  );
  const active: ActiveRule = {
    id,
    plugin,
    name,
    rule,
    severity,
    addons,
    options,
    facts: config.facts,
  };
  return { ...active, key: ruleKey(active) };
}

function ruleSets(config: Config, selection: RuleSelection): RuleSets {
  const rolledOut = rolloutSet(config, selection);
  const anywhere: RuleEntry[] = [];
  const known = new Map<string, RuleEntry>();
  for (const plugin of config.plugins) {
    const prefix = `${plugin.name}/`;
    const addons = config.addons
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length));
    for (const [name, rule] of Object.entries(plugin.rules)) {
      const id = `${plugin.name}/${name}`;
      if (!ruleIsOn(config, plugin.name, name, rule.meta)) continue;
      if (!isSelected(selection, rolledOut, id, `${plugin.name}/${rule.meta.group}`)) continue;
      const base = ruleSetting(config, plugin.name, name, rule.meta);
      // A rule that only an override turns on has no config severity; project findings take
      // their own from the file they are in, so this one is never shown.
      const severity = base === "off" ? rule.meta.defaultSeverity : base;
      anywhere.push(entryOf(config, plugin.name, name, codeOf(id, rule), severity, addons));
    }
  }
  anywhere.sort((a, b) => compareText(a.id, b.id));
  for (const entry of anywhere) known.set(entry.id, entry);
  const perFile = config.overrides.length > 0;
  const variants = new Map<string, readonly RuleEntry[]>();
  const settings = new Map<string, RuleSetting>();
  return {
    anywhere,
    perFile,
    forFile(file) {
      if (!perFile) return anywhere;
      const matched = matchingOverrides(config, file);
      const key = matched.join(",");
      let found = variants.get(key);
      if (found === undefined) {
        const applied = appliedOverrides(config, matched);
        found = anywhere.flatMap((entry) => {
          if (entry.rule.kind === "project") return [entry];
          const setting = ruleSettingWith(
            config,
            applied,
            entry.plugin,
            entry.name,
            entry.rule.meta,
          );
          if (setting === "off") return [];
          const prefix = `${entry.plugin}/`;
          const addons = addonsWith(config, applied)
            .filter((one) => one.startsWith(prefix))
            .map((one) => one.slice(prefix.length));
          return [entryOf(config, entry.plugin, entry.name, entry.rule, setting, addons)];
        });
        variants.set(key, found);
      }
      return found;
    },
    settingAt(ruleId, file) {
      const key = `${ruleId}\u0000${file}`;
      let found = settings.get(key);
      if (found === undefined) {
        const entry = known.get(ruleId);
        found =
          entry === undefined
            ? "off"
            : ruleSetting(config, entry.plugin, entry.name, entry.rule.meta, file);
        settings.set(key, found);
      }
      return found;
    },
  };
}

/** The rules the rollout file turns on, or undefined when the rollout does not narrow this run. */
function rolloutSet(config: Config, selection: RuleSelection): ReadonlySet<string> | undefined {
  return selection.kind === "configured" && config.rollout
    ? new Set(readRollout(config))
    : undefined;
}

function isSelected(
  selection: RuleSelection,
  rolledOut: ReadonlySet<string> | undefined,
  id: string,
  groupId: string,
): boolean {
  switch (selection.kind) {
    case "configured":
      return rolledOut === undefined || rolledOut.has(id);
    case "all":
      return true;
    case "only":
      return selection.ruleId === id;
    case "group":
      return selection.groupId === groupId;
    default: {
      const unreachable: never = selection;
      return unreachable;
    }
  }
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    compareText(a.location.file, b.location.file) ||
    a.location.start - b.location.start ||
    compareText(a.ruleId, b.ruleId) ||
    compareText(a.message, b.message)
  );
}

/** The first line only: a finding's headline is one line; the stack goes nowhere useful here. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split(/\r?\n/, 1)[0] ?? "";
}

/**
 * The setting the config gives one kind of finding through the rule's `option.severities`, or
 * undefined when the finding has no kind or the config leaves its kind out. A kind the rule does
 * not declare is a bug in the rule, so it fails like any other rule error.
 */
function kindSetting(
  { rule, options }: ActiveRule,
  findingKind: string | undefined,
): RuleSetting | undefined {
  if (findingKind === undefined) return undefined;
  for (const [name, spec] of Object.entries(rule.meta.options ?? {})) {
    if (spec.kind !== "severities") continue;
    if (!Object.hasOwn(spec.kinds, findingKind)) break;
    const given = options[name];
    if (typeof given !== "object") return undefined;
    const setting: unknown = Object.entries(given).find(([kind]) => kind === findingKind)?.[1];
    return RULE_SETTINGS.find((word) => word === setting);
  }
  throw new Error(
    `reported the kind of finding "${findingKind}", which its options do not declare`,
  );
}

const RANK: Readonly<Record<Severity, number>> = { info: 0, warning: 1, error: 2 };

/** The lower of two severities. */
function lower(a: Severity, b: Severity): Severity {
  return RANK[a] <= RANK[b] ? a : b;
}

/** The problem as the config shows it: at its kind's severity, or undefined when that kind is off. */
function problemFinding(
  entry: ActiveRule,
  problem: {
    message: string;
    hint: string;
    location: Location;
    related: readonly RelatedLocation[];
    fixes: readonly Fix[];
    findingKind?: string;
    /** The rule's own choice to lower this finding (`ReportProblem.severity`). */
    severity?: "info" | "warning";
    about?: Location;
  },
): Finding | undefined {
  const setting = kindSetting(entry, problem.findingKind);
  if (setting === "off") return undefined;
  // The config's severity for this kind wins; then the rule's own choice for this finding; then
  // the rule's severity. A finding's own choice can only lower it, never raise it above the rule.
  return {
    kind: "problem",
    ruleId: entry.id,
    severity:
      setting ??
      (problem.severity === undefined ? entry.severity : lower(problem.severity, entry.severity)),
    message: problem.message,
    hint: problem.hint,
    location: problem.location,
    related: problem.related,
    fixes: problem.fixes,
    ...(problem.findingKind === undefined ? {} : { findingKind: problem.findingKind }),
    ...(problem.about === undefined ? {} : { about: problem.about }),
  };
}

function fileContext(
  entry: ActiveRule,
  sourceFile: ts.SourceFile,
  types: TypeQueries,
  findings: Finding[],
): FileContext {
  const { id, addons, options, facts } = entry;
  return {
    file: sourceFile.fileName,
    sourceFile,
    types,
    addons,
    options,
    facts,
    report(problem) {
      const finding = problemFinding(entry, {
        message: problem.message,
        hint: problem.hint,
        location: nodeLocation(problem.node),
        related: (problem.related ?? []).map((related) => ({
          location: nodeLocation(related.node),
          message: related.message,
        })),
        fixes: problem.fixes ?? [],
        ...(problem.findingKind === undefined ? {} : { findingKind: problem.findingKind }),
        ...(problem.severity === undefined ? {} : { severity: problem.severity }),
        ...(problem.about === undefined ? {} : { about: nodeLocation(problem.about) }),
      });
      if (finding !== undefined) findings.push(finding);
    },
    unknown({ message, hint, node }) {
      findings.push({
        kind: "unknown",
        ruleId: id,
        message,
        hint,
        location: nodeLocation(node),
        ...listedFlag(entry),
      });
    },
  };
}

function projectContext(entry: ActiveRule, findings: Finding[]): ProjectContext {
  const { id, options } = entry;
  return {
    options,
    report(problem) {
      const finding = problemFinding(entry, {
        message: problem.message,
        hint: problem.hint,
        location: problem.location,
        related: problem.related ?? [],
        fixes: problem.fixes ?? [],
        ...(problem.findingKind === undefined ? {} : { findingKind: problem.findingKind }),
        ...(problem.severity === undefined ? {} : { severity: problem.severity }),
      });
      if (finding !== undefined) findings.push(finding);
    },
    unknown({ message, hint, location }) {
      findings.push({ kind: "unknown", ruleId: id, message, hint, location, ...listedFlag(entry) });
    },
  };
}

/** `listed` on a rule's unknown findings when its meta asks for them to be listed. */
function listedFlag(entry: ActiveRule): { listed?: true } {
  return entry.rule.meta.listUnknowns === true ? { listed: true } : {};
}

function failureFinding(rule: ActiveRule, location: Location, error: unknown): Finding {
  return {
    kind: "failure",
    ruleId: rule.id,
    message: `rule ${rule.id} failed: ${describeFailure(error)}`,
    hint: FAILURE_HINT,
    location,
  };
}

/** A rule's summaries by file (sorted), as values. */
function summaryMap(sorted: readonly (readonly [string, CachedSummary])[]): Map<string, Json> {
  return new Map(sorted.map(([file, summary]) => [file, summaryValue(summary)] as const));
}

type RuleEntry = ActiveRule & { key: string };

/**
 * A project rule's findings as the files they are in see the rule: dropped where an override turns
 * the rule off, and at the severity that file has. The cache keeps the findings as the rule made
 * them, so an override changes this step only.
 */
function atTheirFiles(
  sets: RuleSets,
  entry: RuleEntry,
  found: readonly Finding[],
): readonly Finding[] {
  if (!sets.perFile) return found;
  return found.flatMap((finding): Finding[] => {
    if (finding.kind === "failure") return [finding];
    const setting = sets.settingAt(entry.id, finding.location.file);
    if (setting === "off") return [];
    if (finding.kind === "unknown") return [finding];
    // A severity the config gives this kind of finding holds in every file the rule is on in.
    const own = kindSetting(entry, finding.findingKind);
    if (own === "off") return [];
    return [{ ...finding, severity: own ?? setting }];
  });
}

/**
 * Where a project rule's failure is reported: the configured tsconfig when there is one, else the
 * first project's (a glob names no single file).
 */
function failureFile(config: Config, cwd: string, units: readonly ProjectUnit[]): string {
  const [first] = config.tsconfig;
  if (first !== undefined && !isGlob(first)) return path.resolve(cwd, first);
  return units[0]?.tsconfig ?? config.configDir;
}

/**
 * Runs one rule's file side on one file; `failed` when it threw (such a result is not cached). A
 * summary equal to one in `same` (by hash) is that object: several rules of a pack summarize the
 * same facts of a file, and one copy of the text (and of its parsed value) serves them all.
 */
function runOnFile(
  entry: RuleEntry,
  sourceFile: ts.SourceFile,
  types: TypeQueries,
  same: Map<string, CachedSummary>,
): { result: RuleResult; failed: boolean } {
  const findings: Finding[] = [];
  const ctx = fileContext(entry, sourceFile, types, findings);
  try {
    const value = runFileSide(entry.rule, ctx);
    if (value === undefined) return { result: { findings }, failed: false };
    const made = summaryOf(value);
    const summary = same.get(made.hash) ?? made;
    same.set(summary.hash, summary);
    return { result: { findings, summary }, failed: false };
  } catch (error) {
    const startOfFile: Location = { file: sourceFile.fileName, start: 0, end: 0 };
    findings.push(failureFinding(entry, startOfFile, error));
    return { result: { findings }, failed: true };
  }
}

/**
 * What the rules' file sides leave for their project sides: findings, summaries and what the
 * result's statistics need, and nothing of the programs, so a caller that needs no more of them
 * (a CLI check that tries no fix) can let them go before the project rules run.
 */
export type FilePhase = {
  readonly sets: RuleSets;
  readonly findings: Finding[];
  readonly summaries: ReadonlyMap<string, ReadonlyMap<string, CachedSummary>>;
  readonly directives: ReadonlyMap<string, readonly IgnoreDirective[]>;
  readonly fileCount: number;
  /** Test files checked by pattern, when the config's `exclude` replaces the default list. */
  readonly testsByPattern: ReadonlyMap<string, number> | undefined;
  /** Where a project rule's failure is reported (`failureFile`). */
  readonly tsconfigLocation: Location;
  /** The projects and their file counts, when there is more than one. */
  readonly projects: readonly { tsconfig: string; files: number }[] | undefined;
  /** What the run cannot check as a whole (`CheckResult.notes`). */
  readonly notes: CheckNotes | undefined;
  /** The own files of the projects without `strictNullChecks`. */
  readonly looseNulls: ReadonlySet<string>;
};

/**
 * The first of the two phases of running the rules (then `runProjectPhase`): every active rule
 * over the own files of `units`. With `rollout` on and the `configured` selection, this reads the
 * rollout file, and throws `RolloutError` when it cannot be used. A rule that throws becomes a
 * `failure`: the check did not finish, so CI must not pass.
 *
 * With a `cache`, a rule's results on a file whose dependency fingerprint is unchanged are taken
 * from it, and a project rule whose summaries are all unchanged reuses its last findings; the
 * cache is then updated with this run (cache.ts). Results that include a failure are not kept.
 */
export function runFilePhase(
  config: Config,
  cwd: string,
  units: readonly ProjectUnit[],
  selection: RuleSelection = { kind: "configured" },
  cache?: ResultCache,
  ignores = true,
  timing?: TimingRecorder,
): FilePhase {
  return drain(filePhaseRun(config, cwd, units, selection, cache, ignores, timing).steps);
}

/**
 * Where a check stands at a point where it can pause: after a rule that ran on a file, after a
 * file of the file phase, after a project rule of the project phase. `file` and `rule` name what
 * the step that just ended was doing, when it was one rule.
 */
export type CheckProgress = {
  readonly phase: "files" | "project";
  readonly done: number;
  readonly total: number;
  readonly file?: string;
  readonly rule?: string;
};

/**
 * A phase that runs one step at a time (`steps`, pausing after each file or project rule), so the
 * language server can answer between steps and stop early. `abandon` is for a run that is not
 * driven to its end: it keeps what the finished steps computed in the cache, so the next run
 * reuses it.
 */
export type PhaseRun<T> = {
  readonly steps: Generator<CheckProgress, T, undefined>;
  abandon(): void;
};

/** Runs `steps` to the end, with no pause: the synchronous check. */
export function drain<T>(steps: Generator<CheckProgress, T, undefined>): T {
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
}

/** `runFilePhase`, one file per step. */
export function filePhaseRun(
  config: Config,
  cwd: string,
  units: readonly ProjectUnit[],
  selection: RuleSelection = { kind: "configured" },
  cache?: ResultCache,
  ignores = true,
  timing?: TimingRecorder,
): PhaseRun<FilePhase> {
  const nextFiles = new Map<string, FileEntry>();
  return {
    steps: filePhaseSteps(config, cwd, units, selection, nextFiles, cache, ignores, timing),
    abandon: () => {
      if (cache === undefined || nextFiles.size === 0) return;
      // Each entry is keyed by its file's fingerprint, so it is reused only while that holds.
      for (const [file, entry] of nextFiles) cache.files.set(file, entry);
      cache.changed = true;
    },
  };
}

function* filePhaseSteps(
  config: Config,
  cwd: string,
  units: readonly ProjectUnit[],
  selection: RuleSelection,
  /** This run's cache entries, by file; read by `abandon` when the run stops early. */
  nextFiles: Map<string, FileEntry>,
  cache: ResultCache | undefined,
  ignores: boolean,
  timing: TimingRecorder | undefined,
): Generator<CheckProgress, FilePhase, undefined> {
  const total = units.reduce((sum, unit) => sum + unit.files.length, 0);
  const sets = ruleSets(config, selection);
  const rules = sets.anywhere;
  const testFiles = config.replacesDefaultExclude
    ? defaults.exclude.map((pattern) => ({ pattern, matches: picomatch(pattern, { dot: true }) }))
    : undefined;
  const testsByPattern = new Map<string, number>();
  const findings: Finding[] = [];
  const summaries = new Map<string, Map<string, CachedSummary>>();
  const directives = new Map<string, readonly IgnoreDirective[]>();
  let fileCount = 0;
  let done = 0;

  for (const entry of rules) {
    if (entry.rule.kind === "project") summaries.set(entry.id, new Map());
  }

  for (const unit of units) {
    fileCount += unit.files.length;
    for (const file of unit.files) {
      if (testFiles !== undefined) {
        const relative = path.relative(cwd, file).split(path.sep).join("/");
        const hit = testFiles.find((entry) => entry.matches(relative));
        if (hit !== undefined)
          testsByPattern.set(hit.pattern, (testsByPattern.get(hit.pattern) ?? 0) + 1);
      }
      const fingerprint =
        cache === undefined
          ? undefined
          : timing === undefined
            ? unit.fingerprint(file)
            : timed(timing, "fingerprint", () => unit.fingerprint(file));
      const before = cache?.files.get(file);
      const holding =
        fingerprint !== undefined &&
        before?.fingerprint === fingerprint &&
        readsHold(unit, before.reads)
          ? before
          : undefined;
      const reusable = holding?.rules;
      // Results of rules that did not run this time stay while the file's inputs are the same.
      const results = new Map(reusable ?? []);
      let syntax = results.get(SYNTAX_RULE_ID);
      if (syntax === undefined) {
        syntax = { findings: syntaxFinding(unit, file, cwd) };
        results.set(SYNTAX_RULE_ID, syntax);
        if (cache !== undefined) cache.changed = true;
      }
      findings.push(...syntax.findings);
      let imports = results.get(IMPORTS_RULE_ID);
      if (imports === undefined) {
        imports = { findings: importsFinding(unit, file, cwd) };
        results.set(IMPORTS_RULE_ID, imports);
        if (cache !== undefined) cache.changed = true;
      }
      findings.push(...imports.findings);
      if (ignores) {
        const read = fileDirectives(unit, file, results);
        if (read.stored && cache !== undefined) cache.changed = true;
        if (read.directives.length > 0) directives.set(file, read.directives);
      }
      // Per file: equal summaries of two files are rare, and a map for the whole run would hold
      // every hash. It starts with the file's summaries of the last run: a rule that runs again
      // (the file or one it depends on changed) and summarizes the same facts gets that object
      // back, with its parsed value, so the server keeps one copy of it and not one per edit
      //, and what the project rules computed for that object still applies.
      const sameSummaries = new Map<string, CachedSummary>();
      for (const kept of before?.rules.values() ?? []) {
        if (kept.summary !== undefined) sameSummaries.set(kept.summary.hash, kept.summary);
      }
      // One file's queries for all its rules (`ProjectUnit.typesFor`), made when one runs.
      let fileTypes: TypeQueries | undefined;
      for (const entry of sets.forFile(file)) {
        let result = reusable?.get(entry.key);
        if (result === undefined) {
          const sourceFile =
            timing === undefined
              ? boundSourceFile(unit, file)
              : timed(timing, "program", () => boundSourceFile(unit, file));
          if (sourceFile === undefined) continue;
          fileTypes ??= unit.typesFor(file);
          const types = fileTypes;
          const ran =
            timing === undefined
              ? runOnFile(entry, sourceFile, types, sameSummaries)
              : timing.fileSide(entry.id, entry.rule.kind, () =>
                  runOnFile(entry, sourceFile, timing.timedTypes(types), sameSummaries),
                );
          result = ran.result;
          if (cache !== undefined) cache.changed = true;
          if (ran.failed) results.delete(entry.key);
          else results.set(entry.key, result);
          // One rule per step: a file whose types are slow to check (seconds on a big project)
          // must not keep an edit waiting until every rule on it has run.
          yield { phase: "files", done, total, file, rule: entry.id };
        } else {
          timing?.reused(entry.id, entry.rule.kind);
        }
        findings.push(...result.findings);
        if (result.summary !== undefined) summaries.get(entry.id)?.set(file, result.summary);
      }
      if (fingerprint !== undefined) {
        nextFiles.set(file, {
          fingerprint,
          rules: results,
          reads: readsAfter(unit, file, holding, results),
        });
      }
      done += 1;
      yield { phase: "files", done, total };
    }
  }
  if (timing?.secondPass === true) secondPass(units, sets, timing);
  if (cache !== undefined) {
    // Only the files of this run: a deleted or excluded file's results go.
    if (cache.files.size !== nextFiles.size) cache.changed = true;
    cache.files.clear();
    for (const [file, entry] of nextFiles) cache.files.set(file, entry);
  }

  return {
    sets,
    findings,
    summaries,
    directives,
    fileCount,
    testsByPattern: testFiles === undefined ? undefined : testsByPattern,
    tsconfigLocation: { file: failureFile(config, cwd, units), start: 0, end: 0 },
    projects:
      units.length > 1
        ? units.map((unit) => ({ tsconfig: unit.tsconfig, files: unit.files.length }))
        : undefined,
    notes: notesOf(units, rules),
    looseNulls: looseNullFiles(units),
  };
}

/** The rules' project sides: each project rule's check over the summaries, and the result. */
export function runProjectPhase(
  config: Config,
  phase: FilePhase,
  started: number,
  keepSummaries?: Map<string, () => ReadonlyMap<string, Json>>,
  cache?: ResultCache,
  capped = true,
  timing?: TimingRecorder,
): CheckResult {
  return drain(projectPhaseSteps(config, phase, started, keepSummaries, cache, capped, timing));
}

/**
 * `runProjectPhase`, one project rule per step. A run stopped between steps leaves the cache as
 * it is: each project rule's entry is written whole, keyed by its inputs.
 */
export function* projectPhaseSteps(
  config: Config,
  phase: FilePhase,
  started: number,
  keepSummaries?: Map<string, () => ReadonlyMap<string, Json>>,
  cache?: ResultCache,
  capped = true,
  timing?: TimingRecorder,
): Generator<CheckProgress, CheckResult, undefined> {
  const { sets, findings, summaries, directives, fileCount, testsByPattern, tsconfigLocation } =
    phase;
  const rules = sets.anywhere;
  const total = rules.filter(
    (entry) => entry.rule.kind === "project" && summaries.has(entry.id),
  ).length;
  let done = 0;
  let previous: string | undefined;
  for (const entry of rules) {
    const fileSummaries = summaries.get(entry.id);
    if (entry.rule.kind !== "project" || fileSummaries === undefined) continue;
    if (done > 0)
      yield {
        phase: "project",
        done,
        total,
        ...(previous === undefined ? {} : { rule: previous }),
      };
    done += 1;
    previous = entry.id;
    // In file order, so a rule cannot depend on the order the files were visited.
    const sorted = [...fileSummaries].sort(([a], [b]) => compareText(a, b));
    const inputs = sha1(sorted.map(([file, summary]) => `${file}\u0000${summary.hash}`).join("\n"));
    const before = cache?.projects.get(entry.key);
    if (before?.inputs === inputs) {
      findings.push(...atTheirFiles(sets, entry, before.findings));
      // Built only if a hover asks: a CLI run whose summaries are unchanged never parses them.
      keepSummaries?.set(entry.id, () => (before.summaries ??= summaryMap(sorted)));
      continue;
    }
    const own: Finding[] = [];
    const rule = entry.rule;
    const runCheck = (): ReadonlyMap<string, Json> => {
      const asJson = summaryMap(sorted);
      keepSummaries?.set(entry.id, () => asJson);
      rule.check(asJson, projectContext(entry, own));
      return asJson;
    };
    try {
      const asJson = timing === undefined ? runCheck() : timing.projectSide(entry.id, runCheck);
      if (cache !== undefined) {
        cache.projects.set(entry.key, { inputs, findings: own, summaries: asJson });
        cache.changed = true;
      }
    } catch (error) {
      own.push(failureFinding(entry, tsconfigLocation, error));
      cache?.projects.delete(entry.key);
    }
    findings.push(...atTheirFiles(sets, entry, own));
  }

  const covered = applyIgnores(
    withLooseNullFixes(oneCauseOneMessage(findings, rules), rules, phase.looseNulls),
    directives,
    ignoreScope(config, rules),
  );
  covered.findings.sort(compareFindings);
  const { shown, hidden } = capped
    ? limitPerRuleAndFile(withUnknownsShown(covered.findings, config.unknowns))
    : { shown: withUnknownsShown(covered.findings, config.unknowns), hidden: [] };
  return {
    findings: shown,
    hidden,
    ignored: covered.ignored,
    ...(phase.notes === undefined ? {} : { notes: phase.notes }),
    stats: {
      files: fileCount,
      durationMs: Math.round(performance.now() - started),
      ...(testsByPattern === undefined
        ? {}
        : {
            testFiles: [...testsByPattern.values()].reduce((sum, count) => sum + count, 0),
            testFilesByPattern: Object.fromEntries(
              defaults.exclude.flatMap((pattern) => {
                const count = testsByPattern.get(pattern);
                return count === undefined ? [] : [[pattern, count] as const];
              }),
            ),
          }),
      ...(phase.projects === undefined ? {} : { projects: phase.projects }),
    },
  };
}

/**
 * One cause, one message (`RuleMeta.yieldsTo`): a finding is left out when a rule it yields to
 * reports a problem where the finding's `about` is. `about` itself is dropped from every finding.
 */
function oneCauseOneMessage(
  findings: readonly Finding[],
  rules: readonly { id: string; plugin: string; rule: Rule }[],
): Finding[] {
  const yields = new Map<string, readonly string[]>();
  for (const entry of rules) {
    const keys = entry.rule.meta.yieldsTo;
    if (keys !== undefined)
      yields.set(
        entry.id,
        keys.map((key) => `${entry.plugin}/${key}`),
      );
  }
  const at = (ruleId: string, location: Location): string =>
    JSON.stringify([ruleId, location.file, location.start]);
  const reported = new Set(
    findings.flatMap((finding) =>
      finding.kind === "problem" ? [at(finding.ruleId, finding.location)] : [],
    ),
  );
  return findings.flatMap((finding): Finding[] => {
    if (finding.kind !== "problem" || finding.about === undefined) return [finding];
    const { about, ...rest } = finding;
    const others = yields.get(finding.ruleId) ?? [];
    return others.some((other) => reported.has(at(other, about))) ? [] : [rest];
  });
}

/**
 * The per-rule, per-file cap of a plain check for findings that were collected uncapped,
 * so a baseline can be applied to all of them first and only the new ones are capped.
 */
export function limitFindings(sorted: readonly Finding[]): {
  findings: Finding[];
  hidden: HiddenFindings[];
} {
  const { shown, hidden } = limitPerRuleAndFile(sorted);
  return { findings: shown, hidden };
}

/**
 * Which findings the per-rule, per-file cap keeps first: failures, then errors, warnings, infos,
 * and places not checked last. Kept in position order, a file's first 20 "not checked" places of a
 * rule could hide an error of the same rule further down, and the check would pass.
 */
function capRank(finding: Finding): number {
  switch (finding.kind) {
    case "failure":
      return 0;
    case "problem":
      switch (finding.severity) {
        case "error":
          return 1;
        case "warning":
          return 2;
        case "info":
          return 3;
        default: {
          const unreachable: never = finding.severity;
          return unreachable;
        }
      }
    case "unknown":
      return 4;
    default: {
      const unreachable: never = finding;
      return unreachable;
    }
  }
}

function limitPerRuleAndFile(sorted: readonly Finding[]): {
  shown: Finding[];
  hidden: HiddenFindings[];
} {
  const seen = new Map<string, HiddenFindings & { listed: number }>();
  const kept = new Set<Finding>();
  // Decide in priority order (stable within a rank), then list what is kept in position order.
  const byRank = sorted
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => capRank(a.finding) - capRank(b.finding) || a.index - b.index);
  for (const { finding } of byRank) {
    const key = JSON.stringify([finding.location.file, finding.ruleId]);
    const entry = seen.get(key) ?? {
      file: finding.location.file,
      ruleId: finding.ruleId,
      count: 0,
      listed: 0,
    };
    seen.set(key, entry);
    if (entry.listed < MAX_FINDINGS_PER_RULE_PER_FILE) {
      entry.listed++;
      kept.add(finding);
    } else {
      entry.count++;
    }
  }
  const shown = sorted.filter((finding) => kept.has(finding));
  const hidden = [...seen.values()]
    .filter((entry) => entry.count > 0)
    .map(({ file, ruleId, count }) => ({ file, ruleId, count }))
    .sort((a, b) => compareText(a.file, b.file) || compareText(a.ruleId, b.ruleId));
  return { shown, hidden };
}

/**
 * Every rule's file side again on every file, after the check, its results dropped: the rules'
 * cost with the type checker warm (`RuleCost.warmMs`), for benchmarks. In file order, as the check
 * ran them, so a rule's memo of the last file is as cold as it was then.
 */
function secondPass(units: readonly ProjectUnit[], sets: RuleSets, timing: TimingRecorder): void {
  for (const unit of units) {
    for (const file of unit.files) {
      const sourceFile = unit.sourceFile(file);
      if (sourceFile === undefined) continue;
      const same = new Map<string, CachedSummary>();
      const types = timing.timedTypes(unit.typesFor(file));
      for (const entry of sets.forFile(file)) {
        timing.warmSide(entry.id, entry.rule.kind, () => {
          runOnFile(entry, sourceFile, types, same);
        });
      }
    }
  }
}

/** Whether everything a cached entry read of other files (declarations, files) is as it was then. */
function readsHold(unit: ProjectUnit, reads: ReadonlyMap<string, string>): boolean {
  for (const [read, print] of reads) {
    if (unit.readFingerprint(read) !== print) return false;
  }
  return true;
}

/** A print no read has: what could not be hashed never holds. */
const NO_PRINT = "";

/**
 * The reads of a file's entry after this run: those of the entry it kept (its rules that did not
 * run read them), with what the rules that ran on it in this program read, each with its hash
 * (`ProjectUnit.readsOf`). A declaration is read by its id, unless the file's results name the
 * file it is in: a rule that keeps another file's offsets (a location, a summary's span) changes
 * with any edit above them, so the whole file is read.
 */
function readsAfter(
  unit: ProjectUnit,
  file: string,
  kept: FileEntry | undefined,
  results: ReadonlyMap<string, RuleResult>,
): ReadonlyMap<string, string> {
  const reads = new Map(kept?.reads ?? []);
  let text: string | undefined;
  const mentioned = (readFile: string): boolean => {
    text ??= resultsText(results);
    return text.includes(readFile);
  };
  for (const read of unit.readsOf(file, mentioned)) {
    reads.set(read, unit.readFingerprint(read) ?? NO_PRINT);
  }
  return reads;
}

/** The findings and summaries of a file's results, as text: what the results could name. */
function resultsText(results: ReadonlyMap<string, RuleResult>): string {
  const parts: string[] = [];
  for (const result of results.values()) {
    parts.push(JSON.stringify(result.findings));
    if (result.summary !== undefined) parts.push(summaryText(result.summary));
  }
  return parts.join("\n");
}

/** The parsed file, its program bound first (rules need parents): building the program if it is lazy. */
function boundSourceFile(unit: ProjectUnit, file: string): ts.SourceFile | undefined {
  unit.bind();
  return unit.sourceFile(file);
}

/** `run`'s result, its wall time added to a phase of `timing`. */
function timed<T>(timing: TimingRecorder, phase: "program" | "fingerprint", run: () => T): T {
  const at = performance.now();
  try {
    return run();
  } finally {
    timing[phase](performance.now() - at);
  }
}

/** Runs a rule on one file; returns a project rule's summary. */
function runFileSide(rule: Rule, ctx: FileContext): Json | undefined {
  switch (rule.kind) {
    case "file":
      rule.check(ctx);
      return undefined;
    case "project":
      return rule.summarize(ctx);
    default: {
      const unreachable: never = rule;
      return unreachable;
    }
  }
}

/** Ids of the rules that `selection` runs somewhere (not off everywhere; the rollout applied for `configured`). */
export function activeRuleIds(config: Config, selection: RuleSelection): ReadonlySet<string> {
  return new Set(ruleSets(config, selection).anywhere.map((entry) => entry.id));
}

/**
 * Whether a rule that the config does not switch off reads JSDoc (`RuleMeta.needsJsDoc`), so files
 * must be parsed with theirs. The rollout file is not read: a narrowed run parses the same way.
 */
export function needsJsDoc(config: Config): boolean {
  return config.plugins.some((plugin) =>
    Object.entries(plugin.rules).some(
      ([key, rule]) =>
        rule.meta.needsJsDoc === true && ruleIsOn(config, plugin.name, key, rule.meta),
    ),
  );
}

/** Ids of the active project rules: their findings need the whole project, so a fast pass cannot refresh them. */
export function projectRuleIds(config: Config): ReadonlySet<string> {
  return new Set(
    // The rules the configuration turns on (rollout included), as a full pass runs them.
    ruleSets(config, { kind: "configured" })
      .anywhere.filter((entry) => entry.rule.kind === "project")
      .map((entry) => entry.id),
  );
}

/**
 * Why a project rule that is on cannot report in this project (`ProjectRule.silentReason`), by
 * rule id, from the summaries of a full check; rules with no reason are left out.
 */
export function silentReasons(
  config: Config,
  selection: RuleSelection,
  summaries: ReadonlyMap<string, () => ReadonlyMap<string, Json>>,
): ReadonlyMap<string, string> {
  const reasons = new Map<string, string>();
  for (const entry of ruleSets(config, selection).anywhere) {
    if (entry.rule.kind !== "project") continue;
    const own = summaries.get(entry.id);
    if (own === undefined) continue;
    const reason = entry.rule.silentReason?.(own(), { options: entry.options });
    if (reason !== undefined) reasons.set(entry.id, reason);
  }
  return reasons;
}

/**
 * What a fast pass may take from the cache instead of running the rules: the results the cache
 * holds for each of `files` whose dependency fingerprint and reads are as they were then (the
 * same test as a full pass's). Asking for a fingerprint computes those of the whole program
 * once, so a caller names only the files it expects to be unchanged (an editor's file just opened).
 */
export type FastReuse = { readonly cache: ResultCache; readonly files: ReadonlySet<string> };

/** The cached results of `file` when its fingerprint and reads hold, else undefined. */
function holdingResults(
  unit: ProjectUnit,
  file: string,
  cache: ResultCache,
): Map<string, RuleResult> | undefined {
  const entry = cache.files.get(file);
  if (entry === undefined) return undefined;
  const fingerprint = unit.fingerprint(file);
  if (fingerprint === undefined || entry.fingerprint !== fingerprint) return undefined;
  if (!readsHold(unit, entry.reads)) return undefined;
  // A copy: the fast pass never writes the cache (what it computes is for these files only).
  return new Map(entry.rules);
}

/**
 * Runs the file rules (not the project rules) over the own files of `units` that are in `files`
 * and returns findings for those files only. A project rule needs every file's summary, so it
 * does not run here. A rule that throws becomes a `failure`, as in `runFilePhase`. With `reuse`, a
 * rule whose result the cache holds for a reusable file is not run (`FastReuse`): an unchanged
 * file costs no type checking.
 */
export function runFileRules(
  config: Config,
  cwd: string,
  units: readonly ProjectUnit[],
  files: ReadonlySet<string>,
  started: number,
  capped = true,
  ignores = true,
  reuse?: FastReuse,
): CheckResult {
  // The same rules a full pass runs (rollout included), so the fast pass never shows a rule
  // the developer has not turned on.
  const sets = ruleSets(config, { kind: "configured" });
  const rules = sets.anywhere.filter((entry) => entry.rule.kind === "file");
  const findings: Finding[] = [];
  const directives = new Map<string, readonly IgnoreDirective[]>();
  let fileCount = 0;
  for (const unit of units) {
    for (const file of unit.files) {
      if (!files.has(file)) continue;
      const results =
        (reuse?.files.has(file) === true ? holdingResults(unit, file, reuse.cache) : undefined) ??
        new Map<string, RuleResult>();
      fileCount++;
      const syntax = results.get(SYNTAX_RULE_ID)?.findings ?? syntaxFinding(unit, file, cwd);
      const imports = results.get(IMPORTS_RULE_ID)?.findings ?? importsFinding(unit, file, cwd);
      findings.push(...syntax, ...imports);
      if (ignores) {
        const read = fileDirectives(unit, file, results).directives;
        if (read.length > 0) directives.set(file, read);
      }
      const startOfFile: Location = { file, start: 0, end: 0 };
      let types: TypeQueries | undefined;
      for (const entry of sets.forFile(file)) {
        if (entry.rule.kind !== "file") continue;
        const result = results.get(entry.key);
        if (result !== undefined) {
          findings.push(...result.findings);
          continue;
        }
        // Rules need parents: bind before the first one runs. A file whose results all come from
        // the cache asks nothing of the program (a recorded one is then never built).
        const sourceFile = boundSourceFile(unit, file);
        if (sourceFile === undefined) break;
        types ??= unit.typesFor(file);
        try {
          runFileSide(entry.rule, fileContext(entry, sourceFile, types, findings));
        } catch (error) {
          findings.push(failureFinding(entry, startOfFile, error));
        }
      }
    }
  }
  // Only the file rules ran, so an ignore of a project rule is not judged here.
  const covered = applyIgnores(
    withLooseNullFixes(oneCauseOneMessage(findings, rules), rules, looseNullFiles(units)),
    directives,
    ignoreScope(config, rules),
  );
  covered.findings.sort(compareFindings);
  const { shown, hidden } = capped
    ? limitPerRuleAndFile(withUnknownsShown(covered.findings, config.unknowns))
    : { shown: withUnknownsShown(covered.findings, config.unknowns), hidden: [] };
  return {
    findings: shown,
    hidden,
    ignored: covered.ignored,
    stats: { files: fileCount, durationMs: Math.round(performance.now() - started) },
  };
}

/**
 * The unknown findings marked with how the config's `unknowns` shows them. They stay in the
 * result whatever the setting, so the summary still counts them (never silent).
 */
function withUnknownsShown(findings: Finding[], unknowns: UnknownsSetting): Finding[] {
  if (unknowns === "info") return findings;
  return findings.map((finding) =>
    finding.kind === "unknown" ? { ...finding, shown: unknowns } : finding,
  );
}

/**
 * The markdown behind `stateward explain`, or undefined for an unknown rule id. A lazy rule's
 * text is in its module, which is loaded for it.
 */
export async function explain(config: Config, ruleId: string): Promise<string | undefined> {
  if (ruleId === SYNTAX_RULE_ID) return SYNTAX_EXPLAIN;
  if (ruleId === IMPORTS_RULE_ID) return IMPORTS_EXPLAIN;
  if (ruleId === IGNORE_RULE_ID) return IGNORE_EXPLAIN;
  for (const plugin of config.plugins) {
    for (const [key, rule] of Object.entries(plugin.rules)) {
      if (`${plugin.name}/${key}` === ruleId) return (await loadRule(ruleId, rule)).meta.explain;
    }
  }
  return undefined;
}

const SYNTAX_EXPLAIN = `# stateward/syntax

A file has a syntax error, so what stateward reports for it may be missing or wrong.

TypeScript could not parse the file cleanly. The rules still ran on it, but on broken code they can
miss problems or report ones that are not there, so stateward tells you rather than passing the file
as clean.

To fix it: correct the syntax error the finding names (its fix line has TypeScript's message and the
position), then run \`stateward check\` again. It cannot be turned off.
`;

const IMPORTS_EXPLAIN = `# stateward/imports

A file imports a package or file that stateward cannot find, or one with no types, so what it
reports for that file may be missing or wrong.

## Why

Without the module, TypeScript does not know what it exports, so everything that comes from it has
no real type. A rule can then decide on something that is not true (a key read as \`string\`, a
context that looks unprovided), or miss a problem. stateward says so once per file instead.

## When to use it

It is always on. It shows when an \`import\`, \`export … from\` or \`import x = require()\` leads to no
file and no type declaration: a package that is not installed, a workspace package that is not
built, a wrong path. A JavaScript package with no types says \`has no types\`. When more than one
file in five has one, the check says so first: usually the app's packages are not installed.

## What it catches

The first such import in each file, with a count of the others in that file. An import with no
bindings (\`import "./a.css"\`) and modules covered by a \`declare module\` are fine.

## What it does not catch

A module that is found but whose types are wrong, and values typed \`any\` on purpose. Type errors
in general are for \`tsc\`.

## Turn it on or off

It cannot be turned off; fix the import instead. Install the app's packages (\`npm install\`,
\`yarn\`, \`pnpm install\`), build its workspace packages, or correct the path, and for a package
with no types install its \`@types/…\` package or declare the module. Then run \`stateward check\`
again.
`;
