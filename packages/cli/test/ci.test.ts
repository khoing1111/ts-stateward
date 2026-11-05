import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckResult } from "@stateward/core/internal";
import { parseArgs } from "../src/args.js";
import { WORKFLOW_FILE } from "../src/ci.js";
import { escapeData, escapeProperty, formatGitHub } from "../src/github.js";
import { COMMAND_HELP, commandHelp } from "../src/help.js";
import { main } from "../src/main.js";
import type { CliEnv, ExitCode } from "../src/main.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const example = fileURLToPath(new URL("../../../examples/basic", import.meta.url));

type Run = { code: ExitCode; stdout: string; stderr: string };

async function run(
  argv: readonly string[],
  cwd: string,
  environment: Record<string, string> = {},
): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const env: CliEnv = {
    cwd,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    color: false,
    version: "1.2.3",
    environment,
  };
  const code = await main(argv, env);
  return { code, stdout, stderr };
}

describe("escaping", () => {
  it("escapes %, carriage returns and newlines in the message", () => {
    expect(escapeData("100%\r\nnext")).toBe("100%25%0D%0Anext");
  });

  it("also escapes : and , in properties", () => {
    expect(escapeProperty("a:b,c%\n")).toBe("a%3Ab%2Cc%25%0A");
  });
});

