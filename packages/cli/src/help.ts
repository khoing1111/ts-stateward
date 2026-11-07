/** The text of `stateward --help` and `stateward <command> --help`. One place, so they cannot drift apart. */

type CommandHelp = {
  /** The usage line, after "stateward ". */
  usage: string;
  /** What it does, in a sentence. */
  summary: string;
  options: readonly (readonly [flag: string, meaning: string])[];
  /** One example command line, with what it does. */
  example: readonly [command: string, meaning: string];
};

const CWD: readonly [string, string] = [
  "--cwd <dir>",
  "your project's folder, if you are not in it",
];
const CONFIG: readonly [string, string] = [
  "--config <file>",
  "use this config; without it, the nearest stateward.config.* in your folder or above it (up to the repository's or workspace's root)",
];
const FORMAT: readonly [string, string] = [
  "--format pretty|json",
  "pretty to read (the default), json for scripts",
];

export const COMMAND_HELP = {
  check: {
    usage:
      "check [--format pretty|json|github] [--max <n>] [--max-warnings <n>] [--rule <rule> | --group <group>] [--no-cache] [--no-baseline] [--no-ignores] [--changed [<base>] | --staged] [--verify-fixes] [--fix [--dry-run]] [--verbose] [--timing] [--max-memory <MB>] [--config <file>] [--cwd <dir>]",
    summary:
      "List the problems in your code, each with the change to make. Exit code: 0 when there is no error, 1 when there is an error (or more warnings than --max-warnings), 2 when stateward could not run, or a rule failed.",
    options: [
      [
        "--format pretty|json|github",
        "pretty to read (the default), json for scripts, github to show problems on a pull request in GitHub Actions",
      ],
      ["--max <n>", "show only the n most serious problems (the count at the end still has all)"],
      ["--max-warnings <n>", "exit with 1 when there are more than n warnings (0 allows none)"],
      ["--rule <rule>", "check one rule only, e.g. records/lookup-misses-key"],
      ["--group <group>", "check one group of rules only, e.g. unions/cases"],
      ["--no-cache", "check every file again instead of reusing earlier results"],
      ["--no-baseline", "also show the problems you accepted with `stateward baseline`"],
      ["--no-ignores", "also show the problems your `// stateward-ignore` comments cover"],
      [
        "--changed [<base>]",
        "show only problems in files changed since <base> (default: where your branch left main) and in files you have not committed yet; the whole project is still checked",
      ],
      [
        "--staged",
        "check what will be committed: the staged version of the staged files, and show only their problems (for a pre-commit hook)",
      ],
      [
        "--fix",
        "apply the fixes that are safe without review, check again, and say what is left; with --rule, --group and --changed it fixes only those; accepted (baselined) problems are not fixed",
      ],
      ["--dry-run", "with --fix: print what would change as a diff and write nothing"],
      [
        "--verify-fixes",
        'with --format json: try each fix on a copy of the code and mark it "verified": true or false, listing the ones that do not compile under "rejected" (slower: by default fixes are listed with "verified": null, not tried; --fix and the editor always try them)',
      ],
      [
        "--verbose",
        "list the places not checked (by default only counted in the summary), and say which config and which tsconfig projects were used, and how many files each had",
      ],
      [
        "--timing",
        "after the summary, say where the time went: building the programs, then each rule, slowest first, with its share of the check (to find a slow rule)",
      ],
      [
        "--max-memory <MB>",
        "the memory stateward may use, e.g. 6144 for a large project that ran out (default: 4096, or 3/4 of the machine's memory if less; also `maxMemory` in the config)",
      ],
      CONFIG,
      CWD,
    ],
    example: ["stateward check --rule records/lookup-misses-key", "only that rule's problems"],
  },
  baseline: {
    usage: "baseline [--prune] [--config <file>] [--cwd <dir>]",
    summary: "Accept the problems you have today, so that from now on only new ones fail `check`.",
    options: [["--prune", "drop accepted problems you have fixed since"], CONFIG, CWD],
    example: ["stateward baseline", "save today's problems in stateward.baseline.json"],
  },
  plan: {
    usage: "plan [--format pretty|json] [--config <file>] [--cwd <dir>]",
    summary:
      "Show every rule with how many places it flags in your code, in the order to turn them on.",
    options: [FORMAT, CONFIG, CWD],
    example: ["stateward plan", "decide where to start"],
  },
  next: {
    usage: "next [--anyway] [--baseline] [--config <file>] [--cwd <dir>]",
    summary:
      "Turn on the next rule and say how many places it flags. Waits while the last rule you turned on still has problems.",
    options: [
      ["--anyway", "move on even though the last rule still has problems"],
      ["--baseline", "accept the new rule's problems at once"],
      CONFIG,
      CWD,
    ],
    example: ["stateward next", "turn on the next rule; then run `stateward check`"],
  },
  coverage: {
    usage: "coverage [--format pretty|json] [--config <file>] [--cwd <dir>]",
    summary:
      "Show, per pack, the code stateward cannot check yet, and the change that would let it.",
    options: [FORMAT, CONFIG, CWD],
    example: ["stateward coverage", "see what is not checked yet"],
  },
  init: {
    usage:
      "init [--packs <list>] [--preset recommended|strict] [--yes] [--ci github [--changed] [--force]] [--hook [pre-commit|pre-push]] [--cwd <dir>]",
    summary:
      "Set up stateward in your project: write stateward.config.ts and print what to install. Asks a few questions; never overwrites a config.",
    options: [
      [
        "--packs <list>",
        "the packs to use, comma separated: unions, records, async, react-context, errors, ownership, reducers, react",
      ],
      ["--preset recommended|strict", "how strict the rules are"],
      ["--yes", "ask nothing and take the suggested answers"],
      ["--ci github", "also write .github/workflows/stateward.yml (never overwrites one)"],
      ["--changed", "with --ci github: on a pull request, report only the files it changes"],
      [
        "--force",
        "write the workflow (--ci) or the hook line (--hook) even when one already runs stateward, itself or through a package.json script",
      ],
      [
        "--hook [pre-commit|pre-push]",
        "also add a git hook (husky, lefthook, or .git/hooks; never overwrites one): pre-commit runs `stateward check --staged` and can take tens of seconds on a big project; pre-push runs `stateward check --changed` against the upstream before a push",
      ],
      CWD,
    ],
    example: ["stateward init --yes", "set up with the suggested packs, no questions"],
  },
  explain: {
    usage: "explain <rule> [--config <file>] [--cwd <dir>]",
    summary: "Explain a rule: why it matters, what it flags and how to fix it.",
    options: [CONFIG, CWD],
    example: ["stateward explain unions/default-hides-cases", "read that rule's page"],
  },
  deps: {
    usage: "deps [--format pretty|json] [--config <file>] [--cwd <dir>]",
    summary:
      "Show the library functions your code calls and whether stateward knows what they throw (with the errors pack).",
    options: [FORMAT, CONFIG, CWD],
    example: ["stateward deps", "see which library calls are still unknown"],
  },
  guarantees: {
    usage: "guarantees [--format pretty|json] [--config <file>] [--cwd <dir>]",
    summary:
      "List the guarantees your code states (a `RequiredContext`, an `Owned` value), where each is declared, whether stateward proves it, and the readers or writers it covers; a marker nothing uses is listed as unused. Exit code: 0 when every guarantee is proven, unused or not checked, 1 when one is not proven, 2 when stateward could not run.",
    options: [FORMAT, CONFIG, CWD],
    example: ["stateward guarantees", "review every promise and its proof"],
  },
  cache: {
    usage: "cache stats|clean [--cwd <dir>]",
    summary:
      "Show the size of, or delete, stateward's caches: what libraries throw, shared by all your projects (at most 200 MB, or STATEWARD_PACKAGE_CACHE_MAX_MB), and this project's earlier results (at most 200 MB, or STATEWARD_CACHE_MAX_MB). Past its limit, a cache drops what was used longest ago.",
    options: [CWD],
    example: ["stateward cache clean", "free the space it uses"],
  },
} as const satisfies Record<string, CommandHelp>;

