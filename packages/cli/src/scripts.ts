/**
 * Finding stateward behind a package.json script: a workflow or a hook that runs `yarn lint`, where
 * the `lint` script runs `stateward check`, already checks the project, and `init` must not add a
 * second check next to it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** A command that runs the check: the `stateward` bin, or its file in `node_modules`. */
const RUNS_CHECK = /(?:\bstateward|stateward\/dist\/bin\.js)\s+check\b/;

/**
 * `npm run lint`, `npm run-script lint`, `npm test`, `yarn lint`, `yarn run lint`, `pnpm lint`,
 * `pnpm run lint`, `bun run lint`, with flags such as `--silent` before the name. A name that is
 * not a script (`yarn install`) is dropped by the caller.
 */
const INVOCATION =
  /\b(npm|pnpm|yarn|bun)((?:\s+-{1,2}[\w-]+)*)(?:\s+(?:run|run-script))?((?:\s+-{1,2}[\w-]+)*)\s+([\w:.@/-]+)/g;

/** How many scripts deep a chain is followed: `lint` → `lint:types` → `check:state`. */
const MAX_DEPTH = 2;

/** Where stateward runs: the command as the text wrote it, and the script it names. */
export type ScriptRun = { invocation: string; script: string };

/** The `scripts` of a package.json text; empty when it has none or is not valid JSON. */
export function scriptsOf(packageJsonText: string | undefined): ReadonlyMap<string, string> {
  if (packageJsonText === undefined) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return new Map();
  }
  if (typeof parsed !== "object" || parsed === null || !("scripts" in parsed)) return new Map();
  const scripts = parsed.scripts;
  if (typeof scripts !== "object" || scripts === null) return new Map();
  return new Map(
    Object.entries(scripts).flatMap(([name, command]) =>
      typeof command === "string" ? [[name, command]] : [],
    ),
  );
}

function invocations(text: string, scripts: ReadonlyMap<string, string>): ScriptRun[] {
  return [...text.matchAll(INVOCATION)].flatMap((match) => {
    const script = match[4];
    return script !== undefined && scripts.has(script) ? [{ invocation: match[0], script }] : [];
  });
}

function runsCheck(script: string, scripts: ReadonlyMap<string, string>, depth: number): boolean {
  const command = scripts.get(script) ?? "";
  if (RUNS_CHECK.test(command)) return true;
  return (
    depth < MAX_DEPTH &&
    invocations(command, scripts).some((inner) => runsCheck(inner.script, scripts, depth + 1))
  );
}

/**
 * The first script `text` (a workflow, a hook) runs that runs `stateward check`, directly or
 * through up to two more scripts; undefined when there is none.
 */
export function scriptRunningStateward(
  text: string,
  scripts: ReadonlyMap<string, string>,
): ScriptRun | undefined {
  return invocations(text, scripts).find((run) => runsCheck(run.script, scripts, 0));
}

/** "`yarn lint` (package.json script `lint`)", for a message. */
export function describeScriptRun(run: ScriptRun): string {
  return `\`${run.invocation.replace(/\s+/g, " ")}\` (package.json script \`${run.script}\`)`;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The scripts of the package.json files in `folders` (the repository root, then the project's
 * folder in a monorepo), the first folder's script winning a name both have.
 */
export function projectScripts(...folders: readonly string[]): ReadonlyMap<string, string> {
  const merged = new Map<string, string>();
  for (const folder of new Set(folders)) {
    for (const [name, command] of scriptsOf(readText(path.join(folder, "package.json")))) {
      if (!merged.has(name)) merged.set(name, command);
    }
  }
  return merged;
}
