import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

/** A local plugin whose one rule reports the first statement of every file: no package to install. */
const CONFIG = (tsconfig: string): string =>
  [
    "const first = {",
    '  kind: "file",',
    '  meta: { description: "d", defaultSeverity: "warning", tier: "core", group: "g", explain: "e" },',
    "  check(ctx) {",
    "    const node = ctx.sourceFile.statements[0];",
    '    if (node !== undefined) ctx.report({ message: "first statement", hint: "h", node });',
    "  },",
    "};",
    `export default { tsconfig: ${tsconfig}, preset: "recommended", plugins: [{ name: "local", description: "d", rules: { first } }] };`,
    "",
  ].join("\n");

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", types: [] },
  include: ["src"],
});

let dir = "";

function write(files: Readonly<Record<string, string>>): void {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-monorepo-cli-"));
  write({
    "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    "stateward.config.mjs": CONFIG('["packages/*/tsconfig.json"]'),
    "packages/a/package.json": JSON.stringify({ name: "a" }),
    "packages/a/tsconfig.json": TSCONFIG,
    "packages/a/src/a.ts": "export const a = 1;\n",
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/b/tsconfig.json": TSCONFIG,
    "packages/b/src/b.ts": "export const b = 2;\n",
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function run(
  argv: readonly string[],
  cwd: string,
): Promise<{ code: ExitCode; stdout: string; stderr: string }> {
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

const lastLine = (text: string): string => text.trimEnd().split("\n").at(-1) ?? "";

describe("a config for several packages", { timeout: 20_000 }, () => {
  it("checks every package from the root and counts the projects", async () => {
    const { code, stdout, stderr } = await run(["check"], dir);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(" --> packages/a/src/a.ts:1:1");
    expect(stdout).toContain(" --> packages/b/src/b.ts:1:1");
    expect(lastLine(stdout)).toMatch(
      /^2 warnings in 2 files of 2 projects \(\d+\.\d s\)\. Run `stateward explain <rule>` for details\.$/,
    );
  });

  it("finds the config above the folder it runs in, and says which one in the summary", async () => {
    const here = path.join(dir, "packages", "a");
    const { code, stdout, stderr } = await run(["check"], here);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    // Paths stay relative to where the developer is.
    expect(stdout).toContain(" --> src/a.ts:1:1");
    expect(stdout).toContain(" --> ../b/src/b.ts:1:1");
    expect(lastLine(stdout)).toMatch(
      new RegExp(
        `^2 warnings in 2 files of 2 projects \\(\\d+\\.\\d s; config ${"../../stateward.config.mjs".replaceAll(".", "\\.")}\\)\\.`,
      ),
    );
  });

  it("names the config and the projects with --verbose", async () => {
    const { stderr } = await run(["check", "--verbose"], dir);
    expect(stderr).toBe(
      [
        "stateward: config stateward.config.mjs",
        `stateward: project packages/a/tsconfig.json (1 file)`,
        `stateward: project packages/b/tsconfig.json (1 file)`,
        "stateward: results are not kept for the next run",
        "",
      ].join("\n"),
    );
  });

  it("uses the config --config names, relative to the folder it runs in", async () => {
    write({ "packages/b/only-b.config.mjs": CONFIG('"tsconfig.json"') });
    const { code, stdout } = await run(["check", "--config", "packages/b/only-b.config.mjs"], dir);
    expect(code).toBe(0);
    expect(stdout).not.toContain("a.ts");
    expect(stdout).toContain(" --> packages/b/src/b.ts:1:1");
    expect(lastLine(stdout)).toContain(`in 1 file (`);
    expect(lastLine(stdout)).toContain("; config packages/b/only-b.config.mjs)");
  });

  it("says when the --config file does not exist", async () => {
    const { code, stderr } = await run(["check", "--config", "nope.config.ts"], dir);
    expect(code).toBe(2);
    expect(stderr).toBe(
      `stateward: config file not found: ${path.join(dir, "nope.config.ts")}\n  = fix: check the path given to --config (it is relative to the folder you run in)\n`,
    );
  });

  it("stops looking at the workspace root, so a config above it is never used", async () => {
    const repo = path.join(dir, "repo");
    write({
      "repo/package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
      "repo/packages/c/tsconfig.json": TSCONFIG,
      "repo/packages/c/src/c.ts": "export const c = 3;\n",
    });
    const here = path.join(repo, "packages", "c");
    const { code, stderr } = await run(["check"], here);
    expect(code).toBe(2);
    expect(stderr).toBe(
      `stateward: no stateward.config.{ts,mts,js,mjs} found in ${here} or a folder above it\n  = fix: run \`npx stateward init\` in your project's folder to create one, or name one with \`--config <file>\`\n`,
    );
  });

  it("refuses --config for init and --verbose outside check", async () => {
    expect((await run(["init", "--config", "x.ts"], dir)).stderr).toContain(
      "--config does not apply to init",
    );
    expect((await run(["plan", "--verbose"], dir)).stderr).toContain(
      "--verbose only applies to check",
    );
  });
});
