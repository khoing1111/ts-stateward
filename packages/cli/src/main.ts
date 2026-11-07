import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  BASELINE_FILE,
  BaselineError,
  CONFIG_FILE_PATTERN,
  DEFAULT_CONFIG_FILE,
  DEFAULT_PRESET,
  NothingToCheckError,
  OUTDATED_BASELINE,
  ROLLOUT_FILE,
  RolloutError,
  TsconfigError,
  TypeScriptLibMissingError,
  activeRuleIds,
  advance,
  applyBaseline,
  baselineOf,
  buildPlan,
  check,
  cleanPackageCache,
  cleanResultsCache,
  createChecker,
  createTimingRecorder,
  packageCacheStats,
  describeNotChecked,
  describeTurnOn,
  explain,
  proveGuarantees,
  findConfigFile,
  findConfigUpward,
  groupIds,
  isOutdated,
  loadConfig,
  loadConfigFile,
  displayPath,
  mergeBaseline,
  openDiskCache,
  readBaseline,
  readRollout,
  resultsCacheLimit,
  resultsCacheStats,
  ruleIds,
  ruleIsOn,
  sizeOf,
  writeBaseline,
  writeRollout,
} from "@stateward/core/internal";
import type {
  Baseline,
  BaselineView,
  Config,
  Plugin,
  Finding,
  FixForm,
  FixReview,
  RunTiming,
  FixSetReview,
  ParseResult,
  RuleSelection,
  CheckResult,
} from "@stateward/core/internal";
import { parseArgs } from "./args.js";
import { commandHelp, overviewHelp, usageAfterError } from "./help.js";
import type { Command } from "./args.js";
import { buildCoverage, formatCoverageJson, formatCoveragePretty } from "./coverage.js";
import {
  buildDeps,
  formatCacheClean,
  formatCacheStats,
  formatDepsJson,
  formatDepsPretty,
} from "./deps.js";
import {
  formatJson,
  formatPretty,
  isWarning,
  notesLines,
  plural,
  positionAt,
  quietUnknownsLine,
  summaryLine,
} from "./format.js";
import {
  formatGuaranteesJson,
  formatGuaranteesPretty,
  guaranteesExitCode,
  type Locate,
} from "./guarantees.js";
import { formatGitHub } from "./github.js";
import {
  WORKFLOW_FILE,
  isYarnClassic,
  nodeVersionOf,
  renderWorkflow,
  workflowRunningStateward,
} from "./ci.js";
import {
  GitError,
  changedFiles,
  defaultBranch,
  gitRoot,
  scopeResult,
  stagedTextOf,
} from "./changed.js";
import type { Changed } from "./changed.js";
import {
  changedSincePlan,
  introducedBy,
  planFixes,
  unifiedDiff,
  withoutBom,
  writeFixes,
} from "./fix.js";
import type { FixPlan } from "./fix.js";
import { writeHook } from "./hook.js";
import { formatTiming } from "./timing.js";
import { describeScriptRun, projectScripts } from "./scripts.js";
import { buildPlanReport, formatPlanJson, formatPlanPretty } from "./plan.js";
import {
  PackageJsonError,
  detectLockfile,
  detectPackageManager,
  detectPacks,
  REACT_ROUTER_ADDON,
  installCommand,
  projectHasCode,
  renderConfig,
  usesReactRouter,
} from "./init.js";
import { acceptDefaults, askInit, openTerminal } from "./init-prompt.js";
import type { InitChoices, Terminal } from "./init-prompt.js";

export type ExitCode = 0 | 1 | 2;

export type CliEnv = {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
  /** Set when stdin and stdout are both terminals: only then does `init` ask questions. */
  terminal?: Terminal | undefined;
  /**
   * The folder where `check` keeps the results of earlier runs for a project (disk-cache.ts in
   * core), or undefined for none. Left out, nothing is read or written (a test or an embedding program).
   */
  cacheDir?: ((project: string) => string | undefined) | undefined;
  /** What `--version` prints; left out, it says the version is unknown. */
  version?: string | undefined;
  /** The process's environment variables (`GITHUB_ACTIONS`, `GITHUB_WORKSPACE`); left out, none are set. */
  environment?: Readonly<Record<string, string | undefined>> | undefined;
  /**
   * Called by `check --fix` after the check and before it writes: a test changes a file here to
   * stand for a save that lands while stateward is checking. Left out, nothing is called.
   */
  beforeFixWrite?: (() => void) | undefined;
  /**
   * Runs the same command again in another process with a `limitMb` heap (the config's
   * `maxMemory`) and returns its exit code, or undefined when this process already has the limit
   * or another setting wins (bin.ts). Left out, the config's `maxMemory` is not acted on.
   */
  restartWithMemory?: ((limitMb: number) => Promise<ExitCode | undefined>) | undefined;
};

/** More problems than this in a project at `init`, and its config turns rollout on. */
const ROLLOUT_THRESHOLD = 20;

