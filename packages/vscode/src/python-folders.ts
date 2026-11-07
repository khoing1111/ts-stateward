import path from "node:path";
import { parse } from "smol-toml";

export const PYPROJECT = "pyproject.toml";

/** What decides whether a workspace folder gets a Python server. */
export type PythonFolderFacts = {
  /** The folder's pyproject.toml, undefined when it has none. */
  pyproject: string | undefined;
  /** The `stateward.python.enabled` setting for the folder. */
  enabled: boolean;
};

export type PythonQualification =
  | { kind: "serve"; reason: "table" | "setting" }
  | { kind: "skip" }
  | { kind: "unreadable"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the folder gets a Python server: its pyproject.toml has a `[tool.stateward]` table
 * (read with a TOML parser, so a comment or a string that mentions it does not count), or the
 * `stateward.python.enabled` setting is on. A pyproject.toml that is not valid TOML is said, so
 * the developer learns why nothing starts.
 */
export function qualifyPythonFolder(facts: PythonFolderFacts): PythonQualification {
  if (facts.enabled) return { kind: "serve", reason: "setting" };
  if (facts.pyproject === undefined) return { kind: "skip" };
  let parsed: unknown;
  try {
    parsed = parse(facts.pyproject);
  } catch (error) {
    return { kind: "unreadable", reason: error instanceof Error ? error.message : String(error) };
  }
  const tool = isRecord(parsed) ? parsed.tool : undefined;
  return isRecord(tool) && isRecord(tool.stateward)
    ? { kind: "serve", reason: "table" }
    : { kind: "skip" };
}

/** The folder's pyproject.toml path. */
export function pyprojectOf(folder: string): string {
  return path.join(folder, PYPROJECT);
}

/** What the Python client tells its server about besides the `.py` documents it syncs. */
export const PYTHON_WATCH_GLOBS = ["**/*.py", "**/pyproject.toml"] as const;

/** "Stateward: Restart Python server": looks at every folder again and shows a missing server's message again. */
export const PYTHON_RESTART_COMMAND = "stateward.python.restart";
