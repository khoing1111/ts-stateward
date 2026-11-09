import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { displayPath } from "@stateward/core/internal";
import { realPath } from "./real-path.js";
import { describeScriptRun, projectScripts, scriptRunningStateward } from "./scripts.js";

/**
 * The line a pre-commit hook runs. `npx --no` runs the project's own stateward and fails if it is
 * not installed, instead of downloading whatever the registry has under that name.
 */
export const HOOK_COMMAND = "npx --no stateward check --staged";

/**
 * The line a pre-push hook runs: what changed since the branch's upstream, and where a branch has
 * none yet (its first push), since the default branch (`origin/HEAD`), else `main`.
 */
export const PUSH_COMMAND =
  'npx --no stateward check --changed "$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null || git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo main)"';

/** Which git hook `init --hook` sets up. */
export type HookKind = "pre-commit" | "pre-push";

type Spec = {
  name: HookKind;
  command: string;
  /** What a hook that already runs stateward contains. */
  marker: string;
  /** When it runs, as said to the developer. */
  when: string;
  /** What to add to the message after writing: the cost of a hook before each commit. */
  note: string;
};

const SPECS: Readonly<Record<HookKind, Spec>> = {
  "pre-commit": {
    name: "pre-commit",
    command: HOOK_COMMAND,
    // A hook an older version wrote (`npx stateward check --staged`) counts too.
    marker: "stateward check --staged",
    when: "before each commit",
    note: "It runs `stateward check --staged` before each commit; on a big project this can take tens of seconds. Use `--hook pre-push` to run it before push instead.\n",
  },
  "pre-push": {
    name: "pre-push",
    command: PUSH_COMMAND,
    marker: "stateward check --changed",
    when: "before each push",
    note: "It runs `stateward check --changed` against the branch's upstream (the default branch for a new branch) before each push.\n",
  },
};

export type HookResult = {
  /** What to tell the developer. */
  text: string;
  /** False when nothing could be set up (no git repository). */
  ok: boolean;
};

const LINT_STAGED_FILES = [
  ".lintstagedrc",
  ".lintstagedrc.json",
  ".lintstagedrc.yaml",
  ".lintstagedrc.yml",
  ".lintstagedrc.js",
  ".lintstagedrc.cjs",
  ".lintstagedrc.mjs",
  "lint-staged.config.js",
  "lint-staged.config.cjs",
  "lint-staged.config.mjs",
];

const LEFTHOOK_FILES = ["lefthook.yml", "lefthook.yaml"];

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function hasLintStaged(cwd: string): boolean {
  if (LINT_STAGED_FILES.some((file) => existsSync(path.join(cwd, file)))) return true;
  const manifest = readText(path.join(cwd, "package.json"));
  return manifest !== undefined && /"lint-staged"\s*:/.test(manifest);
}

/**
 * What to say when `text` (a hook) runs a package.json script that runs stateward, so a second
 * check is not added; undefined when it runs none, or with `--force`.
 */
function viaScript(
  shown: string,
  text: string,
  scripts: ReadonlyMap<string, string>,
  force: boolean,
): string | undefined {
  const via = force ? undefined : scriptRunningStateward(text, scripts);
  return via === undefined
    ? undefined
    : `${shown} already runs stateward in ${describeScriptRun(via)}; nothing written (\`--force\` adds a line anyway).\n`;
}

/** The `name:` block of a lefthook file: from that line to the next top-level key. */
function lefthookSection(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${name}:`));
  if (start === -1) return "";
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function withNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

function husky(cwd: string, spec: Spec, force: boolean): string {
  const file = path.join(cwd, ".husky", spec.name);
  const existing = readText(file);
  if (existing?.includes(spec.marker) === true) {
    return `.husky/${spec.name} already runs stateward; nothing written.\n`;
  }
  const found = viaScript(`.husky/${spec.name}`, existing ?? "", projectScripts(cwd), force);
  if (found !== undefined) return found;
  writeFileSync(file, `${withNewline(existing ?? "")}${spec.command}\n`);
  return `Added a stateward line to .husky/${spec.name}, which runs ${spec.when}. ${spec.note}`;
}

function lefthook(cwd: string, name: string, spec: Spec, force: boolean): string {
  const file = path.join(cwd, name);
  const existing = readText(file) ?? "";
  if (existing.includes(spec.marker)) return `${name} already runs stateward; nothing written.\n`;
  const section = lefthookSection(existing, spec.name);
  const found = viaScript(
    `The ${spec.name} section of ${name}`,
    section,
    projectScripts(cwd),
    force,
  );
  if (found !== undefined) return found;
  if (new RegExp(`^${spec.name}:`, "m").test(existing)) {
    // Editing inside a block that is already there could break its layout, so the developer does.
    return [
      `${name} already has a ${spec.name} section, so it is left alone. Add this under its \`commands:\`:`,
      "",
      "    stateward:",
      `      run: ${yamlText(spec.command)}`,
      "",
    ].join("\n");
  }
  const block = [
    `${spec.name}:`,
    "  commands:",
    "    stateward:",
    `      run: ${yamlText(spec.command)}`,
    "",
  ];
  writeFileSync(file, `${withNewline(existing)}${existing === "" ? "" : "\n"}${block.join("\n")}`);
  return `Added a \`stateward\` command to the ${spec.name} section of ${name}, which runs ${spec.when}. ${spec.note}`;
}

