import { MIN_MAX_MEMORY, PRESETS, isMaxMemory, isPreset, orList } from "@stateward/core/internal";
import type { ParseResult, Preset } from "@stateward/core/internal";
import { PACK_NAMES, isPackName } from "./init.js";
import type { PackName } from "./init.js";
import type { Scope } from "./changed.js";
import type { HookKind } from "./hook.js";
import { isHelpTopic } from "./help.js";
import type { HelpTopic } from "./help.js";

export type OutputFormat = "pretty" | "json";

/** `check` also prints GitHub Actions annotations. */
export type CheckFormat = OutputFormat | "github";

export type Command =
  | {
      kind: "check";
      format: CheckFormat;
      /** Whether `--format` was given; without it, a GitHub Actions run gets a hint. */
      formatGiven: boolean;
      cwd: string | undefined;
      /** `--config <file>`: this config instead of the nearest one. */
      config: string | undefined;
      /** `--verbose`: say which config and which projects were used. */
      verbose: true | undefined;
      max: number | undefined;
      /** `--max-warnings <n>`: exit 1 when there are more warnings than this. */
      maxWarnings: number | undefined;
      /** Only this rule, whatever the rollout says. */
      rule: string | undefined;
      /** Only the rules of this group ("<plugin>/<group>"), whatever the rollout says. */
      group: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
      /** `--no-baseline`: show every finding, baselined or not. */
      noBaseline: true | undefined;
      /** `--no-ignores`: show the findings that `// stateward-ignore` comments cover. */
      noIgnores: true | undefined;
      /** `--changed [<base>]` or `--staged`: report only the findings of those files. */
      scope: Scope | undefined;
      /** `--fix`: apply the fixes that rules mark safe, then check again. */
      fix: boolean;
      /** `--fix --dry-run`: print what `--fix` would change as a diff and write nothing. */
      dryRun: boolean;
      /** `--timing`: after the summary, where the check spent its time, rule by rule. */
      timing: boolean;
      /** `--verify-fixes`: with `--format json`, try each fix and say whether it compiles. */
      verifyFixes: boolean;
    }
  | {
      kind: "baseline";
      prune: boolean;
      cwd: string | undefined;
      config: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
    }
  | {
      kind: "plan";
      format: OutputFormat;
      cwd: string | undefined;
      config: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
    }
  | {
      kind: "next";
      anyway: boolean;
      baseline: boolean;
      cwd: string | undefined;
      config: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
    }
  | {
      kind: "coverage";
      format: OutputFormat;
      cwd: string | undefined;
      config: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
    }
  | {
      kind: "init";
      cwd: string | undefined;
      /** Overrides detection. */
      packs: readonly PackName[] | undefined;
      preset: Preset | undefined;
      /** Accept every default without asking. */
      yes: boolean;
      /** `--ci github`: also write the GitHub Actions workflow. */
      ci: "github" | undefined;
      /** `--ci github --changed`: the workflow checks only the files of a pull request. */
      changed: boolean;
      /** `--hook [pre-commit|pre-push]`: also add a git hook (pre-commit unless said). */
      hook: HookKind | undefined;
      /** `--force`: write the workflow or the hook line even when stateward already runs there. */
      force: boolean;
    }
  | { kind: "explain"; ruleId: string; cwd: string | undefined; config: string | undefined }
  | {
      kind: "deps";
      format: OutputFormat;
      cwd: string | undefined;
      config: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
    }
  | {
      kind: "guarantees";
      format: OutputFormat;
      cwd: string | undefined;
      config: string | undefined;
      /** `--no-cache`: neither read nor write the results of earlier runs. */
      noCache: true | undefined;
    }
  /** `--cwd`: the project whose results cache is shown or cleaned (with the shared package cache). */
  | { kind: "cache"; action: "stats" | "clean"; cwd: string | undefined }
  /** `--help`, `help`, or `<command> --help`: print the overview, or that command's page. */
  | { kind: "help"; topic: HelpTopic | undefined; cwd: undefined }
  | { kind: "version"; cwd: undefined };

