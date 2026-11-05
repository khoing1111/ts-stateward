import type ts from "typescript";
import { createBackend, toTypeScriptPath } from "./backend/typescript6.js";
import type { ProjectUnit } from "./backend/typescript6.js";
import { emptyCache } from "./cache.js";
import type { ResultCache } from "./cache.js";
import type { TimingRecorder } from "./timing.js";
import { reviewFixes, verifyFixSet } from "./fixes.js";
import {
  drain,
  filePhaseRun,
  needsJsDoc,
  projectPhaseSteps,
  projectRuleIds,
  runFileRules,
  silentReasons,
} from "./engine.js";
import type { CheckProgress, FilePhase, PhaseRun } from "./engine.js";
import type {
  CheckResult,
  Config,
  EditorAction,
  EditorHint,
  Finding,
  FixForm,
  FixReview,
  FixSetReview,
  Json,
  LibraryUse,
  Location,
  RuleSelection,
  TokenType,
  TypeQueries,
} from "./types.js";

export type CheckInput = {
  config: Config;
  cwd: string;
  /** Unsaved editor text, by absolute path. */
  overlays?: ReadonlyMap<string, string>;
  /** Which rules to run; the config's own (narrowed by the rollout file) when left out. */
  rules?: RuleSelection;
  /**
   * Results of earlier runs to reuse, updated by this run (cache.ts); the CLI reads and writes it
   * on disk. Without it nothing is reused.
   */
  cache?: ResultCache;
  /**
   * List every finding instead of capping each rule per file: for a caller that applies a
   * baseline first and caps what is left with `limitFindings`.
   */
  uncapped?: true;
  /** `false`: leave the ignore comments in the code out of account (`check --no-ignores`). */
  ignores?: false;
};

export type SliceOptions = {
  /** Asked between slices; true stops the run. */
  cancelled: () => boolean;
  /** Told where the run stands, between slices. */
  progress?: (at: CheckProgress) => void;
  /** The longest the run works before it lets the event loop run. */
  sliceMs?: number;
};

/**
 * The longest stretch the run kept the event loop waiting, and what it was doing (`at` is the
 * progress that ended it; undefined for building the programs or the last step).
 */
export type LongestStep = { readonly ms: number; readonly at: CheckProgress | undefined };

/** How a check in slices ended. */
export type SlicedCheck =
  | { kind: "done"; result: CheckResult; longest: LongestStep }
  | { kind: "cancelled"; longest: LongestStep };

/** The default slice: short against the editor's 200 ms budget, long against a pause's cost. */
export const SLICE_MS = 20;

function fileTotal(units: readonly ProjectUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.files.length, 0);
}

