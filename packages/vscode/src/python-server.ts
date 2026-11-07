import { execFile } from "node:child_process";
import path from "node:path";

/** The oldest py-stateward whose CLI has `server`. */
export const MIN_PYTHON_VERSION = "0.1.0a6";

/** What the developer runs to install it; the extension never installs or bundles it. */
export const PYTHON_INSTALL_COMMANDS = ["uv add --dev py-stateward", "pip install py-stateward"];

export type PythonServerLocation = {
  kind: "configured" | "environment" | "path";
  /** The `py-stateward` program; the client runs `<command> server`. */
  command: string;
};

export type PythonLookup = {
  /** The folder the server checks: its `.venv` or `venv` is the project's environment. */
  folder: string;
  /** The `stateward.python.serverPath` setting, "" when unset. */
  configured: string;
  /** `process.platform`: decides the environment's layout and the program's name. */
  platform: NodeJS.Platform;
  /** The PATH variable as the extension host sees it, undefined when unset. */
  pathVariable: string | undefined;
  exists: (file: string) => boolean;
};

/** The environment folders a project keeps beside its pyproject.toml, in the order looked at. */
const ENVIRONMENTS = [".venv", "venv"] as const;

/**
 * Where `py-stateward` is for `folder`: the `stateward.python.serverPath` setting when that file
 * exists, then the project's environment (`.venv/bin/py-stateward`, `venv/…`;
 * `Scripts\py-stateward.exe` on Windows), then each folder of PATH. The version the project
 * installed is the one the editor runs, as with the CLI. Undefined when none exists.
 */
export function locatePythonServer(lookup: PythonLookup): PythonServerLocation | undefined {
  const { folder, configured, platform, pathVariable, exists } = lookup;
  if (configured !== "" && exists(configured)) return { kind: "configured", command: configured };
  const windows = platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const program = windows ? "py-stateward.exe" : "py-stateward";
  for (const environment of ENVIRONMENTS) {
    const command = paths.join(folder, environment, windows ? "Scripts" : "bin", program);
    if (exists(command)) return { kind: "environment", command };
  }
  for (const entry of (pathVariable ?? "").split(windows ? ";" : ":")) {
    if (entry === "") continue;
    const command = paths.join(entry, program);
    if (exists(command)) return { kind: "path", command };
  }
  return undefined;
}

export type PythonServerSettings = {
  /** `stateward.python.pyrefly`: the Pyrefly program, "" for the server's own lookup. */
  pyrefly: string;
  /** `stateward.python.checkerProcesses`: how many Pyrefly processes may answer at once. */
  checkerProcesses: number;
};

/** The arguments of `py-stateward` that start the language server with these settings. */
export function pythonServerArgs(settings: PythonServerSettings): string[] {
  const processes = Math.max(1, Math.floor(settings.checkerProcesses));
  return [
    "server",
    ...(settings.pyrefly === "" ? [] : ["--pyrefly", settings.pyrefly]),
    "--checker-processes",
    String(processes),
  ];
}

type Version = { release: readonly number[]; pre: readonly [number, number] | undefined };

/** The stages of a pre-release, in order; a final release sorts after all of them. */
const PRE_STAGES = ["a", "b", "rc"] as const;

/** A version as PyPI spells it (`0.1.0a6`, `1.0.0rc2`, `1.2.0`); undefined for anything else. */
export function parsePythonVersion(text: string): Version | undefined {
  const match = /^(\d+(?:\.\d+)*)(?:(a|b|rc)(\d+))?$/.exec(text.trim());
  if (match === null) return undefined;
  const [, release = "", stage, number] = match;
  const stageIndex = PRE_STAGES.findIndex((candidate) => candidate === stage);
  return {
    release: release.split(".").map(Number),
    pre: stageIndex === -1 ? undefined : [stageIndex, Number(number)],
  };
}

function compareVersions(a: Version, b: Version): number {
  const length = Math.max(a.release.length, b.release.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.release[index] ?? 0) - (b.release[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.pre === undefined || b.pre === undefined) {
    return (a.pre === undefined ? 1 : 0) - (b.pre === undefined ? 1 : 0);
  }
  return a.pre[0] - b.pre[0] || a.pre[1] - b.pre[1];
}

export type VersionCheck =
  | { kind: "ok"; version: string }
  | { kind: "too-old"; version: string }
  | { kind: "unreadable"; output: string };

/** Reads the output of `py-stateward --version` (`py-stateward 0.1.0a6`). */
export function checkPythonVersion(output: string): VersionCheck {
  const version = /^py-stateward\s+(\S+)/.exec(output.trim())?.[1];
  const parsed = version === undefined ? undefined : parsePythonVersion(version);
  const minimum = parsePythonVersion(MIN_PYTHON_VERSION);
  if (version === undefined || parsed === undefined || minimum === undefined) {
    return { kind: "unreadable", output: output.trim() };
  }
  return compareVersions(parsed, minimum) < 0
    ? { kind: "too-old", version }
    : { kind: "ok", version };
}

/** The one message shown when a Python folder has no usable server. */
export function missingServerMessage(
  folderName: string,
  problem: { kind: "missing" } | { kind: "too-old"; version: string },
): string {
  const install = `Install it in the project (\`${PYTHON_INSTALL_COMMANDS.join("` or `")}\`), then run "Stateward: Restart Python server".`;
  return problem.kind === "missing"
    ? `Stateward could not find py-stateward for ${folderName}. ${install}`
    : `Stateward needs py-stateward ${MIN_PYTHON_VERSION} or later for ${folderName}; it found ${problem.version}. ${install}`;
}

/**
 * Runs `<command> --version` and checks it: `missing` when it does not run (no such program, not
 * executable, or no answer within 15 seconds).
 */
export function probePythonServer(command: string): Promise<VersionCheck | { kind: "missing" }> {
  return new Promise((resolve) => {
    execFile(command, ["--version"], { timeout: 15_000 }, (error, stdout) => {
      resolve(error === null ? checkPythonVersion(stdout) : { kind: "missing" });
    });
  });
}
