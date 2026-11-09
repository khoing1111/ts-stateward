import { execFileSync } from "node:child_process";
import path from "node:path";
import { toTypeScriptPath } from "@stateward/core/internal";
import type { CheckResult, Finding } from "@stateward/core/internal";
import { realPath } from "./real-path.js";

/** Which files `check` reports on: those changed since a base, or those staged for commit. */
export type Scope = { kind: "changed"; base: string | undefined } | { kind: "staged" };

/** Thrown with a message for the developer: not a repository, an unknown base, git missing. */
export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

const CODE_FILE = /\.[cm]?tsx?$/;
/** The files whose staged text `--staged` checks: what the programs read as code. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

type Git = (args: readonly string[]) => string;

function gitIn(cwd: string): Git {
  return (args) => {
    try {
      return execFileSync("git", [...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new GitError("git is not installed, or not on your PATH");
      }
      throw new GitFailure(error instanceof Error ? error.message : String(error));
    }
  };
}

/** A git command that exited with an error; callers turn it into a message that says what to do. */
class GitFailure extends Error {}

function attempt(git: Git, args: readonly string[]): string | undefined {
  try {
    return git(args).trim();
  } catch (error) {
    if (error instanceof GitFailure) return undefined;
    throw error;
  }
}

function hasCommit(git: Git, name: string): boolean {
  return attempt(git, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]) !== undefined;
}

/** `main`, `master` or the branch `origin/HEAD` points at: where this branch most likely started. */
function defaultBase(git: Git): string {
  const candidates = ["origin/HEAD", "main", "master", "origin/main", "origin/master"];
  const found = candidates.find((name) => hasCommit(git, name));
  if (found === undefined) {
    throw new GitError(
      "`main` is not a branch here, and neither are `master` or `origin/HEAD`; pass the base, e.g. `--changed origin/develop`",
    );
  }
  return found;
}

function mergeBase(git: Git, base: string, given: boolean): string {
  if (!hasCommit(git, base)) {
    throw new GitError(
      given
        ? `\`${base}\` is not a branch or commit here; pass the base, e.g. \`--changed origin/develop\` (in CI, fetch it first: \`fetch-depth: 0\` on checkout)`
        : `\`${base}\` is not a branch here; pass the base, e.g. \`--changed origin/develop\``,
    );
  }
  const common = attempt(git, ["merge-base", "HEAD", base]);
  if (common === undefined || common === "") {
    throw new GitError(
      `git found no common history between your branch and \`${base}\`; in CI, check out the full history (\`fetch-depth: 0\`)`,
    );
  }
  return common;
}

function splitNul(text: string): string[] {
  return text.split("\0").filter((name) => name !== "");
}

/** The root of the git repository `cwd` is in (real path), or undefined when it is in none or git is missing. */
export function gitRoot(cwd: string): string | undefined {
  try {
    const top = attempt(gitIn(cwd), ["rev-parse", "--show-toplevel"]);
    return top === undefined || top === "" ? undefined : realPath(top);
  } catch (error) {
    if (error instanceof GitError) return undefined;
    throw error;
  }
}

/**
 * The repository's default branch: where `origin/HEAD` points, else the branch checked out now;
 * undefined when git cannot say (no repository, a detached HEAD, nothing committed).
 */