/** Lets every pending event (a message, a timer) run before the check goes on. */
function pause(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** One config's checker: it keeps its programs between runs, so a later run only redoes what changed. */
export type Checker = {
  /** Reuses the previous run's programs as `oldProgram`. */
  check(overlays?: ReadonlyMap<string, string>): CheckResult;
  /**
   * `check`, in slices of about `sliceMs` that leave the event loop free in between (the
   * language server answers edits and requests meanwhile). Before each slice `cancelled` is asked:
   * a run it stops answers `cancelled`, keeps nothing as the last check, and leaves what the
   * finished files computed in the cache, so the next run reuses it. Same findings, same order,
   * as `check`. Building the programs is one slice of its own.
   */
  checkInSlices(overlays: ReadonlyMap<string, string>, options: SliceOptions): Promise<SlicedCheck>;
  /**
   * The fast pass: runs only the file rules, only on `files` (own files; others are ignored), on
   * programs that reuse the previous ones. Findings are for those files only; project rules do not
   * run, so their findings are the last `check`'s.
   */
  checkFiles(files: readonly string[], overlays?: ReadonlyMap<string, string>): CheckResult;
  /** Ids of the active project rules, whose findings only `check` produces. */
  readonly projectRuleIds: ReadonlySet<string>;
  /**
   * Why a project rule that is on has nothing to report in this project (`ProjectRule.silentReason`),
   * by rule id, from the last full check. Empty before a check.
   */
  silentReasons(): ReadonlyMap<string, string>;
  /** Markdown from every plugin that contributes a hover at `offset` in `file`. Uses the programs and the project summaries of the last check; builds the programs if none ran yet (the summaries then stay empty). */
  hover(file: string, offset: number): readonly string[];
  tokens(file: string): readonly { location: Location; type: TokenType }[];
  /**
   * The refactorings plugins offer for the code between offsets `start` and `end` of `file`, from
   * the last check's summaries, each tried like a fix (`reviewFixes`): only those that compile.
   */
  refactors(file: string, start: number, end: number): readonly EditorAction[];
  /**
   * Inline hints from every plugin for `file`, in offset order, from the last check's summaries
   * (nothing recomputed). Only the kinds `enabled` accepts.
   */
  inlayHints(file: string, enabled?: (kind: string) => boolean): readonly EditorHint[];
  /**
   * What every plugin knows about the packages the project calls (`EditorContributions.libraryFacts`),
   * from the last full check: `stateward deps`. Empty before a check.
   */
  libraryFacts(): readonly LibraryUse[];
  /**
   * Tries each fix of `findings` on a copy of the code of the last run (fixes.ts) and returns the
   * findings in the same order, each with only the fixes that compile. Verdicts are kept in the
   * cache, so asking again for an unchanged file costs nothing.
   */
  reviewFixes(findings: readonly Finding[]): readonly FixReview[];
  /**
   * Verifies fixes that are applied together (one form each, as `reviewFixes` offered it): `kept`
   * says which compile together, `edits` is what to apply, with every import the set leaves
   * unused removed once (fixes.ts). For `check --fix` and the editor's fix-all.
   */
  verifyFixSet(forms: readonly FixForm[]): FixSetReview;
  /**
   * The text of `file` the last check read, without a byte order mark; undefined when no program
   * of that check has the file. `check --fix` edits this text, never a newer one on disk.
   */
  analysedText(file: string): string | undefined;
};

type Known = { sourceFile: ts.SourceFile; types: TypeQueries };

/** The own files by name, for editor requests; binds each program, as plugins walk the nodes. */
function index(units: readonly ProjectUnit[]): ReadonlyMap<string, Known> {
  for (const unit of units) unit.bind();
  return new Map(
    units.flatMap((unit) =>
      unit.files.flatMap((file) => {
        const sourceFile = unit.sourceFile(file);
        return sourceFile === undefined ? [] : [[file, { sourceFile, types: unit.types }] as const];
      }),
    ),
  );
}

/**
 * Editor requests are answered from the programs of the last check. A plugin that throws
 * propagates the error: the language server is the boundary that logs it.
 */
export function createChecker({
  config,
  cwd,
  rules = { kind: "configured" },
  cache = emptyCache(),
  uncapped,
  ignores,
  timing,
  retainPrograms,
}: {
  config: Config;
  cwd: string;
  rules?: RuleSelection;
  /**
   * What a full check reuses from the previous ones (cache.ts): a new, empty cache by default,
   * kept for the checker's life; `false` for a run that reuses nothing and computes no fingerprints.
   */
  cache?: ResultCache | false;
  /** As `CheckInput.uncapped`. */
  uncapped?: true;
  /** As `CheckInput.ignores`. */
  ignores?: false;
  /**
   * Records where each full `check` spends its time, rule by rule (`check --timing`): for
   * stateward's own tools. Left out, nothing is measured.
   */
  timing?: TimingRecorder;
  /**
   * `false`: let the programs go once every rule has read the files, before the project rules
   * run, so their memory can serve those. For a one-off check that asks nothing of the
   * programs afterwards: a later request (a fix tried, a hover) builds them again.
   */
  retainPrograms?: false;
}): Checker {
  const backend = createBackend({
    config,
    cwd,
    cache: cache === false ? undefined : cache,
    jsDoc: needsJsDoc(config),
  });
  /** The units of the last run; indexed (and bound) on the first editor request. */
  let lastUnits: readonly ProjectUnit[] | undefined;
  let known: ReadonlyMap<string, Known> | undefined;
  /** The project rules' summaries of the last full check. */
  let summaries: ReadonlyMap<string, () => ReadonlyMap<string, Json>> = new Map();
  /** Where verdicts are kept when the checker keeps no cache. */
  const localVerdicts = emptyCache();

  const lookup = (file: string): Known | undefined => {
    known ??= index(lastUnits ?? backend.open(new Map()));
    return known.get(toTypeScriptPath(file));
  };

  /** One full check, one step per file or project rule (`PhaseRun`). */
  const fullRun = (overlays: ReadonlyMap<string, string>): PhaseRun<CheckResult> => {
    let filePhase: PhaseRun<FilePhase> | undefined;
    function* steps(): Generator<CheckProgress, CheckResult, undefined> {
      const started = performance.now();
      timing?.start();
      known = undefined;
      const opened = (): readonly ProjectUnit[] => {
        const units = backend.open(overlays);
        timing?.program(performance.now() - started);
        return units;
      };
      const startFilePhase = (units: readonly ProjectUnit[]): PhaseRun<FilePhase> => {
        filePhase = filePhaseRun(
          config,
          cwd,
          units,
          rules,
          cache === false ? undefined : cache,
          ignores !== false,
          timing,
        );
        return filePhase;
      };
      let phase: FilePhase;
      if (retainPrograms === false) {
        // No variable holds the units here: once the file phase returns they can be collected.
        lastUnits = undefined;
        phase = yield* startFilePhase(opened()).steps;
        backend.release();
      } else {
        lastUnits = opened();
        // Building the programs is a step of its own, so its cost is told apart from a rule's.
        yield { phase: "files", done: 0, total: fileTotal(lastUnits) };
        phase = yield* startFilePhase(lastUnits).steps;
      }
      filePhase = undefined;
      const kept = new Map<string, () => ReadonlyMap<string, Json>>();
      const result = yield* projectPhaseSteps(
        config,
        phase,
        started,
        kept,
        cache === false ? undefined : cache,
        uncapped === undefined,
        timing,
      );
      summaries = kept;
      return result;
    }
    return { steps: steps(), abandon: () => filePhase?.abandon() };
  };

  return {
    check(overlays = new Map()) {
      return drain(fullRun(overlays).steps);
    },
    async checkInSlices(overlays, { cancelled, progress, sliceMs = SLICE_MS }) {
      let longest: LongestStep = { ms: 0, at: undefined };
      if (cancelled()) return { kind: "cancelled", longest };
      const run = fullRun(overlays);
      let sliceStarted = performance.now();
      for (;;) {
        const stepStarted = performance.now();
        const next = run.steps.next();
        const stepMs = performance.now() - stepStarted;
        if (stepMs > longest.ms) {
          longest = { ms: stepMs, at: next.done === true ? undefined : next.value };
        }
        if (next.done === true) return { kind: "done", result: next.value, longest };
        if (performance.now() - sliceStarted < sliceMs) continue;
        progress?.(next.value);
        await pause();
        if (cancelled()) {
          run.abandon();
          return { kind: "cancelled", longest };
        }
        sliceStarted = performance.now();
      }
    },
    checkFiles(files, overlays = new Map()) {
      const started = performance.now();
      const units = backend.reopen(overlays);
      lastUnits = units;
      known = undefined;
      return runFileRules(
        config,
        cwd,
        units,
        new Set(files.map(toTypeScriptPath)),
        started,
        uncapped === undefined,
        ignores !== false,
      );
    },
    // Read on demand: it consults the rollout file, which a run that ignores rollout
    // (`plan`, `check --rule`) must not touch.
    get projectRuleIds() {
      return projectRuleIds(config);
    },
    silentReasons() {
      return silentReasons(config, rules, summaries);
    },
    hover(file, offset) {
      const found = lookup(file);
      if (found === undefined) return [];
      return config.plugins.flatMap((plugin) => {
        const markdown = plugin.editor?.hover?.({
          file,
          offset,
          ...found,
          projectSummaries: (ruleId) => summaries.get(ruleId)?.(),
        });
        return markdown === undefined ? [] : [markdown];
      });
    },
    libraryFacts() {
      return config.plugins.flatMap(
        (plugin) =>
          plugin.editor?.libraryFacts?.({
            projectSummaries: (ruleId) => summaries.get(ruleId)?.(),
          }) ?? [],
      );
    },
    reviewFixes(findings) {
      const units = (lastUnits ??= backend.open(new Map()));
      return reviewFixes(findings, units, cache === false ? localVerdicts : cache);
    },
    verifyFixSet(forms) {
      return verifyFixSet(forms, (lastUnits ??= backend.open(new Map())));
    },
    analysedText(file) {
      const name = toTypeScriptPath(file);
      for (const unit of lastUnits ?? []) {
        const sourceFile = unit.sourceFile(name);
        if (sourceFile !== undefined) return sourceFile.text;
      }
      return undefined;
    },
    refactors(file, start, end) {
      const found = lookup(file);
      if (found === undefined) return [];
      const offered = config.plugins.flatMap(
        (plugin) =>
          plugin.editor?.codeActions?.({
            file,
            start,
            end,
            ...found,
            projectSummaries: (ruleId) => summaries.get(ruleId)?.(),
          }) ?? [],
      );
      // A finding only to reuse the fix review: it is never reported.
      const findings: Finding[] = offered.map((action) => ({
        kind: "problem",
        ruleId: "stateward/refactor",
        severity: "info",
        message: action.title,
        hint: action.title,
        location: { file, start, end },
        related: [],
        fixes: [{ title: action.title, edits: action.edits }],
      }));
      const units = (lastUnits ??= backend.open(new Map()));
      const reviews = reviewFixes(findings, units, cache === false ? localVerdicts : cache);
      return offered.filter((_, i) => {
        const reviewed = reviews[i]?.finding;
        return reviewed?.kind === "problem" && reviewed.fixes.length > 0;
      });
    },
    inlayHints(file, enabled = () => true) {
      const found = lookup(file);
      if (found === undefined) return [];
      return config.plugins
        .flatMap(
          (plugin) =>
            plugin.editor?.inlayHints?.({
              file,
              ...found,
              projectSummaries: (ruleId) => summaries.get(ruleId)?.(),
            }) ?? [],
        )
        .filter((hint) => enabled(hint.kind))
        .sort(
          (a, b) => a.offset - b.offset || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
        );
    },
    tokens(file) {
      const found = lookup(file);
      if (found === undefined) return [];
      return config.plugins.flatMap((plugin) => plugin.editor?.tokens?.({ file, ...found }) ?? []);
    },
  };
}

/** One run with a fresh checker. */
export function check({
  config,
  cwd,
  overlays,
  rules,
  cache,
  uncapped,
  ignores,
}: CheckInput): CheckResult {
  return createChecker({
    config,
    cwd,
    cache: cache ?? false,
    ...(uncapped === undefined ? {} : { uncapped }),
    ...(ignores === undefined ? {} : { ignores }),
    ...(rules === undefined ? {} : { rules }),
  }).check(overlays);
}