/** A command as a YAML value: quoted when it holds characters YAML reads as syntax. */
function yamlText(command: string): string {
  return /[:#"'$@{}]/.test(command) ? `'${command.replaceAll("'", "''")}'` : command;
}

function lintStaged(): string {
  return [
    "You use lint-staged, so no hook was written. Stateward checks the whole project, so give it a",
    "function (lint-staged then does not add the file names) in lint-staged.config.mjs:",
    "",
    '  export default { "*.{ts,tsx}": () => "npx --no stateward check --staged" };',
    "",
    "A JSON config cannot do this; use a .husky/pre-commit line or run `stateward init --hook` in a",
    "project without lint-staged.",
    "",
  ].join("\n");
}

/**
 * `text` as one word for sh, which runs git hooks (Git Bash too, on Windows): in single quotes,
 * where `"`, `$`, a backtick and `&` mean nothing, and each `'` closes the quotes, is escaped, and
 * opens them again.
 */
export function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function gitHook(cwd: string, spec: Spec, force: boolean): HookResult {
  // git prints real paths: the project's folder takes that form too, so `cd` names the folder
  // inside the repository, not a way back out of it through a link.
  const here = realPath(cwd);
  let hookPath: string;
  let root: string;
  try {
    const git = (args: string[]): string =>
      execFileSync("git", args, {
        cwd: here,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    root = realPath(git(["rev-parse", "--show-toplevel"]));
    hookPath = path.resolve(here, git(["rev-parse", "--git-path", `hooks/${spec.name}`]));
  } catch {
    return {
      ok: false,
      text: `No ${spec.name} hook written: ${cwd} is not inside a git repository. Run \`git init\` first, then \`stateward init --hook\`.\n`,
    };
  }
  const inside = path.relative(root, here).split(path.sep).join("/");
  // A hook runs from the repository root; the project may be a folder in it.
  const command = inside === "" ? spec.command : `cd ${shellQuoted(inside)} && ${spec.command}`;
  const display = displayPath(here, hookPath);
  const existing = readText(hookPath);
  const found =
    existing === undefined
      ? undefined
      : viaScript(display, existing, projectScripts(root, here), force);
  if (found !== undefined) return { ok: true, text: found };
  if (existing !== undefined) {
    return {
      ok: true,
      text: existing.includes(spec.marker)
        ? `${display} already runs stateward; nothing written.\n`
        : `${display} already exists, so it is left alone. Add this line to it:\n\n  ${command}\n`,
    };
  }
  mkdirSync(path.dirname(hookPath), { recursive: true });
  // "wx": a hook that appeared since the check above is never overwritten.
  writeFileSync(
    hookPath,
    `#!/bin/sh\n# Written by \`stateward init --hook ${spec.name}\`.\n${command}\n`,
    {
      flag: "wx",
      mode: 0o755,
    },
  );
  chmodSync(hookPath, 0o755);
  return {
    ok: true,
    text: `Wrote ${display}: it runs \`${command}\` ${spec.when} and stops on an error. Skip it once with \`git ${spec.name === "pre-push" ? "push" : "commit"} --no-verify\`. ${spec.note}`,
  };
}

/**
 * `init --hook [pre-commit|pre-push]`: husky, then lefthook, then lint-staged (pre-commit only,
 * explained only), else a plain git hook. A hook that already runs stateward, itself or through a
 * package.json script, gets no second line unless `force`.
 */
export function writeHook(cwd: string, kind: HookKind = "pre-commit", force = false): HookResult {
  const spec = SPECS[kind];
  if (existsSync(path.join(cwd, ".husky"))) return { ok: true, text: husky(cwd, spec, force) };
  const lefthookFile = LEFTHOOK_FILES.find((file) => existsSync(path.join(cwd, file)));
  if (lefthookFile !== undefined) {
    return { ok: true, text: lefthook(cwd, lefthookFile, spec, force) };
  }
  if (kind === "pre-commit" && hasLintStaged(cwd)) return { ok: true, text: lintStaged() };
  return gitHook(cwd, spec, force);
}