function readTextOrUndefined(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * `unknown rule "<id>"`, with the rule ids that end in what was typed ("table-type-too-loose" finds
 * "records/table-type-too-loose"), then every known id.
 */
export function unknownRuleMessage(ruleId: string, known: readonly string[]): string {
  const close = known.filter(
    (id) => id.endsWith(`/${ruleId}`) || (ruleId.length >= 3 && id.includes(ruleId)),
  );
  const guess = close.length === 0 ? "; " : `; did you mean ${close.join(" or ")}? `;
  return `unknown rule "${ruleId}"${guess}known rules: ${known.join(", ") || "none"}`;
}

/** `check --rule <id>`: that rule alone, which must exist and must not be switched off. */
function selectRule(config: Config, ruleId: string | undefined): ParseResult<RuleSelection> {
  if (ruleId === undefined) return { ok: true, value: { kind: "configured" } };
  if (!ruleIds(config.plugins).includes(ruleId)) {
    return {
      ok: false,
      errors: [unknownRuleMessage(ruleId, [...ruleIds(config.plugins)].sort())],
    };
  }
  for (const plugin of config.plugins) {
    for (const [key, rule] of Object.entries(plugin.rules)) {
      if (`${plugin.name}/${key}` === ruleId && !ruleIsOn(config, plugin.name, key, rule.meta)) {
        return {
          ok: false,
          errors: [
            `${ruleId} is switched off in your config, so there is nothing to check; set it under \`rules\` (or turn its add-on on), then run again`,
          ],
        };
      }
    }
  }
  return { ok: true, value: { kind: "only", ruleId } };
}

/** `check --group <plugin>/<group>`: the rules of that group that are not switched off. */
function selectGroup(config: Config, groupId: string): ParseResult<RuleSelection> {
  const known = groupIds(config.plugins);
  if (!known.includes(groupId)) {
    return {
      ok: false,
      errors: [
        `unknown group "${groupId}"; known groups: ${[...known].sort().join(", ") || "none"}`,
      ],
    };
  }
  const anyOn = config.plugins.some((plugin) =>
    Object.entries(plugin.rules).some(
      ([key, rule]) =>
        `${plugin.name}/${rule.meta.group}` === groupId &&
        ruleIsOn(config, plugin.name, key, rule.meta),
    ),
  );
  if (!anyOn) {
    return {
      ok: false,
      errors: [
        `every rule of ${groupId} is switched off in your config, so there is nothing to check; set the group under \`groups\` (or a rule under \`rules\`), then run again`,
      ],
    };
  }
  return { ok: true, value: { kind: "group", groupId } };
}

/** The rules a `check` runs: one rule, one group, or the config's own. */
function selectRules(
  config: Config,
  command: Extract<Command, { kind: "check" }>,
): ParseResult<RuleSelection> {
  if (command.group !== undefined) return selectGroup(config, command.group);
  return selectRule(config, command.rule);
}

/**
 * What to do first with rollout on and no rule on yet: `init` and `check` say the same line, so
 * the quick start's next command is always named (user trial 1.0.2).
 */
export const NEXT_FIRST_RULE = "next: run `npx stateward next` to turn on the first rule";

function rolloutLine(on: number): string {
  return on === 0
    ? `rollout: no rule is on yet, so nothing was checked\n${NEXT_FIRST_RULE}\n\n`
    : `rollout: ${plural(on, "rule")} on (stateward.rollout.json); \`stateward plan\` shows the rest\n\n`;
}

/** The baseline laid over an uncapped run of `selection`; the text it fingerprints is read from disk. */
function layBaseline(
  config: Config,
  baseline: Baseline | undefined,
  result: CheckResult,
  selection: RuleSelection,
): BaselineView {
  return applyBaseline(baseline, result, {
    configDir: config.configDir,
    readText: readTextOrUndefined,
    ran: activeRuleIds(config, selection),
  });
}

type Analysis = {
  /** What `check` shows: the fresh findings, in the chosen files. */
  result: CheckResult;
  view: BaselineView;
  baseline: Baseline | undefined;
  accepted: { baselined: number; fixed: number; outdated: boolean } | undefined;
  summaryScope: { files: number; elsewhere: number } | undefined;
  /** Test and story files that were checked because the config's `exclude` replaces the default list. */
  testFiles: number;
  /** `testFiles` by the default `exclude` pattern each matches. */
  testFilesByPattern: Readonly<Record<string, number>>;
  /**
   * With `--fix`, or `--format json --verify-fixes`: the fixes of every finding shown (fresh,
   * baselined and ignored) after they were tried, by finding. Other checks try none, to stay fast.
   */
  reviews: ReadonlyMap<Finding, FixReview> | undefined;
  /** With `--timing`: the check's costs, rule by rule, and the time spent trying fixes after it. */
  timing: { run: RunTiming; fixTrialsMs: number | undefined } | undefined;
  /** The text of a file this check read (`Checker.analysedText`): what `--fix` edits. */
  analysedText: (file: string) => string | undefined;
  /** Verifies the fixes `--fix` chose as one set (`Checker.verifyFixSet`). */
  verifyFixSet: (forms: readonly FixForm[]) => FixSetReview;
  /** Where the results of this run are kept for the next one; undefined with `--no-cache` or none. */
  cacheDir: string | undefined;
};

/** One check of the project as `command` asks: the rules, the cache, ignores, the baseline and the chosen files. */
function analyse(
  command: Extract<Command, { kind: "check" }>,
  config: Config & { configFile: string },
  rules: RuleSelection,
  changed: Changed | undefined,
  cwd: string,
  env: CliEnv,
  /** Try the fixes of the findings shown: for `--fix` and `--format json --verify-fixes`. */
  tryFixes = command.fix || (command.format === "json" && command.verifyFixes),
): Analysis {
  const dir = command.noCache === true ? undefined : env.cacheDir?.(cwd);
  const disk =
    dir === undefined
      ? undefined
      : openDiskCache(dir, cwd, config.configFile, resultsCacheLimit(env.environment ?? {}));
  const recorder = command.timing ? createTimingRecorder() : undefined;
  const checker = createChecker({
    config,
    cwd,
    rules,
    uncapped: true,
    ...(command.noIgnores === true ? { ignores: false as const } : {}),
    ...(recorder === undefined ? {} : { timing: recorder }),
    // Nothing asks the programs for more once the rules read the files, unless fixes are tried.
    ...(tryFixes ? {} : { retainPrograms: false as const }),
    cache: disk?.cache ?? false,
  });
  // `--staged`: the staged text of the staged files, so the check sees what will be committed.
  const raw = checker.check(changed?.overlays);
  const run = recorder?.result();
  const save = (): void => {
    const unsaved = disk?.save();
    if (unsaved !== undefined) {
      // The findings are right; only the next run is slower.
      env.stderr(`stateward: could not save the cache in ${dir ?? ""}: ${unsaved.message}\n`);
    }
  };
  const report = (): Analysis => {
    // The baseline is read after the run, so a broken one fails only once the check has finished.
    const baseline = command.noBaseline === true ? undefined : readBaseline(config);
    const view = layBaseline(config, baseline, raw, rules);
    // The whole project was analysed; the report and the exit code cover the chosen files only.
    const scoped = changed === undefined ? undefined : scopeResult(view.fresh, changed.files);
    const result = scoped?.result ?? view.fresh;
    const shown = [
      ...result.findings,
      ...view.baselined,
      ...(result.ignored ?? []).map((entry) => entry.finding),
    ].filter((finding) => finding.kind === "problem" && finding.fixes.length > 0);
    const trying = performance.now();
    const reviewed = tryFixes ? checker.reviewFixes(shown) : undefined;
    const fixTrialsMs = reviewed === undefined ? undefined : performance.now() - trying;
    return {
      timing: run === undefined ? undefined : { run, fixTrialsMs },
      result,
      reviews:
        reviewed === undefined
          ? undefined
          : new Map(reviewed.map((review, i) => [shown[i] ?? review.finding, review])),
      view,
      baseline,
      accepted:
        baseline === undefined
          ? undefined
          : {
              baselined: view.baselined.length,
              fixed: view.fixed,
              outdated: isOutdated(baseline),
            },
      summaryScope:
        scoped === undefined ? undefined : { files: scoped.files, elsewhere: scoped.elsewhere },
      testFiles: raw.stats.testFiles ?? 0,
      testFilesByPattern: raw.stats.testFilesByPattern ?? {},
      analysedText: (file) => checker.analysedText(file),
      verifyFixSet: (forms) => checker.verifyFixSet(forms),
      cacheDir: dir,
    };
  };
  if (!tryFixes) {
    save();
    return report();
  }
  // With fixes to try, the cache is written once, after them, not also before (0.7 s on a large
  // project); `finally`, so a failure on the way keeps the findings.
  try {
    return report();
  } finally {
    save();
  }
}

/** 2 when a rule failed (the check is incomplete), 1 for an error or too many warnings, else 0. */
function exitCodeOf(
  result: CheckResult,
  command: Extract<Command, { kind: "check" }>,
  env: CliEnv,
): ExitCode {
  if (result.findings.some((f) => f.kind === "failure")) return 2;
  const failed = result.findings.some((f) => f.kind === "problem" && f.severity === "error");
  if (failed) return 1;
  const warnings = result.findings.filter(isWarning).length;
  if (command.maxWarnings !== undefined && warnings > command.maxWarnings) {
    env.stderr(
      `stateward: ${plural(warnings, "warning")}, more than the ${String(command.maxWarnings)} allowed by --max-warnings\n`,
    );
    return 1;
  }
  return 0;
}

/** The part of the summary after the fixes: what is left, and what the fixes caused. */
function leftLine(left: number, introduced: number): string {
  if (left === 0) return "nothing is left";
  const need = `${plural(left, "problem")} ${left === 1 ? "needs" : "need"} a decision (run without --fix to see ${left === 1 ? "it" : "them"})`;
  return introduced === 0
    ? need
    : `${need}; ${String(introduced)} of ${left === 1 ? "it" : "them"} ${introduced === 1 ? "was" : "were"} caused by the fixes`;
}

/**
 * `check --fix`: applies the fixes rules mark safe (fix.ts), then checks once more and says what
 * is left. With `--dry-run` it prints the diff and writes nothing. Findings the baseline accepts
 * and the ones an ignore comment covers are not in `first.result`, so they are never fixed.
 */
function runFix(
  command: Extract<Command, { kind: "check" }>,
  config: Config & { configFile: string },
  rules: RuleSelection,
  changed: Changed | undefined,
  first: Analysis,
  cwd: string,
  env: CliEnv,
): ExitCode {
  const failures = first.result.findings.filter((finding) => finding.kind === "failure");
  if (failures.length > 0) {
    // The findings are incomplete: fixing from them could miss what a failed rule would change.
    env.stdout(
      formatPretty(first.result, { cwd, readText: readTextOrUndefined, color: env.color }),
    );
    return 2;
  }
  // Only fixes that compile are applied.
  const findings = first.result.findings.map(
    (finding) => first.reviews?.get(finding)?.finding ?? finding,
  );
  // Edits are planned on the text the check read; a file saved since is left alone, as its
  // offsets no longer fit.
  const planOn = (stale: ReadonlySet<string>): FixPlan =>
    planFixes(findings, {
      root: cwd,
      readText: (file) => (stale.has(file) ? undefined : first.analysedText(file)),
      ...(changed === undefined ? {} : { only: changed.files }),
      // The fixes chosen are verified together, as they are written.
      verify: first.verifyFixSet,
    });
  env.beforeFixWrite?.();
  const firstPlan = planOn(new Set());
  const stale = changedSincePlan(firstPlan, readTextOrUndefined);
  // Planned again without them, so a fix that also edits one of them is left out whole.
  const plan = stale.size === 0 ? firstPlan : planOn(stale);
  const skippedLines = (files: Iterable<string>): string =>
    [...files]
      .sort()
      .map(
        (file) =>
          `skipped \`${displayPath(cwd, file)}\`: it changed while stateward was checking; run again\n`,
      )
      .join("");
  // Only problems "need a decision": places not checked are another count (summaryLine).
  const total = first.result.findings.filter((finding) => finding.kind === "problem").length;
  const files = plural(plan.files.length, "file");
  const fixed = plural(plan.applied.length, "problem");
  env.stdout(skippedLines(stale));
  if (plan.applied.length === 0) {
    env.stdout(
      total === 0 ? "No problems.\n" : `Nothing to fix without review; ${leftLine(total, 0)}.\n`,
    );
    return exitCodeOf(first.result, command, env);
  }
  if (command.dryRun) {
    for (const file of plan.files) {
      env.stdout(unifiedDiff(displayPath(cwd, file.file), withoutBom(file.before), file.edits));
    }
    env.stdout(
      `Would fix ${fixed} in ${files}; ${leftLine(total - plan.applied.length, 0)}. Nothing was written.\n`,
    );
    const fixedOnes = new Set(plan.applied.map((entry) => entry.finding));
    const remaining = findings.filter((finding) => !fixedOnes.has(finding));
    return exitCodeOf({ ...first.result, findings: remaining }, command, env);
  }
  env.stdout(skippedLines(writeFixes(plan, readTextOrUndefined)));
  // One more round: the fixed files are analysed again; nothing is fixed a second time.
  // Only counted, never fixed: its fixes need not be tried.
  const second = analyse(command, config, rules, changed, cwd, env, false);
  const left = second.result.findings.filter((finding) => finding.kind === "problem").length;
  const introduced = introducedBy(findings, plan.applied, second.result.findings);
  env.stdout(`Fixed ${fixed} in ${files}; ${leftLine(left, introduced)}.\n`);
  return exitCodeOf(second.result, command, env);
}

export const NO_RULES_ON =
  'No rules are on: add `preset: "recommended"`, a group or a rule to stateward.config (see docs/user/config.md)';

/** Whether the config turns any rule on, anywhere (in itself or in an override). */
function anyRuleOn(config: Config): boolean {
  return config.plugins.some((plugin) =>
    Object.entries(plugin.rules).some(([key, rule]) =>
      ruleIsOn(config, plugin.name, key, rule.meta),
    ),
  );
}

async function runCheck(
  command: Extract<Command, { kind: "check" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const cwd = place.project;
  // Asked first: a missing repository or base should not cost a whole analysis.
  const changed = command.scope === undefined ? undefined : changedFiles(cwd, command.scope);
  if (changed?.files.size === 0) {
    // Nothing of this project changed (a monorepo package a pull request leaves alone): no analysis.
    env.stdout(
      command.format === "json"
        ? `${JSON.stringify({ findings: [], hidden: [], changed: { files: 0, elsewhere: 0 } }, null, 2)}\n`
        : command.format === "github"
          ? ""
          : changed.base === undefined
            ? "No files of this project are staged.\n"
            : `No files of this project changed since \`${changed.base}\`.\n`,
    );
    return 0;
  }
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  const rules = selectRules(loaded.value, command);
  if (!rules.ok) return fail(env, rules.errors);
  const analysis = analyse(command, loaded.value, rules.value, changed, cwd, env);
  if (command.fix) {
    return runFix(command, loaded.value, rules.value, changed, analysis, cwd, env);
  }
  const { result, view, accepted, summaryScope, testFiles, testFilesByPattern, reviews, timing } =
    analysis;
  // The code shown under a finding is the text that was checked: the staged text with `--staged`.
  const readText = (file: string): string | undefined =>
    (changed === undefined ? undefined : stagedTextOf(changed.overlays, file)) ??
    readTextOrUndefined(file);
  // A plugin alone turns nothing on: say so, never "No problems" for a check that ran nothing.
  if (command.format === "pretty" && result.findings.length === 0 && !anyRuleOn(loaded.value)) {
    env.stdout(`${NO_RULES_ON}\n`);
    return 0;
  }
  const shownConfig = configShown(place);
  if (command.verbose === true) {
    env.stderr(
      verboseLines(place, loaded.value, result, analysis.cacheDir, command.noCache === true),
    );
  }
  // With rollout on, only the rules turned on run: say how many, so "No problems" is never
  // mistaken for a clean project when no rule ran at all.
  const rollout =
    command.format === "pretty" &&
    command.rule === undefined &&
    command.group === undefined &&
    loaded.value.rollout
      ? rolloutLine(readRollout(loaded.value).length)
      : "";
  const actions = env.environment?.GITHUB_ACTIONS === "true";
  const workspace = env.environment?.GITHUB_WORKSPACE;
  const root = workspace === undefined || workspace === "" ? place.here : workspace;
  const actionsHint =
    actions && !command.formatGiven
      ? "Running in GitHub Actions: add `--format github` to see findings on the pull request\n"
      : "";
  // The one trap of `exclude`: it replaces the default list, so setting it checks the tests too.
  const excludeHint =
    command.format === "pretty" && testFiles > 0 ? excludeNotice(testFilesByPattern) : "";
  const hint = `${actionsHint}${excludeHint}`;
  // The pretty report says it in its summary; the other formats keep stdout for the findings.
  if (command.format !== "pretty" && accepted?.outdated === true) {
    env.stderr(`stateward: ${OUTDATED_BASELINE}\n`);
  }
  if (command.format !== "pretty") {
    for (const line of notesLines(result.notes, place.here)) env.stderr(`stateward: ${line}\n`);
  }
  env.stdout(
    command.format === "json"
      ? `${formatJson(
          result,
          accepted === undefined ? undefined : { baselined: view.baselined, fixed: view.fixed },
          summaryScope,
          { reviews, readText },
        )}\n`
      : command.format === "github"
        ? `${formatGitHub(result, { root, readText, verbose: command.verbose === true })}${quietLine(result, command.verbose === true)}${summaryLine(result, accepted?.baselined ?? 0, summaryScope, shownConfig, command.verbose === true)}\n`
        : `${rollout}${formatPretty(result, {
            cwd: place.here,
            ...(shownConfig === undefined ? {} : { configShown: shownConfig }),
            readText,
            color: env.color,
            ...(accepted === undefined ? {} : { baseline: accepted }),
            ...(summaryScope === undefined ? {} : { scope: summaryScope }),
            ...(command.max === undefined ? {} : { max: command.max }),
            verbose: command.verbose === true,
          })}${hint}`,
  );
  if (timing !== undefined) {
    // After the summary; on stderr when stdout is for a machine (json, github).
    // maxRSS is in kilobytes: the most memory this process has held, for the whole run.
    const peakBytes = process.resourceUsage().maxRSS * 1024;
    const text = formatTiming(timing.run, timing.fixTrialsMs, peakBytes);
    if (command.format === "pretty") env.stdout(text);
    else env.stderr(text);
  }
  return exitCodeOf(result, command, env);
}

const NOTICE_PATTERNS = 3;

/** `**\/__mocks__/**` is said `__mocks__` (files in it); `**\/*.test.*` is said `*.test.*`. */
function patternLabel(pattern: string, count: number): string {
  const folder = /^\*\*\/([^*/]+)\/\*\*$/.exec(pattern)?.[1];
  const name = folder ?? pattern.replace(/^\*\*\//, "");
  return `${plural(count, "file")} ${folder === undefined ? "matching" : "in"} \`${name}\``;
}

/** What `exclude` newly checks, by default pattern, in a line that ends with the fix. */
function excludeNotice(byPattern: Readonly<Record<string, number>>): string {
  const entries = Object.entries(byPattern);
  const named = entries
    .slice(0, NOTICE_PATTERNS)
    .map(([pattern, count]) => patternLabel(pattern, count));
  const more = entries.length - NOTICE_PATTERNS;
  const what =
    more > 0 ? `${named.join(", ")} and ${plural(more, "more pattern")}` : named.join(", ");
  return `your \`exclude\` replaces the default list, so ${what} ${entries.length === 1 && entries[0]?.[1] === 1 ? "is" : "are"} checked now; add \`...defaults.exclude\` to skip them\n`;
}

/** The line standing for the places not checked that are not annotated, with its newline. */
function quietLine(result: CheckResult, verbose: boolean): string {
  const line = quietUnknownsLine(result.findings, verbose);
  return line === undefined ? "" : `${line}\n`;
}

/** `check --verbose`: the config used and the projects checked, before the findings. */
function verboseLines(
  place: Place,
  config: Config & { configFile: string },
  result: CheckResult,
  cacheDir: string | undefined,
  noCache: boolean,
): string {
  const shown = (file: string): string => displayPath(place.here, file);
  const projects =
    result.stats.projects ??
    config.tsconfig.map((tsconfig) => ({ tsconfig, files: result.stats.files }));
  const cache =
    cacheDir === undefined
      ? `stateward: results are not kept for the next run${noCache ? " (--no-cache)" : ""}`
      : `stateward: results cache ${shown(cacheDir)}`;
  return [
    `stateward: config ${shown(config.configFile)}`,
    ...projects.map(
      ({ tsconfig, files }) => `stateward: project ${shown(tsconfig)} (${plural(files, "file")})`,
    ),
    cache,
    "",
  ].join("\n");
}

/** `baselined 12 findings in 3 files; only new ones will fail from now on` */
/** Rule ids in `baseline` whose pack is loaded but no longer has the rule (removed in a release). */
function removedRuleIds(
  plugins: readonly Plugin[],
  baseline: Baseline | undefined,
): ReadonlySet<string> {
  const packs = new Set(plugins.map((plugin) => plugin.name));
  const known = new Set(
    plugins.flatMap((plugin) => Object.keys(plugin.rules).map((key) => `${plugin.name}/${key}`)),
  );
  const ids = (baseline?.entries ?? []).map((entry) => entry.ruleId);
  return new Set(
    ids.filter((id) => packs.has(id.slice(0, Math.max(0, id.indexOf("/")))) && !known.has(id)),
  );
}

async function runBaseline(
  command: Extract<Command, { kind: "baseline" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const cwd = place.project;
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  const config = loaded.value;
  const existing = readBaseline(config);
  if (command.prune && existing === undefined) {
    return fail(env, [
      "there is no baseline to prune; run `stateward baseline` to write stateward.baseline.json first",
    ]);
  }
  const selection: RuleSelection = { kind: "configured" };
  const result = check({ config, cwd, rules: selection, uncapped: true });
  // A rule that failed means the findings are incomplete: baselining them would accept too little.
  const failures = result.findings.filter((finding) => finding.kind === "failure");
  if (failures.length > 0) {
    return fail(
      env,
      failures.map((finding) => finding.message),
    );
  }
  const ran = activeRuleIds(config, selection);
  const context = { configDir: config.configDir, readText: readTextOrUndefined };
  if (command.prune) {
    // An entry of a rule its pack no longer has can never match again: prune drops it. An entry of
    // a pack the config does not load is kept, since that pack may come back.
    const removed = removedRuleIds(config.plugins, existing);
    const kept =
      existing === undefined
        ? undefined
        : { entries: existing.entries.filter((entry) => !removed.has(entry.ruleId)) };
    const dropped =
      sizeOf(existing ?? { entries: [] }).findings - sizeOf(kept ?? { entries: [] }).findings;
    const view = applyBaseline(kept, result, { ...context, ran });
    if (view.pruned === undefined || (view.fixed === 0 && dropped === 0)) {
      env.stdout(
        `nothing to prune: all ${plural(sizeOf(existing ?? { entries: [] }).findings, "baselined finding")} are still found\n`,
      );
      return 0;
    }
    writeBaseline(config, view.pruned);
    const left = sizeOf(view.pruned).findings;
    const gone =
      dropped === 0
        ? ""
        : `, and ${plural(dropped, "finding")} of rules that no longer exist (${[...removed].sort().join(", ")})`;
    env.stdout(
      `pruned ${plural(view.fixed, "fixed finding")}${gone} from ${BASELINE_FILE}; ${String(left)} still baselined\n`,
    );
    return 0;
  }
  const merged = mergeBaseline(existing, ran, baselineOf(result.findings, context));
  const size = sizeOf(merged);
  if (size.findings === 0 && existing === undefined) {
    env.stdout("nothing to baseline: the check found no problems\n");
    return 0;
  }
  writeBaseline(config, merged);
  env.stdout(
    `baselined ${plural(size.findings, "finding")} in ${plural(size.files, "file")}; only new ones will fail from now on\n`,
  );
  return 0;
}

async function runCoverage(
  command: Extract<Command, { kind: "coverage" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const cwd = place.project;
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  const checker = createChecker({ config: loaded.value, cwd, cache: false });
  const raw = checker.check();
  // Findings the baseline accepts are not problems to look at; they are counted on their own.
  const view = layBaseline(loaded.value, readBaseline(loaded.value), raw, { kind: "configured" });
  const report = buildCoverage({
    config: loaded.value,
    result: view.fresh,
    cwd,
    readText: readTextOrUndefined,
    baselined: view.baselined.length,
    silent: checker.silentReasons(),
  });
  env.stdout(
    command.format === "json" ? `${formatCoverageJson(report)}\n` : formatCoveragePretty(report),
  );
  // Like check: a rule that failed means the report is incomplete. Findings alone never fail it.
  return report.failures.length > 0 ? 2 : 0;
}

/** package.json's text, undefined when there is none; any other failure to read is an error (C35). */
function readManifest(cwd: string): string | undefined {
  const file = path.join(cwd, "package.json");
  if (!existsSync(file)) return undefined;
  return readFileSync(file, "utf8");
}

/** How many problems the project has under its (just written) config; undefined when it cannot be checked yet. */
async function countProblems(
  cwd: string,
): Promise<{ findings: number; rules: number } | undefined> {
  // The packs the config imports may not be installed yet: then there is nothing to count, quietly.
  const loaded = await loadConfig(cwd);
  if (!loaded.ok) return undefined;
  let result;
  try {
    result = check({ config: loaded.value, cwd });
  } catch (error) {
    if (error instanceof NothingToCheckError || error instanceof TsconfigError) return undefined;
    throw error;
  }
  const perRule = new Map<string, number>();
  for (const finding of result.findings) {
    if (finding.kind === "problem") {
      perRule.set(finding.ruleId, (perRule.get(finding.ruleId) ?? 0) + 1);
    }
  }
  for (const entry of result.hidden) {
    perRule.set(entry.ruleId, (perRule.get(entry.ruleId) ?? 0) + entry.count);
  }
  const findings = [...perRule.values()].reduce((sum, count) => sum + count, 0);
  return { findings, rules: perRule.size };
}

/**
 * The answers to `init`'s questions: all defaults for `--yes`, typed ones on a terminal, and none
 * (undefined) when there is no terminal, so scripts and CI never wait for an answer.
 */
async function askChoices(
  command: Extract<Command, { kind: "init" }>,
  cwd: string,
  env: CliEnv,
  manifest: string | undefined,
): Promise<InitChoices | undefined> {
  const context = {
    detected: detectPacks(manifest),
    packs: command.packs,
    preset: command.preset,
    hasCode: projectHasCode(cwd),
    usesReactRouter: usesReactRouter(manifest),
  };
  if (command.yes) return askInit(acceptDefaults, context);
  if (env.terminal === undefined) return undefined;
  const session = openTerminal(env.terminal);
  try {
    return await askInit(session.ask, context);
  } finally {
    session.close();
  }
}

/** The workflows under .github/workflows of the repository at `root`, sorted by name. */
function workflowsIn(root: string): { name: string; text: string }[] {
  const dir = path.join(root, ".github", "workflows");
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const text = readTextOrUndefined(path.join(dir, name));
    return text === undefined ? [] : [{ name: `.github/workflows/${name}`, text }];
  });
}

/**
 * `init --ci github`: writes the workflow unless one is already there. In a package of a
 * monorepo it goes to the repository root, where GitHub reads workflows: the install runs there,
 * with the root's package manager, and stateward in the package's folder.
 */
function writeWorkflow(cwd: string, env: CliEnv, changed: boolean, force: boolean): string {
  const repository = gitRoot(cwd);
  const project = realpathSync(cwd);
  const root = repository === undefined || repository === project ? cwd : repository;
  const directory =
    root === cwd ? undefined : path.relative(root, project).split(path.sep).join("/");
  const target = path.join(root, WORKFLOW_FILE);
  const shown = displayPath(cwd, target);
  const hasFile = (file: string): boolean => existsSync(path.join(root, file));
  const running = force
    ? undefined
    : workflowRunningStateward(
        workflowsIn(root).filter((file) => file.name !== WORKFLOW_FILE),
        projectScripts(root, cwd),
      );
  if (running !== undefined) {
    const how =
      running.via === undefined
        ? "`stateward check`"
        : `stateward in ${describeScriptRun(running.via)}`;
    return `${running.name} already runs ${how}; no second workflow written (\`--force\` writes ${shown} anyway).\n`;
  }
  const branch = defaultBranch(root);
  const lockfile = detectLockfile(hasFile);
  const manager = detectPackageManager(hasFile);
  const packageJsonText = readTextOrUndefined(path.join(root, "package.json"));
  const text = renderWorkflow({
    manager,
    lockfile,
    version: env.version ?? "unknown",
    hasFile,
    yarnClassic: isYarnClassic({
      packageJsonText,
      lockfileText:
        lockfile === undefined ? undefined : readTextOrUndefined(path.join(root, lockfile)),
      hasFile,
    }),
    nodeVersion: nodeVersionOf({
      packageJsonText,
      nvmrc: readTextOrUndefined(path.join(root, ".nvmrc")),
      nodeVersionFile: readTextOrUndefined(path.join(root, ".node-version")),
    }),
    ...(branch === undefined ? {} : { branch }),
    changed,
    ...(directory === undefined ? {} : { directory }),
  });
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    // "wx": a workflow you have edited is never overwritten.
    writeFileSync(target, text, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return `${shown} already exists; nothing written.\n`;
    }
    throw error;
  }
  return [
    directory === undefined
      ? `Wrote ${shown}: it installs your packages, restores stateward's cache, and runs`
      : `Wrote ${shown}, at the root of the repository where GitHub looks for it: it installs the repository's packages, restores stateward's cache, and runs, in ${directory},`,
    changed
      ? "`npx --no stateward check --format github --changed origin/<base>` on pull requests (only the files they change)."
      : "`npx --no stateward check --format github`, so findings show on the pull request.",
    "It needs stateward in your project's devDependencies; commit the file when that is done.",
    "",
  ].join("\n");
}

async function runInit(
  command: Extract<Command, { kind: "init" }>,
  cwd: string,
  env: CliEnv,
): Promise<ExitCode> {
  const existing = findConfigFile(cwd);
  if (existing !== undefined) {
    const workflow =
      command.ci === undefined ? "" : writeWorkflow(cwd, env, command.changed, command.force);
    const hook =
      command.hook === undefined ? undefined : writeHook(cwd, command.hook, command.force);
    const extras = `${workflow}${hook?.text ?? ""}`;
    env.stdout(
      extras === ""
        ? `${path.basename(existing)} already exists; nothing written.\n`
        : `${path.basename(existing)} already exists; kept.\n${extras}`,
    );
    return hook?.ok === false ? 2 : 0;
  }
  const manifest = readManifest(cwd);
  const choices = await askChoices(command, cwd, env, manifest);
  const packs = choices?.packs ?? command.packs ?? detectPacks(manifest);
  const preset = choices?.preset ?? command.preset ?? DEFAULT_PRESET;
  const asked = choices !== undefined && !command.yes;
  const why =
    command.packs !== undefined
      ? "from --packs"
      : asked
        ? "your choice"
        : "detected from package.json";
  const addons = choices?.reactRouter === true ? [REACT_ROUTER_ADDON] : [];
  const configFile = path.join(cwd, DEFAULT_CONFIG_FILE);
  const answeredRollout = choices?.rollout === true;
  // "wx" fails if the file appeared since the check above, so a config is never overwritten.
  writeFileSync(configFile, renderConfig(packs, preset, answeredRollout, addons), { flag: "wx" });
  // Without answers, the project's own findings decide; with them, the answer stands.
  const problems = choices === undefined ? await countProblems(cwd) : undefined;
  const overwhelming = problems !== undefined && problems.findings > ROLLOUT_THRESHOLD;
  // The file is ours, written a moment ago: this is a second draft of it, not an overwrite.
  if (overwhelming) writeFileSync(configFile, renderConfig(packs, preset, true, addons));
  const rollout = answeredRollout || overwhelming;
  const manager = detectPackageManager((file) => existsSync(path.join(cwd, file)));
  const hook = command.hook === undefined ? undefined : writeHook(cwd, command.hook, command.force);
  env.stdout(
    [
      `Created ${DEFAULT_CONFIG_FILE}`,
      `  packs   ${packs.join(", ")} (${why})`,
      `  preset  ${preset}`,
      ...(addons.length > 0 ? [`  add-ons ${addons.join(", ")}`] : []),
      ...(answeredRollout
        ? ["  rollout on: rules are turned on one at a time (stateward plan, stateward next)"]
        : []),
      ...(overwhelming
        ? [
            `  ${String(problems.findings)} findings across ${String(problems.rules)} rules: turning on one rule at a time (stateward plan, stateward next)`,
          ]
        : []),
      "",
      `Install what it imports (${manager}, from your lockfile; stateward does not run it):`,
      `  ${installCommand(manager, packs)}`,
      "",
      rollout ? NEXT_FIRST_RULE : "Then run: stateward check",
      "",
      ...(command.ci === undefined
        ? []
        : [writeWorkflow(cwd, env, command.changed, command.force)]),
      ...(hook === undefined ? [] : [hook.text]),
    ].join("\n"),
  );
  return hook?.ok === false ? 2 : 0;
}

async function runExplain(given: string, place: Place, env: CliEnv): Promise<ExitCode> {
  const loaded = await loadPlaced(place);
  if (!loaded.ok) return fail(env, loaded.errors);
  showWarnings(env, loaded.value.warnings);
  const known = ruleIds(loaded.value.plugins);
  const text = await explain(loaded.value, given);
  if (text === undefined) {
    return fail(env, [unknownRuleMessage(given, known)]);
  }
  env.stdout(`${text.trimEnd()}\n`);
  return 0;
}

/** The rules turned on so far: the rollout file when the config asks for it, else none. */
function enabledRules(config: Config): readonly string[] {
  return config.rollout ? readRollout(config) : [];
}

async function runPlan(
  command: Extract<Command, { kind: "plan" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const cwd = place.project;
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  const config = loaded.value;
  const enabled = enabledRules(config);
  const checker = createChecker({ config, cwd, rules: { kind: "all" }, cache: false });
  const result = checker.check();
  const report = buildPlanReport(
    buildPlan(config, result, checker.silentReasons()),
    config.rollout,
    enabled,
  );
  env.stdout(command.format === "json" ? `${formatPlanJson(report)}\n` : formatPlanPretty(report));
  // Like coverage: findings alone never fail the plan; a rule that threw makes it incomplete.
  const failures = result.findings.filter((finding) => finding.kind === "failure");
  if (failures.length === 0) return 0;
  return fail(
    env,
    failures.map((finding) => finding.message),
  );
}

async function runNext(
  command: Extract<Command, { kind: "next" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const cwd = place.project;
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  const config = loaded.value;
  if (!config.rollout) {
    const name = path.basename(loaded.value.configFile);
    return fail(env, [
      `turn on \`rollout: true\` in ${name} first: without it every rule runs, and \`next\` has nothing to turn on`,
    ]);
  }
  const enabled = readRollout(config);
  const everything: RuleSelection = { kind: "all" };
  const raw = check({ config, cwd, rules: everything, uncapped: true });
  const failures = raw.findings.filter((finding) => finding.kind === "failure");
  if (failures.length > 0) {
    return fail(
      env,
      failures.map((finding) => finding.message),
    );
  }
  // Baselined findings do not hold the next rule back.
  const baseline = readBaseline(config);
  const result = layBaseline(config, baseline, raw, everything).fresh;
  const step = advance(buildPlan(config, result), enabled, command.anyway);
  switch (step.kind) {
    case "not-checked":
      env.stdout(`${describeNotChecked(step.rows)}\n`);
      return 0;
    case "all-on":
      env.stdout(`every rule is on; you can remove ${ROLLOUT_FILE} and \`rollout\`\n`);
      return 0;
    case "blocked":
      env.stderr(
        `stateward: \`${step.row.ruleId}\` still has ${plural(step.row.findings, "finding")}; fix them, or run \`stateward next --anyway\` to move on, or \`stateward baseline\` to accept them\n`,
      );
      return 1;
    case "turn-on": {
      // The rule with findings goes last: it is the one `next` waits on.
      const clean = step.clean.map((row) => row.ruleId);
      const lines = [...describeTurnOn(step)];
      // The baseline goes first: if the rollout write then fails, running again repeats both
      // safely (entries of a rule that is not on are ignored).
      if (command.baseline && step.row !== undefined) {
        const ruleId = step.row.ruleId;
        const built = baselineOf(
          raw.findings.filter((finding) => finding.ruleId === ruleId),
          { configDir: config.configDir, readText: readTextOrUndefined },
        );
        writeBaseline(config, mergeBaseline(baseline, new Set([ruleId]), built));
        const size = sizeOf(built);
        lines.push(
          `baselined ${plural(size.findings, "finding")} of ${ruleId} in ${plural(size.files, "file")}; only new ones will fail from now on`,
        );
      }
      writeRollout(config, [
        ...enabled,
        ...clean,
        ...(step.row === undefined ? [] : [step.row.ruleId]),
      ]);
      env.stdout(`${lines.join("\n")}\n`);
      return 0;
    }
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

/** `stateward deps`: the packages the project calls and how their facts are known. */
async function runDeps(
  command: Extract<Command, { kind: "deps" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const cwd = place.project;
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  // Every rule the presets turn on, whatever the rollout says: the facts are read by the rules.
  const checker = createChecker({
    config: loaded.value,
    cwd,
    rules: { kind: "all" },
    cache: false,
  });
  const result = checker.check();
  const rows = buildDeps(checker.libraryFacts());
  env.stdout(command.format === "json" ? `${formatDepsJson(rows)}\n` : formatDepsPretty(rows));
  const failures = result.findings.filter((finding) => finding.kind === "failure");
  if (failures.length === 0) return 0;
  return fail(
    env,
    failures.map((finding) => finding.message),
  );
}

/**
 * `stateward guarantees`: every stated guarantee, with its proof. Every rule runs, so a guarantee
 * whose rule the config leaves off is still listed (as not checked), never left out; a guarantee
 * counts the findings of a rule only when the config turns that rule on.
 */
async function runGuarantees(
  command: Extract<Command, { kind: "guarantees" }>,
  place: Place,
  env: CliEnv,
): Promise<ExitCode> {
  const loaded = await loadForAnalysis(place, env);
  if (!loaded.ok) return fail(env, loaded.errors);
  const config = loaded.value;
  const checker = createChecker({
    config,
    cwd: place.project,
    rules: { kind: "all" },
    cache: false,
    uncapped: true,
  });
  const result = checker.check();
  const proofs = proveGuarantees(
    checker.guarantees(),
    result.findings,
    activeRuleIds(config, { kind: "configured" }),
  );
  const texts = new Map<string, string>();
  const locate: Locate = (location) => {
    const text =
      texts.get(location.file) ??
      checker.analysedText(location.file) ??
      readTextOrUndefined(location.file) ??
      "";
    texts.set(location.file, text);
    return {
      file: displayPath(place.here, location.file),
      line: positionAt(text, location.start).line,
    };
  };
  env.stdout(
    command.format === "json"
      ? `${formatGuaranteesJson(proofs, locate)}\n`
      : formatGuaranteesPretty(proofs, locate),
  );
  const failures = result.findings.filter((finding) => finding.kind === "failure");
  if (failures.length > 0) {
    return fail(
      env,
      failures.map((finding) => finding.message),
    );
  }
  return guaranteesExitCode(proofs);
}

/** `stateward cache stats` and `stateward cache clean`: the global package cache only. */
/**
 * `cache stats|clean`: the package cache shared by every project on the machine, and the results
 * cache of the project at `here` (the nearest config's folder), when it has one.
 */
function runCache(
  command: Extract<Command, { kind: "cache" }>,
  here: string,
  env: CliEnv,
): ExitCode {
  const place = locate(here, undefined);
  const resultsDir = env.cacheDir?.(place.project);
  const limit = resultsCacheLimit(env.environment ?? {});
  if (command.action === "stats") {
    env.stdout(
      formatCacheStats(
        packageCacheStats(),
        resultsDir === undefined ? undefined : resultsCacheStats(resultsDir, limit),
      ),
    );
    return 0;
  }
  const results = resultsDir === undefined ? undefined : cleanResultsCache(resultsDir, limit);
  const cleaned = cleanPackageCache();
  if (cleaned.kind === "refused") {
    if (results !== undefined) env.stdout(formatCacheClean(undefined, results));
    return fail(env, [`cache clean removed nothing from ${cleaned.dir}: ${cleaned.reason}`]);
  }
  env.stdout(formatCacheClean(cleaned.stats, results));
  return 0;
}

/**
 * Where a command runs: the folder the developer is in (`--cwd`), the config it uses, and the
 * project folder, which is the config's folder (its `include`, `exclude`, baseline and cache are
 * relative to it).
 */
type Place = { here: string; project: string; configFile: string | undefined };

/**
 * `--config <file>`, else the nearest config at or above `here` (findConfigUpward). With none, the
 * project is `here` and loading says that no config was found there.
 */
function locate(here: string, given: string | undefined): Place {
  const configFile = given === undefined ? findConfigUpward(here) : path.resolve(here, given);
  return {
    here,
    project: configFile === undefined ? here : path.dirname(configFile),
    configFile,
  };
}

async function loadPlaced(place: Place): ReturnType<typeof loadConfigFile> {
  if (place.configFile !== undefined) return loadConfigFile(place.configFile);
  return {
    ok: false,
    errors: [
      `no ${CONFIG_FILE_PATTERN} found in ${place.here} or a folder above it\n  = fix: run \`npx stateward init\` in your project's folder to create one, or name one with \`--config <file>\``,
    ],
  };
}

/**
 * Thrown when the command ran again in another process with the memory the config's `maxMemory`
 * asks for: that process printed everything, and its exit code is this command's.
 */
class RanElsewhere extends Error {
  constructor(readonly exitCode: ExitCode) {
    super("ran in another process");
    this.name = "RanElsewhere";
  }
}

/**
 * The config of a command that analyses the project; when its `maxMemory` needs another process
 * (`CliEnv.restartWithMemory`), the command runs there and this throws `RanElsewhere`.
 */
async function loadForAnalysis(place: Place, env: CliEnv): ReturnType<typeof loadConfigFile> {
  const loaded = await loadPlaced(place);
  const maxMemory = loaded.ok ? loaded.value.maxMemory : undefined;
  if (maxMemory !== undefined && env.restartWithMemory !== undefined) {
    const exitCode = await env.restartWithMemory(maxMemory);
    if (exitCode !== undefined) throw new RanElsewhere(exitCode);
  }
  // Said once, by the process that runs the command.
  if (loaded.ok) showWarnings(env, loaded.value.warnings);
  return loaded;
}

/** What the config should change though it still works (`Config.warnings`), on stderr. */
function showWarnings(env: CliEnv, warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  env.stderr(`${warnings.map((warning) => `stateward: warning: ${warning}`).join("\n")}\n`);
}

/** The config as the developer would type it from where they are, when it is not in that folder. */
function configShown(place: Place): string | undefined {
  if (place.configFile === undefined || place.project === place.here) return undefined;
  return displayPath(place.here, place.configFile);
}

function fail(env: CliEnv, errors: readonly string[]): ExitCode {
  env.stderr(`${errors.map((e) => `stateward: ${e}`).join("\n")}\n`);
  return 2;
}

async function run(command: Command, env: CliEnv): Promise<ExitCode> {
  const cwd = path.resolve(env.cwd, command.cwd ?? ".");
  switch (command.kind) {
    case "check":
      return runCheck(command, locate(cwd, command.config), env);
    case "baseline":
      return runBaseline(command, locate(cwd, command.config), env);
    case "coverage":
      return runCoverage(command, locate(cwd, command.config), env);
    case "plan":
      return runPlan(command, locate(cwd, command.config), env);
    case "next":
      return runNext(command, locate(cwd, command.config), env);
    case "init":
      return runInit(command, cwd, env);
    case "explain":
      return runExplain(command.ruleId, locate(cwd, command.config), env);
    case "deps":
      return runDeps(command, locate(cwd, command.config), env);
    case "guarantees":
      return runGuarantees(command, locate(cwd, command.config), env);
    case "cache":
      return runCache(command, cwd, env);
    case "help":
      env.stdout(command.topic === undefined ? overviewHelp() : commandHelp(command.topic));
      return 0;
    case "version":
      env.stdout(`${env.version ?? "unknown"}\n`);
      return 0;
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}

/**
 * Runs the CLI: 0 when no error-severity problem, 1 when there is one, 2 on usage or config
 * errors and when a rule failed.
 */
export async function main(argv: readonly string[], env: CliEnv): Promise<ExitCode> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    const errors = parsed.errors.map((e) => `stateward: ${e}`).join("\n");
    env.stderr(`${errors}\n${usageAfterError(argv[0])}\n`);
    return 2;
  }
  try {
    return await run(parsed.value, env);
  } catch (error) {
    if (error instanceof RanElsewhere) return error.exitCode;
    // The boundary of the process: nothing below may crash it with a stack trace.
    if (
      error instanceof NothingToCheckError ||
      error instanceof TsconfigError ||
      error instanceof TypeScriptLibMissingError
    ) {
      env.stderr(`stateward: ${error.message}\n  = fix: ${error.hint}\n`);
      return 2;
    }
    if (error instanceof GitError) return fail(env, [error.message]);
    if (
      error instanceof PackageJsonError ||
      error instanceof RolloutError ||
      error instanceof BaselineError
    ) {
      return fail(env, [error.message]);
    }
    const reason = error instanceof Error ? error.message : String(error);
    return fail(env, [`unexpected error: ${reason}`]);
  }
}
