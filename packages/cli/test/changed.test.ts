import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult, Finding } from "@stateward/core/internal";
import { parseArgs } from "../src/args.js";
import { renderWorkflow } from "../src/ci.js";
import { scopeResult, stagedTextOf } from "../src/changed.js";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));

const ORDER = [
  "records/lookup-misses-key",
  "unions/non-exhaustive-switch",
  "unions/ambiguous-discriminant",
] as const;

/** A function whose switch has a default over a union: one finding of non-exhaustive-switch. */
const BAD = `import type { Status } from "./status.js";

export function shout(status: Status): string {
  switch (status) {
    case "idle":
      return "IDLE";
    default:
      return "OTHER";
  }
}
`;

type Run = { code: ExitCode; stdout: string; stderr: string };

async function run(argv: readonly string[], cwd: string): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

describe("check --changed and --staged", () => {
  let work = "";

  beforeEach(() => {
    work = mkdtempSync(path.join(fixtures, "tmp-"));
    cpSync(path.join(fixtures, "adopt"), work, { recursive: true });
    writeFileSync(
      path.join(work, "stateward.rollout.json"),
      JSON.stringify({ version: 1, enabled: ORDER }),
    );
    writeFileSync(path.join(work, "src", "other.ts"), "export const other = 1;\n");
    // A repository of its own inside the fixtures folder, so git does not see this repository.
    git(work, "init", "-q", "-b", "main");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "start");
    git(work, "checkout", "-q", "-b", "feature");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(work, { recursive: true, force: true });
  });

  it("with nothing changed, says so without analysing and exits 0", async () => {
    const { code, stdout } = await run(["check", "--changed"], work);
    expect(code).toBe(0);
    expect(stdout).toBe("No files of this project changed since `main`.\n");
    expect((await run(["check", "--staged"], work)).stdout).toBe(
      "No files of this project are staged.\n",
    );
  });

  it("counts and reports only files inside the project folder", async () => {
    const app = path.join(work, "app");
    mkdirSync(app);
    git(work, "mv", "src", "app/src");
    git(work, "mv", "tsconfig.json", "app/tsconfig.json");
    git(work, "mv", "stateward.config.mjs", "app/stateward.config.mjs");
    writeFileSync(
      path.join(app, "stateward.rollout.json"),
      JSON.stringify({ version: 1, enabled: ORDER }),
    );
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "move");
    git(work, "checkout", "-q", "-b", "second");
    mkdirSync(path.join(work, "other"));
    writeFileSync(path.join(work, "other", "x.ts"), BAD);
    writeFileSync(path.join(work, "README.md"), "hi\n");
    writeFileSync(path.join(app, "src", "other.ts"), BAD);
    const { stdout } = await run(["check", "--changed", "feature"], app);
    expect(stdout).toMatch(/in 1 changed file \(/);
    expect(stdout).not.toContain("other/x.ts");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "second");
    const untouched = await run(["check", "--changed", "second"], app);
    expect(untouched.stdout).toBe("No files of this project changed since `second`.\n");
  });

  it("reports the findings of a file changed on this branch, against main by default", async () => {
    writeFileSync(path.join(work, "src", "other.ts"), BAD);
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "other");
    const { code, stdout } = await run(["check", "--changed"], work);
    expect(code).toBe(1);
    expect(stdout).toContain("src/other.ts");
    expect(stdout).not.toContain("src/status.ts");
    expect(stdout).toMatch(
      /1 error in 1 changed file \(3 problems elsewhere not shown, [\d.]+ s\)\./,
    );
  });

  it("counts uncommitted and untracked files as changed", async () => {
    writeFileSync(path.join(work, "src", "fresh.ts"), BAD);
    const untracked = await run(["check", "--changed"], work);
    expect(untracked.code).toBe(1);
    expect(untracked.stdout).toContain("src/fresh.ts");
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "fresh");
    writeFileSync(path.join(work, "src", "fresh.ts"), `${BAD}\n`);
    const edited = await run(["check", "--changed"], work);
    expect(edited.stdout).toContain("src/fresh.ts");
  });

  it("takes the base from the command line", async () => {
    writeFileSync(path.join(work, "src", "other.ts"), BAD);
    git(work, "add", ".");
    git(work, "commit", "-q", "-m", "other");
    const sinceHead = await run(["check", "--changed", "HEAD"], work);
    expect(sinceHead.code).toBe(0);
    expect(sinceHead.stdout).toBe("No files of this project changed since `HEAD`.\n");
    const sinceMain = await run(["check", "--changed", "main"], work);
    expect(sinceMain.code).toBe(1);
    expect(sinceMain.stdout).toContain("src/other.ts");
  });

  it("with --staged, reports only the files staged for commit", async () => {
    writeFileSync(path.join(work, "src", "other.ts"), BAD);
    writeFileSync(
      path.join(work, "src", "status.ts"),
      readFileSync(path.join(work, "src", "status.ts"), "utf8") + "\n",
    );
    git(work, "add", "src/other.ts");
    const { code, stdout } = await run(["check", "--staged", "--format", "json"], work);
    expect(code).toBe(1);
    expect(stdout).toContain("src/other.ts");
    expect(stdout).not.toContain("src/status.ts");
    expect(stdout).toMatch(/"changed": \{\s+"files": 1,\s+"elsewhere": 3\s+\}/);
  });

  it("with --staged, checks the staged text, not later edits that are not staged", async () => {
    const other = path.join(work, "src", "other.ts");
    writeFileSync(other, BAD);
    git(work, "add", "src/other.ts");
    // Fixed in the working file but not staged: the commit would still hold the error.
    writeFileSync(other, "export const other = 2;\n");
    const staged = await run(["check", "--staged"], work);
    expect(staged.code).toBe(1);
    expect(staged.stdout).toContain("src/other.ts:7:5");
    expect(staged.stdout).toContain("7 |     default:");
    // The other way round: a clean staged text passes, whatever the working file holds.
    git(work, "add", "src/other.ts");
    writeFileSync(other, BAD);
    expect((await run(["check", "--staged"], work)).code).toBe(0);
  });

  it("with --staged, checks the staged text when the project is reached through a link", async () => {
    // As every folder under macOS's `/tmp` is: git names the files by their real path, the
    // program by the link, and the staged text was keyed by the first.
    // The link sits next to the project, so the config still finds the packs installed above it.
    const linked = `${work}-link`;
    try {
      symlinkSync(work, linked, "dir");
      const other = path.join(work, "src", "other.ts");
      writeFileSync(other, BAD);
      git(work, "add", "src/other.ts");
      writeFileSync(other, "export const other = 2;\n");
      const staged = await run(["check", "--staged"], linked);
      expect(staged.stderr).toBe("");
      expect(staged.code).toBe(1);
      expect(staged.stdout).toContain("src/other.ts:7:5");
    } finally {
      rmSync(linked, { force: true });
    }
  });

  it("with --staged and nothing staged, passes", async () => {
    writeFileSync(path.join(work, "src", "other.ts"), BAD);
    const { code } = await run(["check", "--staged"], work);
    expect(code).toBe(0);
  });

  it("prints github annotations for the changed files only", async () => {
    writeFileSync(path.join(work, "src", "other.ts"), BAD);
    const { stdout } = await run(["check", "--changed", "--format", "github"], work);
    expect(stdout).toContain("file=src/other.ts");
    expect(stdout).not.toContain("status.ts");
  });

  it("says when the folder is not a git repository", async () => {
    rmSync(path.join(work, ".git"), { recursive: true });
    // Stop git from finding this repository above the fixtures folder.
    vi.stubEnv("GIT_CEILING_DIRECTORIES", fixtures);
    const { code, stderr } = await run(["check", "--changed"], work);
    expect(code).toBe(2);
    expect(stderr).toContain("--changed needs a git repository");
    const staged = await run(["check", "--staged"], work);
    expect(staged.stderr).toContain("--staged needs a git repository");
  });

  it("says when the base does not exist, with an example to pass", async () => {
    const named = await run(["check", "--changed", "develop"], work);
    expect(named.code).toBe(2);
    expect(named.stderr).toContain(
      "`develop` is not a branch or commit here; pass the base, e.g. `--changed origin/develop`",
    );
    git(work, "branch", "-q", "-m", "main", "trunk");
    const byDefault = await run(["check", "--changed"], work);
    expect(byDefault.code).toBe(2);
    expect(byDefault.stderr).toContain(
      "`main` is not a branch here, and neither are `master` or `origin/HEAD`; pass the base, e.g. `--changed origin/develop`",
    );
  });
});