describe("check --format github", () => {
  it("prints one command per finding with the headline and the fix, then the summary", async () => {
    const { code, stdout, stderr } = await run(["check", "--format", "github"], example);
    expect(code).toBe(1);
    expect(stderr).toBe("");
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(
      "::warning file=src/events.ts,line=2,col=13,endLine=2,endColumn=21,title=team/max-union-members::`AppEvent` has 13 members; above 12, switches over it get hard to keep complete — split it into nested unions by kind",
    );
    expect(lines[1]).toMatch(
      /^::error file=src\/status\.ts,line=9,col=5,endLine=9,endColumn=12,title=unions\/default-hides-cases::this `default` hides 1 case of `status`: "failed" — list the case, then put `status satisfies never;` in the `default`, or if the `default` is right for it, say so$/,
    );
    expect(lines.slice(0, -1).every((line) => line.startsWith("::"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^3 errors, 1 warning in 5 files/);
  });

  it("makes paths relative to GITHUB_WORKSPACE", async () => {
    const root = path.dirname(example);
    const { stdout } = await run(["check", "--format", "github"], example, {
      GITHUB_WORKSPACE: root,
    });
    expect(stdout).toContain("::warning file=basic/src/events.ts,line=2,");
  });

  it("does not hint when --format is given", async () => {
    const { stdout } = await run(["check", "--format", "github"], example, {
      GITHUB_ACTIONS: "true",
    });
    expect(stdout).not.toContain("Running in GitHub Actions");
  });

  it("with --verbose, levels: warning, info and unknown are notices, failure is an error", () => {
    const location = { file: "/repo/src/a:b,c.ts", start: 0, end: 3 };
    const result: CheckResult = {
      findings: [
        {
          kind: "problem",
          ruleId: "r/info",
          severity: "info",
          message: "m",
          hint: "h",
          location,
          related: [],
          fixes: [],
        },
        { kind: "unknown", ruleId: "r/unknown", message: "m", hint: "h", location },
        { kind: "failure", ruleId: "r/failure", message: "m", hint: "h", location },
        {
          kind: "problem",
          ruleId: "r/multi",
          severity: "error",
          message: "50% done\nnext",
          hint: "first\n    code",
          location,
          related: [],
          fixes: [],
        },
      ],
      hidden: [],
      stats: { files: 1, durationMs: 0 },
    };
    const text = formatGitHub(result, {
      root: "/repo",
      readText: () => "abc\ndef",
      verbose: true,
    });
    expect(text).toBe(
      [
        "::notice file=src/a%3Ab%2Cc.ts,line=1,col=1,endLine=1,endColumn=4,title=r/info::m — h",
        "::notice file=src/a%3Ab%2Cc.ts,line=1,col=1,endLine=1,endColumn=4,title=r/unknown::m — h",
        "::error file=src/a%3Ab%2Cc.ts,line=1,col=1,endLine=1,endColumn=4,title=r/failure::m — h",
        "::error file=src/a%3Ab%2Cc.ts,line=1,col=1,endLine=1,endColumn=4,title=r/multi::50%25 done%0Anext — first",
        "",
      ].join("\n"),
    );
  });

  it("leaves out the position when the file cannot be read", () => {
    const result: CheckResult = {
      findings: [
        {
          kind: "unknown",
          ruleId: "r/u",
          message: "m",
          hint: "h",
          location: { file: "/repo/a.ts", start: 0, end: 1 },
        },
      ],
      hidden: [],
      stats: { files: 1, durationMs: 0 },
    };
    expect(formatGitHub(result, { root: "/repo", readText: () => undefined, verbose: true })).toBe(
      "::notice file=a.ts,title=r/u::m — h\n",
    );
    // Without --verbose a place not checked that is an info is counted, not annotated.
    expect(formatGitHub(result, { root: "/repo", readText: () => undefined })).toBe("");
  });

  it("annotates places not checked as warnings, or not at all, as `unknowns` says", () => {
    const location = { file: "/repo/a.ts", start: 0, end: 1 };
    const result: CheckResult = {
      findings: [
        { kind: "unknown", ruleId: "r/w", message: "m", hint: "h", location, shown: "warning" },
        { kind: "unknown", ruleId: "r/o", message: "m", hint: "h", location, shown: "off" },
      ],
      hidden: [],
      stats: { files: 1, durationMs: 0 },
    };
    expect(formatGitHub(result, { root: "/repo", readText: () => undefined })).toBe(
      "::warning file=a.ts,title=r/w::m — h\n",
    );
  });

  describe("baselined findings", () => {
    let work = "";
    beforeEach(() => {
      work = mkdtempSync(path.join(fixtures, "tmp-"));
      cpSync(path.join(fixtures, "adopt"), work, { recursive: true });
      writeFileSync(
        path.join(work, "stateward.rollout.json"),
        JSON.stringify({ version: 1, enabled: ["records/lookup-misses-key"] }),
      );
    });
    afterEach(() => {
      rmSync(work, { recursive: true, force: true });
    });

    it("are not annotated", async () => {
      const before = await run(["check", "--format", "github"], work);
      expect(before.stdout).toContain("::error file=src/status.ts");
      await run(["baseline"], work);
      const after = await run(["check", "--format", "github"], work);
      expect(after.code).toBe(0);
      expect(after.stdout).not.toContain("::");
      expect(after.stdout).toContain("baselined");
    });
  });
});

describe("check --max-warnings", () => {
  const onlyWarning = ["check", "--rule", "team/max-union-members"];

  it("exits 0 without the option, however many warnings there are", async () => {
    expect((await run(onlyWarning, example)).code).toBe(0);
  });

  it("exits 1 when the warnings are more than n, and says why on stderr", async () => {
    const { code, stderr } = await run([...onlyWarning, "--max-warnings", "0"], example);
    expect(code).toBe(1);
    expect(stderr).toBe("stateward: 1 warning, more than the 0 allowed by --max-warnings\n");
  });

  it("exits 0 when the warnings are n or fewer", async () => {
    const { code, stderr } = await run([...onlyWarning, "--max-warnings", "1"], example);
    expect(code).toBe(0);
    expect(stderr).toBe("");
  });

  it("keeps exit 1 for errors and 2 for failures to run", async () => {
    expect((await run(["check", "--max-warnings", "99"], example)).code).toBe(1);
    // A folder with no config above it: not under the repo, whose own root config would be found.
    const bare = mkdtempSync(path.join(tmpdir(), "stateward-bare-"));
    try {
      expect((await run(["check", "--max-warnings", "1"], bare)).code).toBe(2);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("must be a whole number, and belongs to check", () => {
    expect(parseArgs(["check", "--max-warnings", "-1"])).toEqual({
      ok: false,
      errors: ['--max-warnings must be a whole number (0 or more), not "-1"'],
    });
    expect(parseArgs(["plan", "--max-warnings", "1"])).toEqual({
      ok: false,
      errors: ["--max-warnings only applies to check"],
    });
  });

  it("is in check --help with the exit codes", () => {
    expect(commandHelp("check")).toContain("--max-warnings <n>");
    expect(COMMAND_HELP.check.summary).toContain("Exit code: 0");
    expect(COMMAND_HELP.check.summary).toContain("2 when stateward could not run");
  });
});

describe("the GitHub Actions hint", () => {
  it("is the last line when GITHUB_ACTIONS is true and no --format was given", async () => {
    const { stdout } = await run(["check"], example, { GITHUB_ACTIONS: "true" });
    expect(
      stdout.endsWith(
        "Running in GitHub Actions: add `--format github` to see findings on the pull request\n",
      ),
    ).toBe(true);
  });

  it("is not printed elsewhere, nor with --format json", async () => {
    expect((await run(["check"], example)).stdout).not.toContain("Running in GitHub Actions");
    const json = await run(["check", "--format", "json"], example, { GITHUB_ACTIONS: "true" });
    expect(json.stdout).not.toContain("Running in GitHub Actions");
  });
});

describe("init --ci github", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "stateward-ci-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "app" }));
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const workflow = (): string => readFileSync(path.join(dir, WORKFLOW_FILE), "utf8");

  it.each([["package-lock.json"], ["pnpm-lock.yaml"], ["yarn.lock"], ["bun.lock"], [undefined]])(
    "writes the workflow for the lockfile %s",
    async (lockfile) => {
      if (lockfile !== undefined) writeFileSync(path.join(dir, lockfile), "");
      const { code, stdout } = await run(["init", "--yes", "--ci", "github"], dir);
      expect(code).toBe(0);
      expect(stdout).toContain(`Wrote ${WORKFLOW_FILE}`);
      expect(workflow()).toMatchSnapshot();
    },
  );

  it("uses yarn's immutable install when the project has .yarnrc.yml", async () => {
    writeFileSync(path.join(dir, "yarn.lock"), "");
    writeFileSync(path.join(dir, ".yarnrc.yml"), "");
    await run(["init", "--yes", "--ci", "github"], dir);
    expect(workflow()).toContain("yarn install --immutable");
  });

  it("uses --frozen-lockfile for yarn 1: a v1 lockfile header, or packageManager yarn@1", async () => {
    writeFileSync(path.join(dir, "yarn.lock"), "# yarn lockfile v1\n\n");
    await run(["init", "--yes", "--ci", "github"], dir);
    expect(workflow()).toMatchSnapshot();
    rmSync(path.join(dir, WORKFLOW_FILE));
    writeFileSync(path.join(dir, "yarn.lock"), "");
    writeFileSync(path.join(dir, "package.json"), '{"packageManager":"yarn@1.22.22"}');
    await run(["init", "--ci", "github"], dir);
    expect(workflow()).toContain("yarn install --frozen-lockfile");
  });

  it("uses --immutable for Yarn 2 and newer: a __metadata lockfile, or packageManager yarn@4", async () => {
    writeFileSync(path.join(dir, "yarn.lock"), "__metadata:\n  version: 8\n");
    await run(["init", "--yes", "--ci", "github"], dir);
    expect(workflow()).toMatchSnapshot();
    rmSync(path.join(dir, WORKFLOW_FILE));
    writeFileSync(path.join(dir, "yarn.lock"), "");
    writeFileSync(path.join(dir, "package.json"), '{"packageManager":"yarn@4.5.0"}');
    await run(["init", "--ci", "github"], dir);
    expect(workflow()).toContain("yarn install --immutable");
  });

  it("takes the Node version from engines.node, else .nvmrc, else .node-version, else 22", async () => {
    writeFileSync(path.join(dir, "package.json"), '{"name":"app","engines":{"node":">=20.11"}}');
    await run(["init", "--yes", "--ci", "github"], dir);
    expect(workflow()).toMatchSnapshot();
    rmSync(path.join(dir, WORKFLOW_FILE));
    writeFileSync(path.join(dir, "package.json"), '{"name":"app"}');
    writeFileSync(path.join(dir, ".nvmrc"), "v18.19.0\n");
    await run(["init", "--ci", "github"], dir);
    expect(workflow()).toContain('node-version: "18.19.0"\n');
    rmSync(path.join(dir, WORKFLOW_FILE));
    rmSync(path.join(dir, ".nvmrc"));
    writeFileSync(path.join(dir, ".node-version"), "24\n");
    await run(["init", "--ci", "github"], dir);
    expect(workflow()).toContain("node-version: 24\n");
    rmSync(path.join(dir, WORKFLOW_FILE));
    rmSync(path.join(dir, ".node-version"));
    await run(["init", "--ci", "github"], dir);
    expect(workflow()).toContain("node-version: 22\n");
  });

  it("runs on pushes to the default branch (origin/HEAD), and on every pull request", async () => {
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: dir });
    execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop"],
      { cwd: dir },
    );
    await run(["init", "--yes", "--ci", "github"], dir);
    expect(workflow()).toMatchSnapshot();
  });

  it("falls back to the branch checked out when there is no origin/HEAD", async () => {
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: dir });
    await run(["init", "--yes", "--ci", "github"], dir);
    expect(workflow()).toContain("    branches: [trunk]\n");
  });

  describe("when a workflow already runs stateward check", () => {
    const other = ".github/workflows/ci.yml";
    beforeEach(() => {
      mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        path.join(dir, other),
        "jobs:\n  x:\n    steps:\n      - run: npx stateward check\n",
      );
    });

    it("says so and writes no second one", async () => {
      const { code, stdout } = await run(["init", "--yes", "--ci", "github"], dir);
      expect(code).toBe(0);
      expect(stdout).toContain(
        ".github/workflows/ci.yml already runs `stateward check`; no second workflow written",
      );
      expect(existsSync(path.join(dir, WORKFLOW_FILE))).toBe(false);
    });

    it("writes it anyway with --force", async () => {
      const { stdout } = await run(["init", "--yes", "--ci", "github", "--force"], dir);
      expect(stdout).toContain(`Wrote ${WORKFLOW_FILE}`);
    });

    it("does not count a workflow that does not run it", async () => {
      writeFileSync(path.join(dir, other), "jobs:\n  x:\n    steps:\n      - run: npm test\n");
      const { stdout } = await run(["init", "--yes", "--ci", "github"], dir);
      expect(stdout).toContain(`Wrote ${WORKFLOW_FILE}`);
    });

    it("finds stateward behind a package.json script, two scripts deep", async () => {
      writeFileSync(path.join(dir, other), "jobs:\n  x:\n    steps:\n      - run: yarn lint\n");
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "app",
          scripts: {
            lint: "eslint . && yarn run lint:state",
            "lint:state": "npm run check:state",
            "check:state": "node node_modules/stateward/dist/bin.js check --max-warnings 0",
          },
        }),
      );
      const { code, stdout } = await run(["init", "--yes", "--ci", "github"], dir);
      expect(code).toBe(0);
      expect(stdout).toContain(
        ".github/workflows/ci.yml already runs stateward in `yarn lint` (package.json script `lint`); no second workflow written (`--force` writes .github/workflows/stateward.yml anyway).",
      );
      expect(existsSync(path.join(dir, WORKFLOW_FILE))).toBe(false);
    });

    it("does not follow a script chain more than two scripts deep", async () => {
      writeFileSync(path.join(dir, other), "jobs:\n  x:\n    steps:\n      - run: npm run a\n");
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "app",
          scripts: { a: "npm run b", b: "npm run c", c: "npm run d", d: "stateward check" },
        }),
      );
      const { stdout } = await run(["init", "--yes", "--ci", "github"], dir);
      expect(stdout).toContain(`Wrote ${WORKFLOW_FILE}`);
    });
  });

  it("accepts --force only on init", () => {
    expect(parseArgs(["check", "--force"])).toEqual({
      ok: false,
      errors: ["--force only applies to init"],
    });
  });

  it("never overwrites an existing workflow", async () => {
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(path.join(dir, WORKFLOW_FILE), "mine\n");
    const { code, stdout } = await run(["init", "--yes", "--ci", "github"], dir);
    expect(code).toBe(0);
    expect(stdout).toContain(`${WORKFLOW_FILE} already exists; nothing written.`);
    expect(workflow()).toBe("mine\n");
  });

  it("writes only the workflow when the config already exists", async () => {
    await run(["init", "--yes"], dir);
    const config = readFileSync(path.join(dir, "stateward.config.ts"), "utf8");
    const { stdout } = await run(["init", "--ci", "github"], dir);
    expect(stdout).toContain("stateward.config.ts already exists; kept.");
    expect(stdout).toContain(`Wrote ${WORKFLOW_FILE}`);
    expect(readFileSync(path.join(dir, "stateward.config.ts"), "utf8")).toBe(config);
  });

  it("writes nothing without --ci", async () => {
    await run(["init", "--yes"], dir);
    expect(existsSync(path.join(dir, WORKFLOW_FILE))).toBe(false);
  });

  it("writes the workflow at the root of a monorepo, running stateward in the package", async () => {
    writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    const app = path.join(dir, "packages", "app");
    mkdirSync(path.join(app, "src"), { recursive: true });
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "app" }));
    writeFileSync(path.join(app, "src", "a.ts"), "export const a = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const { code, stdout } = await run(["init", "--yes", "--ci", "github"], app);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Wrote ../../.github/workflows/stateward.yml, at the root of the repository where GitHub looks for it",
    );
    expect(existsSync(path.join(app, ".github"))).toBe(false);
    const text = workflow();
    expect(text).toContain("      - run: pnpm install --frozen-lockfile\n");
    expect(text).toContain(
      "      - run: npx --no stateward check --format github\n        working-directory: packages/app\n",
    );
    expect(text).toContain("          path: packages/app/node_modules/.cache/stateward\n");
    expect(text).toContain("hashFiles('packages/app/stateward.config.*')");
  });

  it("only accepts github", () => {
    expect(parseArgs(["init", "--ci", "gitlab"])).toEqual({
      ok: false,
      errors: ['--ci must be "github", not "gitlab"'],
    });
  });
});