type Options = {
  format: CheckFormat | undefined;
  cwd: string | undefined;
  config: string | undefined;
  verbose: true | undefined;
  packs: readonly PackName[] | undefined;
  preset: Preset | undefined;
  max: number | undefined;
  maxWarnings: number | undefined;
  ci: "github" | undefined;
  rule: string | undefined;
  group: string | undefined;
  anyway: boolean;
  yes: boolean;
  noCache: true | undefined;
  noBaseline: true | undefined;
  noIgnores: true | undefined;
  timing: boolean;
  /** `--changed`, with its base when one follows. */
  changed: { base: string | undefined } | undefined;
  staged: boolean;
  fix: boolean;
  dryRun: boolean;
  verifyFixes: boolean;
  hook: HookKind | undefined;
  force: boolean;
  prune: boolean;
  baseline: boolean;
  /** `--max-memory <MB>`: bin.ts acts on it before anything runs (heap.ts); checked here. */
  maxMemory: number | undefined;
  positionals: readonly string[];
};

const VALUE_OPTIONS: readonly string[] = [
  "--format",
  "--cwd",
  "--config",
  "--packs",
  "--preset",
  "--max",
  "--max-warnings",
  "--ci",
  "--rule",
  "--group",
  "--max-memory",
];

/** The commands that analyse the project, where `--max-memory` and `--no-cache` apply. */
const ANALYSES: readonly string[] = [
  "check",
  "baseline",
  "coverage",
  "plan",
  "next",
  "deps",
  "guarantees",
];

function isFormat(value: string): value is CheckFormat {
  return value === "pretty" || value === "json" || value === "github";
}

function parsePacks(value: string): ParseResult<readonly PackName[]> {
  const names = value.split(",").map((name) => name.trim());
  const packs: PackName[] = [];
  for (const name of names) {
    if (!isPackName(name)) {
      const known = PACK_NAMES.join(", ");
      return { ok: false, errors: [`--packs: unknown pack "${name}"; known packs: ${known}`] };
    }
    if (!packs.includes(name)) packs.push(name);
  }
  return { ok: true, value: packs };
}