/** A path shaped like a real one on every system (`C:\p\a.ts` on Windows), as `scopeResult` compares real paths. */
const at = (name: string): string => path.resolve("/p", name);

function problem(file: string, related: readonly string[] = []): Finding {
  return {
    kind: "problem",
    ruleId: "records/lookup-misses-key",
    severity: "error",
    message: "m",
    hint: "h",
    location: { file, start: 0, end: 1 },
    related: related.map((other) => ({
      location: { file: other, start: 0, end: 1 },
      message: "n",
    })),
    fixes: [],
  };
}

function resultOf(findings: readonly Finding[]): CheckResult {
  return {
    findings,
    hidden: [
      { file: at("a.ts"), ruleId: "r", count: 3 },
      { file: at("b.ts"), ruleId: "r", count: 5 },
    ],
    stats: { files: 4, durationMs: 1 },
  };
}

describe("scopeResult", () => {
  it("keeps a finding whose location or whose related location is in a changed file", () => {
    const own = problem(at("a.ts"));
    const pointsIn = problem(at("b.ts"), [at("a.ts")]);
    const elsewhere = problem(at("b.ts"), [at("c.ts")]);
    const scoped = scopeResult(resultOf([own, pointsIn, elsewhere]), new Set([at("a.ts")]));
    expect(scoped.result.findings).toEqual([own, pointsIn]);
    expect(scoped.elsewhere).toBe(1 + 5);
    expect(scoped.result.hidden).toEqual([{ file: at("a.ts"), ruleId: "r", count: 3 }]);
  });

  it("counts only problems as elsewhere, not places not checked", () => {
    const unknown: Finding = {
      kind: "unknown",
      ruleId: "r",
      message: "m",
      hint: "h",
      location: { file: at("b.ts"), start: 0, end: 1 },
    };
    const scoped = scopeResult(resultOf([problem(at("b.ts")), unknown]), new Set([at("a.ts")]));
    expect(scoped.elsewhere).toBe(1 + 5);
  });

  it("never drops a rule failure", () => {
    const failure: Finding = {
      kind: "failure",
      ruleId: "r",
      message: "m",
      hint: "h",
      location: { file: at("z.ts"), start: 0, end: 0 },
    };
    expect(scopeResult(resultOf([failure]), new Set()).result.findings).toEqual([failure]);
  });

  it("counts only code files as changed files", () => {
    const scoped = scopeResult(resultOf([]), new Set([at("a.ts"), at("readme.md"), at("b.tsx")]));
    expect(scoped.files).toBe(2);
  });
});

