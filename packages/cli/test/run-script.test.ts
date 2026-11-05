import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scripts = fileURLToPath(new URL("../../../scripts", import.meta.url));
const runModule = pathToFileURL(path.join(scripts, "run.mjs")).href;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs `code` as an ES module that has run.mjs's exports in scope, and returns what it printed. */
function evaluate(code: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import * as runner from ${JSON.stringify(runModule)};\n${code}`],
    { encoding: "utf8", env },
  );
  expect(result.stderr).toBe("");
  return result.stdout;
}

describe("run.mjs", () => {
  it("starts node directly, never through a shell, so a path with a space is one program", () => {
    const node = String.raw`C:\Program Files\nodejs\node.exe`;
    const plans = evaluate(
      `for (const command of ["node", ${JSON.stringify(node)}]) console.log(JSON.stringify(runner.spawnPlan(command, ["pack.mjs"], "win32", ${JSON.stringify(node)})));`,
    );
    expect(plans.trim().split("\n")).toEqual([
      JSON.stringify({ file: node, args: ["pack.mjs"], shell: false }),
      JSON.stringify({ file: node, args: ["pack.mjs"], shell: false }),
    ]);
  });

  it("quotes the command as well as the arguments when a .cmd shim needs the Windows shell", () => {
    const pnpm = String.raw`C:\Program Files\pnpm\pnpm.cmd`;
    const args = [String.raw`C:\my app\x.tgz`, "-D"];
    const plan = evaluate(
      `console.log(JSON.stringify(runner.spawnPlan(${JSON.stringify(pnpm)}, ${JSON.stringify(args)}, "win32", "node.exe")));`,
    );
    expect(JSON.parse(plan)).toEqual({
      line: `"${pnpm}" "C:\\my app\\x.tgz" -D`,
      shell: true,
    });
  });

  // Review 5: a part with `&` or `"` reached cmd.exe as it was, so `&` started a second command.
  it("escapes what cmd.exe would act on, and leaves $ and plain words alone", () => {
    const args = ['say "hi"', "cost $HOME", "tick `id`", "a & b", "-D", "C:\\dir\\"];
    const plan = evaluate(
      `console.log(JSON.stringify(runner.spawnPlan("pnpm.cmd", ${JSON.stringify(args)}, "win32", "node.exe")));`,
    );
    expect(JSON.parse(plan)).toEqual({
      line: [
        "pnpm.cmd",
        String.raw`^"say \^"hi\^"^"`,
        '"cost $HOME"',
        '^"tick ^`id^`^"',
        '^"a ^& b^"',
        "-D",
        "C:\\dir\\",
      ].join(" "),
      shell: true,
    });
  });

  it("escapes a program path with parentheses with ^, not quotes", () => {
    const npm = String.raw`C:\Program Files (x86)\nodejs\npm.cmd`;
    const plan = evaluate(
      `console.log(JSON.stringify(runner.spawnPlan(${JSON.stringify(npm)}, [], "win32", "node.exe")));`,
    );
    expect(JSON.parse(plan)).toEqual({
      line: String.raw`C:\Program^ Files^ ^(x86^)\nodejs\npm.cmd`,
      shell: true,
    });
  });

  it("runs node from a folder whose name has a space", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward run "));
    dirs.push(dir);
    // Windows starts only a file that ends in `.exe`.
    const node = path.join(
      dir,
      process.platform === "win32" ? "node with space.exe" : "node with space",
    );
    cpSync(process.execPath, node);
    const result = spawnSync(
      node,
      [
        "--input-type=module",
        "-e",
        `import { run } from ${JSON.stringify(runModule)}; const r = run("node", ["-e", "process.stdout.write('ran')"]); console.log(r.status, r.output);`,
      ],
      { encoding: "utf8" },
    );
    // A copy that could not start has no output: say why, not "cannot read 'trim'".
    expect(result.error === undefined ? result.stderr : String(result.error)).toBe("");
    expect(result.stdout.trim()).toBe("0 ran");
  });

  it("runs pnpm as `corepack pnpm` when pnpm is not on PATH (the gate and pack share this)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-run-"));
    dirs.push(dir);
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const log = path.join(dir, "corepack.log");
    if (process.platform === "win32") {
      // On Windows a program started through the shell is a .cmd file.
      writeFileSync(path.join(bin, "corepack.cmd"), `@>>"${log}" echo %*\r\n@exit /b 0\r\n`);
    } else {
      writeFileSync(path.join(bin, "corepack"), `#!/bin/sh\necho "$@" >> "${log}"\nexit 0\n`);
      chmodSync(path.join(bin, "corepack"), 0o755);
    }

    evaluate(`console.log(runner.runPnpm(["exec", "prettier", "--check", "."]).status);`, {
      ...process.env,
      PATH: bin,
    });
    expect(readFileSync(log, "utf8").replaceAll("\r\n", "\n")).toBe(
      "pnpm exec prettier --check .\n",
    );
  });
});