function parseOptions(args: readonly string[]): ParseResult<Options> {
  const options: Options = {
    format: undefined,
    cwd: undefined,
    config: undefined,
    verbose: undefined,
    packs: undefined,
    preset: undefined,
    max: undefined,
    maxWarnings: undefined,
    ci: undefined,
    rule: undefined,
    group: undefined,
    anyway: false,
    yes: false,
    noCache: undefined,
    noBaseline: undefined,
    noIgnores: undefined,
    timing: false,
    changed: undefined,
    staged: false,
    fix: false,
    dryRun: false,
    verifyFixes: false,
    hook: undefined,
    force: false,
    prune: false,
    baseline: false,
    maxMemory: undefined,
    positionals: [],
  };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--anyway") {
      options.anyway = true;
      continue;
    }
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--no-cache") {
      options.noCache = true;
      continue;
    }
    if (arg === "--no-baseline") {
      options.noBaseline = true;
      continue;
    }
    if (arg === "--no-ignores") {
      options.noIgnores = true;
      continue;
    }
    if (arg === "--timing") {
      options.timing = true;
      continue;
    }
    if (arg === "--staged") {
      options.staged = true;
      continue;
    }
    if (arg === "--fix") {
      options.fix = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--verify-fixes") {
      options.verifyFixes = true;
      continue;
    }
    if (arg === "--hook") {
      // The kind is optional: it is the next word when that names one.
      const next = args[i + 1];
      if (next === "pre-commit" || next === "pre-push") {
        options.hook = next;
        i++;
      } else {
        options.hook = "pre-commit";
      }
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--changed") {
      // The base is optional: it is the next word when that is not another option.
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        options.changed = { base: next };
        i++;
      } else {
        options.changed = { base: undefined };
      }
      continue;
    }
    if (arg === "--prune") {
      options.prune = true;
      continue;
    }
    if (arg === "--baseline") {
      options.baseline = true;
      continue;
    }
    if (!VALUE_OPTIONS.includes(arg)) {
      if (arg.startsWith("-")) return { ok: false, errors: [`unknown option ${arg}`] };
      positionals.push(arg);
      continue;
    }
    const value = args[++i];
    if (value === undefined) return { ok: false, errors: [`${arg} needs a value`] };
    if (arg === "--cwd") options.cwd = value;
    else if (arg === "--config") options.config = value;
    else if (arg === "--rule") options.rule = value;
    else if (arg === "--group") options.group = value;
    else if (arg === "--max") {
      if (!/^[1-9]\d*$/.test(value)) {
        return { ok: false, errors: [`--max must be a whole number above 0, not "${value}"`] };
      }
      options.max = Number(value);
    } else if (arg === "--max-warnings") {
      if (!/^\d+$/.test(value)) {
        return {
          ok: false,
          errors: [`--max-warnings must be a whole number (0 or more), not "${value}"`],
        };
      }
      options.maxWarnings = Number(value);
    } else if (arg === "--max-memory") {
      const mb = /^\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!isMaxMemory(mb)) {
        return {
          ok: false,
          errors: [
            `--max-memory must be a whole number of MB, at least ${String(MIN_MAX_MEMORY)} (like 6144), not "${value}"`,
          ],
        };
      }
      options.maxMemory = mb;
    } else if (arg === "--ci") {
      if (value !== "github") {
        return { ok: false, errors: [`--ci must be "github", not "${value}"`] };
      }
      options.ci = value;
    } else if (arg === "--format") {
      if (!isFormat(value)) {
        return {
          ok: false,
          errors: [`--format must be "pretty", "json" or "github", not "${value}"`],
        };
      }
      options.format = value;
    } else if (arg === "--preset") {
      if (!isPreset(value)) {
        return {
          ok: false,
          errors: [`--preset must be ${orList(PRESETS)}, not "${value}"`],
        };
      }
      options.preset = value;
    } else {
      const packs = parsePacks(value);
      if (!packs.ok) return packs;
      options.packs = packs.value;
    }
  }
  return { ok: true, value: { ...options, positionals } };
}

function scopeOf(changed: Options["changed"], staged: boolean): Scope | undefined {
  if (staged) return { kind: "staged" };
  return changed === undefined ? undefined : { kind: "changed", base: changed.base };
}