describe("stagedTextOf", () => {
  it("finds the staged text whichever way the path is written", () => {
    // `changedFiles` keys in TypeScript's form; a finding's file is in that form, a native path is not.
    const overlays = new Map([["C:/p/a.ts", "staged"]]);
    expect(stagedTextOf(overlays, "C:/p/a.ts")).toBe("staged");
    expect(stagedTextOf(overlays, path.win32.join("C:\\p", "a.ts"))).toBe("staged");
    expect(stagedTextOf(overlays, "C:/p/b.ts")).toBeUndefined();
  });
});

describe("arguments", () => {
  it("--changed takes an optional base", () => {
    const parsed = parseArgs(["check", "--changed", "origin/develop", "--no-cache"]);
    expect(parsed.ok && parsed.value.kind === "check" && parsed.value.scope).toEqual({
      kind: "changed",
      base: "origin/develop",
    });
    const bare = parseArgs(["check", "--changed", "--no-cache"]);
    expect(bare.ok && bare.value.kind === "check" && bare.value.scope).toEqual({
      kind: "changed",
      base: undefined,
    });
  });

  it("refuses the options where they do not belong", () => {
    expect(parseArgs(["check", "--changed", "--staged"])).toEqual({
      ok: false,
      errors: ["use --changed or --staged, not both"],
    });
    expect(parseArgs(["plan", "--staged"])).toEqual({
      ok: false,
      errors: ["--staged only applies to check"],
    });
    expect(parseArgs(["check", "--staged", "--fix"])).toEqual({
      ok: false,
      errors: ["fixes apply to your working files; run `--fix` without `--staged`"],
    });
    expect(parseArgs(["check", "--hook"])).toEqual({
      ok: false,
      errors: ["--hook only applies to init"],
    });
    expect(parseArgs(["init", "--changed"])).toEqual({
      ok: false,
      errors: ["--changed on init goes with --ci github"],
    });
    expect(parseArgs(["init", "--ci", "github", "--changed", "main"]).ok).toBe(false);
  });
});

describe("the pull request workflow", () => {
  const input = {
    manager: "npm",
    lockfile: "package-lock.json",
    version: "1",
    hasFile: () => false,
  } as const;

  it("checks the whole history out and passes the base branch on pull requests", () => {
    const text = renderWorkflow({ ...input, changed: true });
    expect(text).toContain("fetch-depth: 0");
    expect(text).toContain(
      "run: npx --no stateward check --format github --changed origin/${{ github.base_ref }}",
    );
    expect(text).toContain("if: github.event_name != 'pull_request'");
  });

  it("is the plain workflow without --changed", () => {
    const text = renderWorkflow(input);
    expect(text).not.toContain("fetch-depth");
    expect(text).not.toContain("--changed");
  });
});