export type HelpTopic = keyof typeof COMMAND_HELP;

export function isHelpTopic(name: string): name is HelpTopic {
  return Object.hasOwn(COMMAND_HELP, name);
}

/** The first lines of `stateward --help`, also printed after a bad command line. */
export const USAGE = `usage:
${Object.values(COMMAND_HELP)
  .map((help) => `  stateward ${help.usage}`)
  .join("\n")}`;

export function overviewHelp(): string {
  const names = Object.keys(COMMAND_HELP);
  const width = Math.max(...names.map((name) => name.length));
  const rows = names.map((name) => {
    const summary = isHelpTopic(name) ? COMMAND_HELP[name].summary : "";
    return `  ${name.padEnd(width)}  ${summary}`;
  });
  return [
    "stateward: finds the cases your TypeScript and React code can miss, and says how to fix them.",
    "",
    "usage: stateward <command> [options]",
    "",
    "commands:",
    ...rows,
    "",
    "New here? Run `stateward init`, then `stateward plan` to see where to start.",
    "`stateward <command> --help` shows a command's options; `stateward --version` its version.",
    "",
  ].join("\n");
}

export function commandHelp(topic: HelpTopic): string {
  const help: CommandHelp = COMMAND_HELP[topic];
  const width = Math.max(0, ...help.options.map(([flag]) => flag.length));
  return [
    `usage: stateward ${help.usage}`,
    "",
    help.summary,
    ...(help.options.length === 0
      ? []
      : [
          "",
          "options:",
          ...help.options.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`),
        ]),
    "",
    "example:",
    `  ${help.example[0]}    # ${help.example[1]}`,
    "",
  ].join("\n");
}

/** What follows an error about a command line: that command's usage, or the overview. */
export function usageAfterError(commandName: string | undefined): string {
  if (commandName !== undefined && isHelpTopic(commandName)) {
    return `usage: stateward ${COMMAND_HELP[commandName].usage}\nRun \`stateward ${commandName} --help\` for the options.`;
  }
  if (commandName !== undefined) return "Run `stateward --help` for the commands.";
  return `${USAGE}\nRun \`stateward --help\` for what each does.`;
}