/** Parses argv (without node and the script) into one command, or says what is wrong. */
export function parseArgs(argv: readonly string[]): ParseResult<Command> {
  const [name, ...rest] = argv;
  if (name === undefined) return { ok: false, errors: ["give a command, e.g. stateward check"] };
  if (name === "--help" || name === "-h" || name === "help") {
    const [topic] = rest;
    if (topic === undefined)
      return { ok: true, value: { kind: "help", topic: undefined, cwd: undefined } };
    return isHelpTopic(topic)
      ? { ok: true, value: { kind: "help", topic, cwd: undefined } }
      : { ok: false, errors: [`unknown command "${topic}"`] };
  }
  if (name === "--version" || name === "-v")
    return { ok: true, value: { kind: "version", cwd: undefined } };
  if (rest.includes("--help") || rest.includes("-h")) {
    return isHelpTopic(name)
      ? { ok: true, value: { kind: "help", topic: name, cwd: undefined } }
      : { ok: false, errors: [`unknown command "${name}"`] };
  }
  const options = parseOptions(rest);
  if (!options.ok) return options;
  const {
    format,
    cwd,
    config,
    verbose,
    packs,
    preset,
    max,
    maxWarnings,
    ci,
    rule,
    group,
    anyway,
    yes,
    noCache,
    noBaseline,
    noIgnores,
    timing,
    changed,
    staged,
    fix,
    dryRun,
    verifyFixes,
    hook,
    force,
    prune,
    baseline,
    maxMemory,
    positionals,
  } = options.value;
  if (max !== undefined && (name !== "check" || format === "json" || format === "github")) {
    return { ok: false, errors: ["--max only applies to check with the pretty format"] };
  }
  if (
    name !== "check" &&
    name !== "coverage" &&
    name !== "plan" &&
    name !== "deps" &&
    name !== "guarantees" &&
    format !== undefined
  ) {
    return {
      ok: false,
      errors: ["--format only applies to check, coverage, plan, deps and guarantees"],
    };
  }
  if (name !== "check" && format === "github") {
    return { ok: false, errors: ["--format github only applies to check"] };
  }
  if (name !== "check" && maxWarnings !== undefined) {
    return { ok: false, errors: ["--max-warnings only applies to check"] };
  }
  if (config !== undefined && (name === "init" || name === "cache")) {
    return {
      ok: false,
      errors: [
        name === "init"
          ? "--config does not apply to init: it writes the config in the folder it runs in (--cwd)"
          : "--config does not apply to cache",
      ],
    };
  }
  if (maxMemory !== undefined && !ANALYSES.includes(name)) {
    return {
      ok: false,
      errors: [`--max-memory only applies to ${ANALYSES.join(", ")}`],
    };
  }
  if (name !== "check" && verbose !== undefined) {
    return { ok: false, errors: ["--verbose only applies to check"] };
  }
  if (name !== "init" && ci !== undefined) {
    return { ok: false, errors: ["--ci only applies to init"] };
  }
  if (name !== "check" && rule !== undefined) {
    return { ok: false, errors: ["--rule only applies to check"] };
  }
  if (name !== "check" && group !== undefined) {
    return { ok: false, errors: ["--group only applies to check"] };
  }
  if (!ANALYSES.includes(name) && noCache !== undefined) {
    return {
      ok: false,
      errors: [`--no-cache only applies to ${ANALYSES.join(", ")}`],
    };
  }
  if (name !== "check" && noBaseline !== undefined) {
    return { ok: false, errors: ["--no-baseline only applies to check"] };
  }
  if (name !== "check" && timing) {
    return { ok: false, errors: ["--timing only applies to check"] };
  }
  if (timing && fix) {
    return { ok: false, errors: ["--timing does not apply with --fix"] };
  }
  if (name !== "check" && noIgnores !== undefined) {
    return { ok: false, errors: ["--no-ignores only applies to check"] };
  }
  if (name !== "check" && name !== "init" && changed !== undefined) {
    return { ok: false, errors: ["--changed only applies to check and init"] };
  }
  if (name === "check" && changed !== undefined && staged) {
    return { ok: false, errors: ["use --changed or --staged, not both"] };
  }
  if (name !== "check" && staged) {
    return { ok: false, errors: ["--staged only applies to check"] };
  }
  if (fix && staged) {
    return {
      ok: false,
      errors: ["fixes apply to your working files; run `--fix` without `--staged`"],
    };
  }
  if (name !== "check" && fix) {
    return { ok: false, errors: ["--fix only applies to check"] };
  }
  if (dryRun && !fix) {
    return { ok: false, errors: ["--dry-run goes with --fix: `stateward check --fix --dry-run`"] };
  }
  if (verifyFixes && (name !== "check" || format !== "json")) {
    return {
      ok: false,
      errors: [
        "--verify-fixes goes with --format json: `stateward check --format json --verify-fixes`",
      ],
    };
  }
  if (fix && (format === "json" || format === "github")) {
    return { ok: false, errors: ["--fix prints plain text; leave out --format"] };
  }
  if (fix && max !== undefined) {
    return { ok: false, errors: ["--max does not apply with --fix"] };
  }
  if (name !== "init" && hook !== undefined) {
    return { ok: false, errors: ["--hook only applies to init"] };
  }
  if (name !== "init" && force) {
    return { ok: false, errors: ["--force only applies to init"] };
  }
  if (name === "init" && changed !== undefined) {
    if (ci === undefined) {
      return { ok: false, errors: ["--changed on init goes with --ci github"] };
    }
    if (changed.base !== undefined) {
      return {
        ok: false,
        errors: [
          `init --changed takes no base, got "${changed.base}"; the workflow uses the branch the pull request targets`,
        ],
      };
    }
  }
  if (name !== "baseline" && prune) {
    return { ok: false, errors: ["--prune only applies to baseline"] };
  }
  if (name !== "next" && baseline) {
    return { ok: false, errors: ["--baseline only applies to next"] };
  }
  if (rule !== undefined && group !== undefined) {
    return { ok: false, errors: ["use --rule or --group, not both"] };
  }
  if (name !== "next" && anyway) {
    return { ok: false, errors: ["--anyway only applies to next"] };
  }
  if (name !== "init" && yes) {
    return { ok: false, errors: ["--yes only applies to init"] };
  }
  if (name !== "init" && packs !== undefined) {
    return { ok: false, errors: ["--packs only applies to init"] };
  }
  if (name !== "init" && preset !== undefined) {
    return { ok: false, errors: ["--preset only applies to init"] };
  }
  // "github" was refused above for every command but check.
  const plainFormat: OutputFormat = format === "json" ? "json" : "pretty";
  switch (name) {
    case "check":
      return positionals.length === 0
        ? {
            ok: true,
            value: {
              kind: "check",
              format: format ?? "pretty",
              formatGiven: format !== undefined,
              cwd,
              config,
              verbose,
              max,
              maxWarnings,
              rule,
              group,
              noCache,
              noBaseline,
              noIgnores,
              scope: scopeOf(changed, staged),
              fix,
              dryRun,
              timing,
              verifyFixes,
            },
          }
        : { ok: false, errors: [`check takes no arguments, got "${positionals.join(" ")}"`] };
    case "baseline":
      return positionals.length === 0
        ? { ok: true, value: { kind: "baseline", prune, cwd, config, noCache } }
        : { ok: false, errors: [`baseline takes no arguments, got "${positionals.join(" ")}"`] };
    case "coverage":
      return positionals.length === 0
        ? { ok: true, value: { kind: "coverage", format: plainFormat, cwd, config, noCache } }
        : { ok: false, errors: [`coverage takes no arguments, got "${positionals.join(" ")}"`] };
    case "plan":
      return positionals.length === 0
        ? { ok: true, value: { kind: "plan", format: plainFormat, cwd, config, noCache } }
        : { ok: false, errors: [`plan takes no arguments, got "${positionals.join(" ")}"`] };
    case "next":
      return positionals.length === 0
        ? { ok: true, value: { kind: "next", anyway, baseline, cwd, config, noCache } }
        : { ok: false, errors: [`next takes no arguments, got "${positionals.join(" ")}"`] };
    case "init":
      return positionals.length === 0
        ? {
            ok: true,
            value: {
              kind: "init",
              cwd,
              packs,
              preset,
              yes,
              ci,
              changed: changed !== undefined,
              hook,
              force,
            },
          }
        : { ok: false, errors: [`init takes no arguments, got "${positionals.join(" ")}"`] };
    case "explain": {
      const [ruleId, ...extra] = positionals;
      if (ruleId === undefined || extra.length > 0) {
        return {
          ok: false,
          errors: ["explain needs one rule, e.g. stateward explain records/lookup-misses-key"],
        };
      }
      return { ok: true, value: { kind: "explain", ruleId, cwd, config } };
    }
    case "deps":
      return positionals.length === 0
        ? { ok: true, value: { kind: "deps", format: plainFormat, cwd, config, noCache } }
        : { ok: false, errors: [`deps takes no arguments, got "${positionals.join(" ")}"`] };
    case "guarantees":
      return positionals.length === 0
        ? { ok: true, value: { kind: "guarantees", format: plainFormat, cwd, config, noCache } }
        : {
            ok: false,
            errors: [`guarantees takes no arguments, got "${positionals.join(" ")}"`],
          };
    case "cache": {
      const [action, ...extra] = positionals;
      if ((action !== "stats" && action !== "clean") || extra.length > 0) {
        return {
          ok: false,
          errors: ['cache needs "stats" (show its size) or "clean" (delete it)'],
        };
      }
      return { ok: true, value: { kind: "cache", action, cwd } };
    }
    default:
      return { ok: false, errors: [`unknown command "${name}"`] };
  }
}
