import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shellQuoted, writeHook } from "../src/hook.js";

// Review 5: the hook wrote `cd "<folder>"`, so a folder named with `"`, `$`, a backtick or `&`
// broke the hook or ran part of its name as a command.
const NAMES = ['say "hi"', "cost $HOME", "tick `id`", "a & b", "it's", "all \"$`&'"];

// Windows cannot have a folder named with `"` (nor `*:<>?|`): such a name cannot exist there, a
// limit of the platform, so those cases run elsewhere only.
const forbidden = (name: string): boolean => process.platform === "win32" && name.includes('"');

/**
 * A path as `sh -c pwd` prints it, in the form `path` uses. In Git Bash on Windows that is
 * `/c/Users/you`, which is `C:\Users\you` here, or `/tmp/x` (the MSYS temp mount, the
 * Windows temp folder); elsewhere nothing changes.
 */
function native(printed: string): string {
  if (process.platform !== "win32") return printed;
  const drive = /^\/([a-zA-Z])(\/.*)?$/.exec(printed);
  if (drive !== null) {
    return path.normalize(`${(drive[1] ?? "").toUpperCase()}:${drive[2] ?? "/"}`);
  }
  // Git Bash mounts the Windows temp folder at `/tmp`: `/tmp/x` is `<os.tmpdir()>\x`.
  const temporary = /^\/tmp(\/.*)?$/.exec(printed);
  if (temporary !== null) {
    return path.join(realpathSync.native(tmpdir()), temporary[1] ?? "");
  }
  return printed;
}

/**
 * One form for a path on every system: separators `/`, and on Windows the drive letter lower
 * case (it differs after the round trip through sh) and short 8.3 names expanded.
 */
function canonical(file: string): string {
  const real = (() => {
    try {
      return realpathSync.native(file);
    } catch {
      return file;
    }
  })();
  const slashed = real.replaceAll("\\", "/");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

const same = (printed: string, expected: string): boolean =>
  canonical(native(printed)) === canonical(expected);

let root = "";
beforeEach(() => {
  root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "stateward-quote-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("shellQuoted", () => {
  for (const name of NAMES) {
    it.skipIf(forbidden(name))(`gives sh the folder ${name} as one word, run as nothing`, () => {
      mkdirSync(path.join(root, name));
      const printed = execFileSync("sh", ["-c", `cd ${shellQuoted(name)} && pwd`], {
        cwd: root,
        encoding: "utf8",
      });
      expect(same(printed.trim(), path.join(root, name))).toBe(true);
    });
  }
});

describe("a git hook for a project in a folder with such a name", () => {
  it("changes to that folder before it runs stateward", () => {
    // The last name has a `"`, which a Windows folder cannot have: the last one that can exist.
    const name = NAMES.filter((candidate) => !forbidden(candidate)).at(-1) ?? "";
    execFileSync("git", ["init", "-q"], { cwd: root });
    const project = path.join(root, name);
    mkdirSync(project);
    writeFileSync(path.join(project, "package.json"), "{}");
    expect(writeHook(project).ok).toBe(true);
    const hook = readFileSync(path.join(root, ".git", "hooks", "pre-commit"), "utf8");
    // The hook with its stateward command replaced by `pwd`: it must print the project folder.
    const probe = hook.replace("npx --no stateward check --staged", "pwd");
    const result = spawnSync("sh", ["-c", probe], { cwd: root, encoding: "utf8" });
    expect(same(result.stdout.trim(), project)).toBe(true);
  });
});

describe("a git hook for a project reached through a link", () => {
  // macOS's `/tmp` is a link to `/private/tmp`, and git prints the real path: the hook changed to
  // `../../<link>`, a folder that does not exist from the repository's root.
  it("changes to the project's folder inside the repository, and names the hook from there", () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const project = path.join(root, "app");
    mkdirSync(project);
    writeFileSync(path.join(project, "package.json"), "{}");
    const outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), "stateward-link-")));
    try {
      const link = path.join(outside, "app");
      symlinkSync(project, link, "dir");
      const result = writeHook(link);
      expect(result.ok).toBe(true);
      expect(result.text).toContain("Wrote ../.git/hooks/pre-commit: it runs `cd 'app' && ");
      const hook = readFileSync(path.join(root, ".git", "hooks", "pre-commit"), "utf8");
      const probe = hook.replace("npx --no stateward check --staged", "pwd");
      const run = spawnSync("sh", ["-c", probe], { cwd: root, encoding: "utf8" });
      expect(same(run.stdout.trim(), project)).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
