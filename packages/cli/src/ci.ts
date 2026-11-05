import { CACHE_SUBDIR } from "@stateward/core/internal";
import type { PackageManager } from "./init.js";
import { scriptRunningStateward } from "./scripts.js";
import type { ScriptRun } from "./scripts.js";

/** The Node version of the workflow when the project names none. */
export const DEFAULT_NODE = "22";

/** What the project says about Yarn: 1 (classic) installs differently from 2 and newer. */
export function isYarnClassic(input: {
  packageJsonText: string | undefined;
  lockfileText: string | undefined;
  hasFile: (file: string) => boolean;
}): boolean {
  const declared = /"packageManager"\s*:\s*"yarn@(\d+)/.exec(input.packageJsonText ?? "");
  if (declared?.[1] !== undefined) return declared[1] === "1";
  const lockfile = input.lockfileText ?? "";
  if (/^# yarn lockfile v1$/m.test(lockfile)) return true;
  if (/^__metadata:/m.test(lockfile)) return false;
  return !input.hasFile(".yarnrc.yml");
}

/**
 * The Node version the project asks for: `engines.node` (a range is fine for setup-node), else
 * `.nvmrc`, else `.node-version`; undefined when it names none.
 */
export function nodeVersionOf(input: {
  packageJsonText: string | undefined;
  nvmrc: string | undefined;
  nodeVersionFile: string | undefined;
}): string | undefined {
  const engines = /"engines"\s*:\s*\{[^}]*?"node"\s*:\s*"([^"]+)"/.exec(
    input.packageJsonText ?? "",
  );
  const candidates = [engines?.[1], input.nvmrc, input.nodeVersionFile];
  for (const candidate of candidates) {
    const version = candidate?.trim().replace(/^v(?=\d)/, "") ?? "";
    if (version !== "") return version;
  }
  return undefined;
}

/**
 * The first workflow in `files` (name, text) that runs `stateward check`, itself or through a
 * package.json script (`via`): `yarn lint` where `lint` runs `stateward check`.
 */
export function workflowRunningStateward(
  files: readonly { name: string; text: string }[],
  scripts: ReadonlyMap<string, string> = new Map(),
): { name: string; via: ScriptRun | undefined } | undefined {
  for (const file of files) {
    if (/\bstateward\s+check\b/.test(file.text)) return { name: file.name, via: undefined };
    const via = scriptRunningStateward(file.text, scripts);
    if (via !== undefined) return { name: file.name, via };
  }
  return undefined;
}

/** Where `init --ci github` writes the workflow. */
export const WORKFLOW_FILE = ".github/workflows/stateward.yml";

type Setup = {
  /** The lockfile the cache key hashes. */
  lockfile: string;
  install: string;
  /** Steps that must run before setup-node. */
  before: readonly string[];
  /** The `cache:` value of setup-node, if it has one for this manager. */
  nodeCache: "npm" | "yarn" | "pnpm" | undefined;
};

function setupFor(
  manager: PackageManager,
  hasFile: (file: string) => boolean,
  lockfile: string | undefined,
  yarnClassic: boolean,
): Setup {
  switch (manager) {
    case "npm":
      // Without a lockfile `npm ci` fails, and package.json is what the install follows.
      return lockfile === undefined
        ? { lockfile: "package.json", install: "npm install", before: [], nodeCache: "npm" }
        : { lockfile, install: "npm ci", before: [], nodeCache: "npm" };
    case "pnpm":
      return {
        lockfile: lockfile ?? "pnpm-lock.yaml",
        install: "pnpm install --frozen-lockfile",
        before: [
          '      # Reads the pnpm version from "packageManager" in package.json; add `version:` if it has none.',
          "      - uses: pnpm/action-setup@v4",
        ],
        nodeCache: "pnpm",
      };
    case "yarn":
      return {
        lockfile: lockfile ?? "yarn.lock",
        // Yarn 2 and newer do not know --frozen-lockfile; Yarn 1 does not know --immutable.
        install: yarnClassic ? "yarn install --frozen-lockfile" : "yarn install --immutable",
        before: [],
        nodeCache: "yarn",
      };
    case "bun":
      return {
        lockfile: lockfile ?? "bun.lock",
        install: "bun install --frozen-lockfile",
        before: [],
        nodeCache: undefined,
      };
    default: {
      const unreachable: never = manager;
      return unreachable;
    }
  }
}

