import { spawn, spawnSync } from "node:child_process";

/**
 * How to start `command` on `platform`: `{ file, args, shell: false }` for a program started
 * directly, or `{ line, shell: true }` for one command line a shell runs.
 *
 * On Windows, pnpm, npm, npx and yarn are .cmd files that only start through a shell, which joins
 * the program and its arguments into one command line: any part with a space is quoted, or
 * `C:\Program Files\nodejs\node.exe` would split at the space. That line is built here and given
 * to the shell whole: Node 24 warns (DEP0190) when it is given arguments with `shell: true`. Node itself never needs the shell,
 * so it is started directly as this very Node (`process.execPath`), with nothing to quote.
 */
export function spawnPlan(command, args, platform = process.platform, execPath = process.execPath) {
  if (command === "node" || command === execPath) {
    return { file: execPath, args, shell: false };
  }
  if (platform !== "win32") return { file: command, args, shell: false };
  return { line: [cmdProgram(command), ...args.map(cmdQuoted)].join(" "), shell: true };
}

/** The characters cmd.exe treats specially on a command line: each is escaped with `^`. */
const CMD_SPECIAL = /[()[\]%!^"`<>&|;,*?]/;
const CMD_SPECIALS = /([()[\]%!^"`<>&|;,*?])/g;

/**
 * One part of a cmd.exe command line that reaches the program as it is. A plain word stays as it
 * is, and one with a space only is put in double quotes. A part with a character cmd.exe reads
 * (`&`, `"`, `%`, …) is quoted for the program (a `"` inside escaped with `\`, and the backslashes
 * before it doubled), then every special character, the quotes too, gets a `^`, so cmd.exe passes
 * it on instead of acting on it.
 */
export function cmdQuoted(part) {
  const quoted = `"${part.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  if (CMD_SPECIAL.test(part)) return quoted.replace(CMD_SPECIALS, "^$1");
  return /\s/.test(part) || part === "" ? quoted : part;
}

/**
 * The program at the start of a cmd.exe command line: in double quotes when it has a space, as
 * before; with a special character (`C:\Program Files (x86)\…`), every special character and space
 * escaped with `^` instead: a quote escaped with `^` would no longer hold the name together.
 */
function cmdProgram(command) {
  if (CMD_SPECIAL.test(command)) return command.replace(/([()[\]%!^"`<>&|;,*? ])/g, "^$1");
  return /\s/.test(command) ? `"${command}"` : command;
}

/**
 * Runs a command, returning its status and combined output. Never throws: a command that could
 * not start has status 1 and says why in its output.
 */
export function run(command, args, options = {}) {
  const plan = spawnPlan(command, args);
  const settings = {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.inherit === true ? "inherit" : "pipe",
    env: { ...process.env, FORCE_COLOR: "0" },
  };
  const result = plan.shell
    ? spawnSync(plan.line, { ...settings, shell: true })
    : spawnSync(plan.file, plan.args, settings);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error !== undefined) {
    return { status: 1, output: `${output}${String(result.error)}\n` };
  }
  return { status: result.status ?? 1, output };
}

/**
 * Like `run`, for steps that go side by side: a promise of the same `{ status, output }`. Never
 * rejects.
 */
export function runAsync(command, args, options = {}) {
  const plan = spawnPlan(command, args);
  const settings = {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  };
  return new Promise((resolve) => {
    const child = plan.shell
      ? spawn(plan.line, { ...settings, shell: true })
      : spawn(plan.file, plan.args, settings);
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", (error) => {
      resolve({ status: 1, output: `${Buffer.concat(chunks).toString("utf8")}${String(error)}\n` });
    });
    child.once("close", (status) => {
      resolve({ status: status ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

/** The program and leading arguments that run pnpm: `pnpm` itself, or `corepack pnpm` when it is not on PATH. */
export function pnpmCommand() {
  if (run("pnpm", ["--version"]).status === 0) return ["pnpm", []];
  return ["corepack", ["pnpm"]];
}

/** Runs pnpm with `args`, through `corepack pnpm` when pnpm is not on PATH (see pnpmCommand). */
export function runPnpm(args, options = {}, pnpm = pnpmCommand()) {
  const [program, leading] = pnpm;
  return run(program, [...leading, ...args], options);
}

/** `runPnpm` for steps that go side by side (see `runAsync`). */
export function runPnpmAsync(args, options = {}, pnpm = pnpmCommand()) {
  const [program, leading] = pnpm;
  return runAsync(program, [...leading, ...args], options);
}