/** A file mode has no execute bit on Windows (git there runs hooks through sh regardless). */
function expectExecutable(file: string): void {
  if (process.platform === "win32") return;
  expect(statSync(file).mode & 0o111).not.toBe(0);
}

describe("init --hook", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "stateward-hook-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "app" }));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Written with `/`, as the CLI shows it on every system (path.join accepts it on Windows too).
  const hookFile = ".git/hooks/pre-commit";

  it("adds a line to .husky/pre-commit", async () => {
    mkdirSync(path.join(dir, ".husky"));
    writeFileSync(path.join(dir, ".husky", "pre-commit"), "npm test");
    const { code, stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Added a stateward line to .husky/pre-commit, which runs before each commit.",
    );
    expect(readFileSync(path.join(dir, ".husky", "pre-commit"), "utf8")).toBe(
      "npm test\nnpx --no stateward check --staged\n",
    );
    const again = await run(["init", "--hook"], dir);
    expect(again.stdout).toContain(".husky/pre-commit already runs stateward");
    expect(readFileSync(path.join(dir, ".husky", "pre-commit"), "utf8")).toBe(
      "npm test\nnpx --no stateward check --staged\n",
    );
  });

  it("counts a hook an older version wrote (`npx stateward`, without --no) as running stateward", async () => {
    mkdirSync(path.join(dir, ".husky"));
    writeFileSync(path.join(dir, ".husky", "pre-commit"), "npx stateward check --staged\n");
    const { stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(stdout).toContain(".husky/pre-commit already runs stateward");
  });

  it("adds a command to lefthook.yml", async () => {
    writeFileSync(path.join(dir, "lefthook.yml"), "pre-push:\n  commands:\n    t:\n      run: x\n");
    const { code, stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain("pre-commit section of lefthook.yml");
    expect(readFileSync(path.join(dir, "lefthook.yml"), "utf8")).toBe(
      "pre-push:\n  commands:\n    t:\n      run: x\n\npre-commit:\n  commands:\n    stateward:\n      run: npx --no stateward check --staged\n",
    );
  });

  it("adds nothing to a hook that runs stateward through a package.json script, unless --force", async () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "app", scripts: { lint: "eslint . && stateward check" } }),
    );
    mkdirSync(path.join(dir, ".husky"));
    writeFileSync(path.join(dir, ".husky", "pre-commit"), "yarn --silent lint\n");
    const { code, stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain(
      ".husky/pre-commit already runs stateward in `yarn --silent lint` (package.json script `lint`); nothing written (`--force` adds a line anyway).",
    );
    expect(readFileSync(path.join(dir, ".husky", "pre-commit"), "utf8")).toBe(
      "yarn --silent lint\n",
    );
    const forced = await run(["init", "--hook", "--force"], dir);
    expect(forced.stdout).toContain("Added a stateward line to .husky/pre-commit");
  });

  it("finds stateward behind a script in the lefthook section of the same hook only", async () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "app", scripts: { lint: "stateward check" } }),
    );
    const text = "pre-push:\n  commands:\n    lint:\n      run: npm run lint\n";
    writeFileSync(path.join(dir, "lefthook.yml"), text);
    const push = await run(["init", "--yes", "--hook", "pre-push"], dir);
    expect(push.stdout).toContain(
      "The pre-push section of lefthook.yml already runs stateward in `npm run lint` (package.json script `lint`); nothing written",
    );
    const commit = await run(["init", "--hook"], dir);
    expect(commit.stdout).toContain("Added a `stateward` command to the pre-commit section");
  });

  it("does not edit a lefthook pre-commit section that is already there", async () => {
    const text = "pre-commit:\n  commands:\n    lint:\n      run: x\n";
    writeFileSync(path.join(dir, "lefthook.yml"), text);
    const { stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(stdout).toContain("already has a pre-commit section");
    expect(stdout).toContain("run: npx --no stateward check --staged");
    expect(readFileSync(path.join(dir, "lefthook.yml"), "utf8")).toBe(text);
  });

  it("says how to use lint-staged instead of editing its config", async () => {
    writeFileSync(path.join(dir, ".lintstagedrc.json"), "{}");
    const { code, stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('"*.{ts,tsx}": () => "npx --no stateward check --staged"');
    expect(readFileSync(path.join(dir, ".lintstagedrc.json"), "utf8")).toBe("{}");
    expect(existsSync(path.join(dir, hookFile))).toBe(false);
  });

  it("writes an executable .git/hooks/pre-commit", async () => {
    git(dir, "init", "-q");
    const { code, stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain(`Wrote ${hookFile}`);
    expect(readFileSync(path.join(dir, hookFile), "utf8")).toContain(
      "\nnpx --no stateward check --staged\n",
    );
    expectExecutable(path.join(dir, hookFile));
  });

  it("never overwrites a hook that exists, and prints what to add", async () => {
    git(dir, "init", "-q");
    mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(path.join(dir, hookFile), "#!/bin/sh\necho mine\n");
    await run(["init", "--yes"], dir);
    const { code, stdout } = await run(["init", "--hook"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain("already exists, so it is left alone. Add this line to it:");
    expect(stdout).toContain("npx --no stateward check --staged");
    expect(readFileSync(path.join(dir, hookFile), "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  const NOTE =
    "runs `stateward check --staged` before each commit; on a big project this can take tens of seconds. Use `--hook pre-push` to run it before push instead.";

  it("says what a check before each commit costs, and offers pre-push", async () => {
    git(dir, "init", "-q");
    const { stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(stdout).toContain(NOTE);
  });

  describe("--hook pre-push", () => {
    const pushFile = ".git/hooks/pre-push";
    const UPSTREAM = '"$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream}';

    it("writes an executable .git/hooks/pre-push checking what changed against the upstream", async () => {
      git(dir, "init", "-q");
      const { code, stdout } = await run(["init", "--yes", "--hook", "pre-push"], dir);
      expect(code).toBe(0);
      expect(stdout).toContain(`Wrote ${pushFile}`);
      expect(stdout).toContain("--no-verify");
      const text = readFileSync(path.join(dir, pushFile), "utf8");
      expect(text).toContain(`\nnpx --no stateward check --changed ${UPSTREAM}`);
      expect(text).toContain('refs/remotes/origin/HEAD 2>/dev/null || echo main)"\n');
      expectExecutable(path.join(dir, pushFile));
      expect(existsSync(path.join(dir, hookFile))).toBe(false);
    });

    it("adds a line to .husky/pre-push, once", async () => {
      mkdirSync(path.join(dir, ".husky"));
      await run(["init", "--yes", "--hook", "pre-push"], dir);
      const text = readFileSync(path.join(dir, ".husky", "pre-push"), "utf8");
      expect(text).toContain("npx --no stateward check --changed");
      const again = await run(["init", "--hook", "pre-push"], dir);
      expect(again.stdout).toContain(".husky/pre-push already runs stateward");
      expect(readFileSync(path.join(dir, ".husky", "pre-push"), "utf8")).toBe(text);
      expect(existsSync(path.join(dir, ".husky", "pre-commit"))).toBe(false);
    });

    it("adds a pre-push section to lefthook.yml, quoted as YAML", async () => {
      writeFileSync(
        path.join(dir, "lefthook.yml"),
        "pre-commit:\n  commands:\n    t:\n      run: x\n",
      );
      const { stdout } = await run(["init", "--yes", "--hook", "pre-push"], dir);
      expect(stdout).toContain("pre-push section of lefthook.yml");
      const text = readFileSync(path.join(dir, "lefthook.yml"), "utf8");
      expect(text).toContain(
        "\npre-push:\n  commands:\n    stateward:\n      run: 'npx --no stateward check --changed",
      );
    });

    it("does not use lint-staged, which only runs at commit", async () => {
      writeFileSync(path.join(dir, ".lintstagedrc.json"), "{}");
      git(dir, "init", "-q");
      const { stdout } = await run(["init", "--yes", "--hook", "pre-push"], dir);
      expect(stdout).toContain(`Wrote ${pushFile}`);
    });

    it("belongs to init, and takes only pre-commit or pre-push", () => {
      expect(parseArgs(["check", "--hook", "pre-push"]).ok).toBe(false);
      const commit = parseArgs(["init", "--hook"]);
      const push = parseArgs(["init", "--hook", "pre-push"]);
      expect(commit.ok && commit.value.kind === "init" ? commit.value.hook : "bad").toBe(
        "pre-commit",
      );
      expect(push.ok && push.value.kind === "init" ? push.value.hook : "bad").toBe("pre-push");
    });
  });

  it("says so, and exits 2, when there is no git repository", async () => {
    const { code, stdout } = await run(["init", "--yes", "--hook"], dir);
    expect(code).toBe(2);
    expect(stdout).toContain("Created stateward.config.ts");
    expect(stdout).toContain("is not inside a git repository");
  });
});