export function defaultBranch(cwd: string): string | undefined {
  try {
    const git = gitIn(cwd);
    const head = attempt(git, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const prefix = "refs/remotes/origin/";
    if (head?.startsWith(prefix) === true) return head.slice(prefix.length);
    const current = attempt(git, ["branch", "--show-current"]);
    return current === undefined || current === "" ? undefined : current;
  } catch (error) {
    if (error instanceof GitError) return undefined;
    throw error;
  }
}

export type Changed = {
  /** Absolute paths of the files in the scope that are inside the project folder. */
  files: ReadonlySet<string>;
  /** The base the changes are measured from; undefined for `--staged`. */
  base: string | undefined;
  /**
   * For `--staged`: the staged text of each staged code file, by absolute path, checked in place
   * of the file on disk, so what is checked is what will be committed. Empty otherwise. Keys are in
   * TypeScript's form (`C:/p/a.ts` on Windows), as the engine and its findings name files; read
   * them with `stagedTextOf`.
   */
  overlays: ReadonlyMap<string, string>;
};

/**
 * The files in `scope` that are inside `cwd` (the project), from git: a monorepo's other packages
 * are not this project's files. Throws `GitError` when git cannot tell.
 */
export function changedFiles(cwd: string, scope: Scope): Changed {
  const flag = scope.kind === "changed" ? "--changed" : "--staged";
  const probe = gitIn(cwd);
  const top = attempt(probe, ["rev-parse", "--show-toplevel"]);
  if (top === undefined || top === "") {
    throw new GitError(`${flag} needs a git repository, and ${cwd} is not inside one`);
  }
  const root = realPath(top);
  const git = gitIn(root);
  let names: string[];
  let base: string | undefined;
  const overlays = new Map<string, string>();
  if (scope.kind === "staged") {
    names = splitNul(git(["diff", "--cached", "--name-only", "-z"]));
    // Deleted files have no staged text; they are left out of the overlays, not of the scope.
    for (const name of splitNul(
      git(["diff", "--cached", "--name-only", "--diff-filter=d", "-z"]),
    )) {
      if (SOURCE_FILE.test(name)) overlays.set(path.join(root, name), git(["show", `:${name}`]));
    }
  } else {
    base = scope.base ?? defaultBase(git);
    const common = mergeBase(git, base, scope.base !== undefined);
    // Against the merge base: the commits of this branch, plus what is staged or unsaved to git.
    names = [
      ...splitNul(git(["diff", "--name-only", "-z", common])),
      ...splitNul(git(["ls-files", "--others", "--exclude-standard", "-z"])),
    ];
  }
  const project = realPath(cwd);
  const inProject = (file: string): boolean => !path.relative(project, file).startsWith("..");
  const files = names.map((name) => realPath(path.join(root, name))).filter(inProject);
  // The program reads the project's files as `cwd` spells them, which may go through a link: the
  // staged texts are keyed the same way, or the program never finds them.
  const asProgramReads = (file: string): string => path.resolve(cwd, path.relative(project, file));
  return {
    files: new Set(files),
    base,
    overlays: new Map(
      [...overlays]
        .filter(([file]) => inProject(file))
        .map(([file, text]) => [toTypeScriptPath(asProgramReads(file)), text] as const),
    ),
  };
}

/** The staged text of `file`, whichever way the path is written (`C:\p\a.ts` or `C:/p/a.ts`). */
export function stagedTextOf(
  overlays: ReadonlyMap<string, string>,
  file: string,
): string | undefined {
  return overlays.get(toTypeScriptPath(file));
}

export type Scoped = {
  result: CheckResult;
  /** Changed files that hold code. */
  files: number;
  /**
   * Problems in other files that this run does not show. Places not checked are not problems and
   * are not counted; a finding cut by the per-file cap (`hidden`) is counted as the problem it is.
   */
  elsewhere: number;
};

/**
 * Keeps the findings that are in a changed file or point into one through a related location (a
 * change can break code that did not change). A rule failure stays: the check would be incomplete.
 */
export function scopeResult(result: CheckResult, changed: ReadonlySet<string>): Scoped {
  const cache = new Map<string, boolean>();
  const isChanged = (file: string): boolean => {
    const known = cache.get(file);
    if (known !== undefined) return known;
    const answer = changed.has(realPath(file));
    cache.set(file, answer);
    return answer;
  };
  const keeps = (finding: Finding): boolean =>
    finding.kind === "failure" ||
    isChanged(finding.location.file) ||
    (finding.kind === "problem" && finding.related.some((entry) => isChanged(entry.location.file)));
  const findings = result.findings.filter(keeps);
  const hidden = result.hidden.filter((entry) => isChanged(entry.file));
  const sum = (counts: readonly { count: number }[]): number =>
    counts.reduce((total, entry) => total + entry.count, 0);
  const problems = (list: readonly Finding[]): number =>
    list.filter((finding) => finding.kind === "problem").length;
  const elsewhere =
    problems(result.findings) - problems(findings) + sum(result.hidden) - sum(hidden);
  return {
    result: { ...result, findings, hidden },
    files: [...changed].filter((file) => CODE_FILE.test(file)).length,
    elsewhere,
  };
}