/**
 * The text of `.github/workflows/stateward.yml`. The cache is restored and saved in two steps so
 * that it is saved even when the check fails: a check with findings is exactly the run to remember.
 */
export function renderWorkflow(input: {
  manager: PackageManager;
  lockfile: string | undefined;
  version: string;
  hasFile: (file: string) => boolean;
  /** Yarn 1 (classic), as `isYarnClassic` says; matters only for yarn. */
  yarnClassic?: boolean;
  /** The Node version to set up (`nodeVersionOf`); `DEFAULT_NODE` when left out. */
  nodeVersion?: string | undefined;
  /** The branch a push to runs the check: the repository's default branch; `main` when left out. */
  branch?: string;
  /** Pull requests report only the files they change; pushes to main still report everything. */
  changed?: boolean;
  /**
   * The project's folder from the repository root, with `/`, for a package of a monorepo: the
   * install runs at the root, stateward in this folder. Left out, the project is the root.
   */
  directory?: string;
}): string {
  const setup = setupFor(
    input.manager,
    input.hasFile,
    input.lockfile,
    input.yarnClassic ?? !input.hasFile(".yarnrc.yml"),
  );
  const prefix = `stateward-\${{ runner.os }}-${input.version}-\${{ hashFiles('${setup.lockfile}') }}`;
  const changed = input.changed === true;
  const given = input.branch ?? "main";
  const branch = /^[\w./-]+$/.test(given) ? given : JSON.stringify(given);
  // A plain number stays a number; a range or a name (">=20", "lts/*") is quoted for YAML.
  const version = input.nodeVersion ?? DEFAULT_NODE;
  const node = /^\d+$/.test(version) ? version : JSON.stringify(version);
  const inProject = (file: string): string =>
    input.directory === undefined ? file : `${input.directory}/${file}`;
  const configHash = `\${{ hashFiles('${inProject("stateward.config.*")}') }}`;
  const cachePath = inProject(CACHE_SUBDIR.split("\\").join("/"));
  const where =
    input.directory === undefined ? [] : [`        working-directory: ${input.directory}`];
  /** A step that runs stateward, in the project's folder. */
  const check = (run: string, condition?: string): string[] =>
    condition === undefined
      ? [`      - run: ${run}`, ...where]
      : [`      - if: ${condition}`, `        run: ${run}`, ...where];
  const lines = [
    "# Written by `stateward init --ci github`.",
    "#",
    "# The install step needs stateward and its packs in your project's devDependencies",
    "# (`npm install --save-dev stateward`, and the packs `init` named).",
    "name: stateward",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    `    branches: [${branch}]`,
    "",
    "jobs:",
    "  check:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...(changed
      ? [
          "        with:",
          "          # The whole history, so stateward can find where the pull request branched off.",
          "          fetch-depth: 0",
        ]
      : []),
    ...setup.before,
    "      - uses: actions/setup-node@v4",
    "        with:",
    `          node-version: ${node}`,
    ...(setup.nodeCache === undefined ? [] : [`          cache: ${setup.nodeCache}`]),
    ...(input.manager === "bun" ? ["      - uses: oven-sh/setup-bun@v2"] : []),
    `      - run: ${setup.install}`,
    "      # Stateward re-checks only the files that changed since the last run. The cache is saved",
    "      # under a new key each run (the commit), and the newest earlier one is restored.",
    "      - uses: actions/cache/restore@v4",
    "        with:",
    `          path: ${cachePath}`,
    `          key: ${prefix}-${configHash}-\${{ github.sha }}`,
    "          restore-keys: |",
    `            ${prefix}-${configHash}-`,
    `            ${prefix}-`,
    ...(changed
      ? [
          ...check(
            "npx --no stateward check --format github --changed origin/${{ github.base_ref }}",
            "github.event_name == 'pull_request'",
          ),
          ...check(
            "npx --no stateward check --format github",
            "github.event_name != 'pull_request'",
          ),
        ]
      : check("npx --no stateward check --format github")),
    "      - uses: actions/cache/save@v4",
    "        if: always()",
    "        with:",
    `          path: ${cachePath}`,
    `          key: ${prefix}-${configHash}-\${{ github.sha }}`,
    "",
  ];
  return lines.join("\n");
}
