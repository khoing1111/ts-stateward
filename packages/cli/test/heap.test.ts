import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_MAX_MEMORY } from "@stateward/core/internal";
import { describe, expect, it } from "vitest";
import {
  commandOf,
  followsConfig,
  heapTarget,
  isOutOfMemory,
  maxMemoryArg,
  NO_RESPAWN_ENV,
  outOfMemoryMessage,
  planHeap,
  RESPAWNED_ENV,
  runWithHeap,
  usableMaxMemory,
} from "../src/heap.js";
import { parseArgs } from "../src/args.js";
import { main } from "../src/main.js";

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const cli = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const example = fileURLToPath(new URL("../../../examples/basic", import.meta.url));

describe("planHeap", () => {
  const node22 = {
    env: {},
    execArgv: [],
    heapLimit: 2096 * MB,
    totalMemory: 16 * GB,
    requested: undefined,
  };

  it("asks for 4 GB when Node's default is 2 GB on a 16 GB machine", () => {
    expect(planHeap(node22)).toEqual({ kind: "respawn", limitMb: 4096 });
  });

  it("asks for three quarters of a small machine's memory", () => {
    expect(heapTarget(4 * GB)).toBe(3072);
    expect(planHeap({ ...node22, totalMemory: 4 * GB })).toEqual({
      kind: "respawn",
      limitMb: 3072,
    });
  });

  it("keeps a limit that is already large enough", () => {
    // `--max-old-space-size=4096` reads back as 4144 MB (the young generation is added).
    expect(planHeap({ ...node22, heapLimit: 4144 * MB })).toEqual({ kind: "run-here" });
    expect(planHeap({ ...node22, heapLimit: 1600 * MB, totalMemory: 2 * GB })).toEqual({
      kind: "run-here",
    });
  });

  it("leaves a limit someone set alone, even a small one", () => {
    const set = {
      ...node22,
      env: { NODE_OPTIONS: "--enable-source-maps --max-old-space-size=1024" },
    };
    expect(planHeap(set)).toEqual({ kind: "run-here" });
    expect(planHeap({ ...node22, env: { NODE_OPTIONS: "--max_old_space_size=1024" } })).toEqual({
      kind: "run-here",
    });
    expect(planHeap({ ...node22, execArgv: ["--max-old-space-size=1024"] })).toEqual({
      kind: "run-here",
    });
  });

  it("never starts a third process, and can be turned off", () => {
    expect(planHeap({ ...node22, env: { [RESPAWNED_ENV]: "4096" } })).toEqual({ kind: "run-here" });
    expect(planHeap({ ...node22, env: { [NO_RESPAWN_ENV]: "1" } })).toEqual({ kind: "run-here" });
  });

  it("follows --max-memory over every other setting", () => {
    const set = { ...node22, env: { NODE_OPTIONS: "--max-old-space-size=1024" }, requested: 6144 };
    expect(planHeap(set)).toEqual({ kind: "respawn", limitMb: 6144 });
    expect(planHeap({ ...set, heapLimit: 8192 * MB })).toEqual({ kind: "respawn", limitMb: 6144 });
    expect(planHeap({ ...set, env: { [RESPAWNED_ENV]: "6144" } })).toEqual({ kind: "run-here" });
    expect(planHeap({ ...set, env: { [NO_RESPAWN_ENV]: "1" } })).toEqual({ kind: "run-here" });
  });

  it("reads --max-memory as args.ts accepts it", () => {
    expect(maxMemoryArg(["check", "--max-memory", "6144"], usableMaxMemory)).toBe(6144);
    expect(maxMemoryArg(["check", "--max-memory", "100"], usableMaxMemory)).toBeUndefined();
    expect(maxMemoryArg(["check", "--max-memory", "6g"], usableMaxMemory)).toBeUndefined();
    expect(maxMemoryArg(["check"], usableMaxMemory)).toBeUndefined();
    expect(usableMaxMemory(MIN_MAX_MEMORY)).toBe(true);
    expect(usableMaxMemory(MIN_MAX_MEMORY - 1)).toBe(false);
  });
});

describe("followsConfig", () => {
  const none = { env: {}, execArgv: [], maxMemory: 6144, flagGiven: false };

  it("runs again for the config's maxMemory, also after stateward chose a limit itself", () => {
    expect(followsConfig(none)).toBe(true);
    expect(
      followsConfig({
        ...none,
        env: { [RESPAWNED_ENV]: "4096" },
        execArgv: ["--max-old-space-size=4096"],
      }),
    ).toBe(true);
  });

  it("not when it already runs with it, or something else set the limit", () => {
    expect(followsConfig({ ...none, env: { [RESPAWNED_ENV]: "6144" } })).toBe(false);
    expect(followsConfig({ ...none, flagGiven: true })).toBe(false);
    expect(followsConfig({ ...none, env: { NODE_OPTIONS: "--max-old-space-size=2048" } })).toBe(
      false,
    );
    expect(followsConfig({ ...none, execArgv: ["--max-old-space-size=2048"] })).toBe(false);
    expect(followsConfig({ ...none, env: { [NO_RESPAWN_ENV]: "1" } })).toBe(false);
  });
});

describe("the out-of-memory message", () => {
  it("says the limit and the commands to raise it", () => {
    expect(outOfMemoryMessage(4096, "node_modules/stateward/dist/bin.js", "check")).toBe(
      "stateward ran out of memory (the limit was 4096 MB).\n" +
        "Raise it: `node --max-old-space-size=6144 node_modules/stateward/dist/bin.js check`, or set `NODE_OPTIONS=--max-old-space-size=6144` (docs/user/ci.md, Big projects)\n",
    );
  });

  it("suggests half as much again when the limit was already 6 GB or more", () => {
    expect(outOfMemoryMessage(6144, "bin.js", "check")).toContain("--max-old-space-size=9216 ");
  });

  it("names the command that was run", () => {
    expect(commandOf(["baseline", "--prune"])).toBe("baseline");
    expect(commandOf(["--cwd", "app"])).toBe("check");
    expect(commandOf([])).toBe("check");
  });

  it("is only for a process that died of a full heap", () => {
    const aborted = { kind: "exited", code: null, signal: "SIGABRT" } as const;
    const report =
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
    expect(isOutOfMemory(aborted, report)).toBe(true);
    expect(isOutOfMemory({ kind: "exited", code: 134, signal: null }, report)).toBe(true);
    expect(isOutOfMemory(aborted, "Assertion failed")).toBe(false);
    expect(isOutOfMemory({ kind: "exited", code: 0, signal: null }, report)).toBe(false);
    expect(isOutOfMemory({ kind: "not-started" }, report)).toBe(false);
  });
});

describe("stateward in a second process", { timeout: 60_000 }, () => {
  it("recognises a full heap and holds V8's crash report back", async () => {
    let passed = "";
    const { end, held, errorTail } = await runWithHeap({
      script: cli,
      args: ["check", "--no-cache", "--cwd", example],
      execArgv: [],
      env: process.env,
      limitMb: 24,
      stderr: (text) => {
        passed += text;
      },
      forwardSignals: false,
    });
    expect(isOutOfMemory(end, errorTail)).toBe(true);
    expect(held).toContain("heap out of memory");
    expect(passed).not.toContain("Last few GCs");
  });

  it("passes the output and the exit code through", () => {
    const unset = new Set([RESPAWNED_ENV, NO_RESPAWN_ENV, "NODE_OPTIONS"]);
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !unset.has(name))),
      NO_COLOR: "1",
    };
    const args = [cli, "check", "--no-cache", "--cwd", example];
    const respawned = spawnSync(process.execPath, args, { encoding: "utf8", env });
    const here = spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: { ...env, [NO_RESPAWN_ENV]: "1" },
    });
    expect(respawned.status).toBe(1);
    expect(respawned.status).toBe(here.status);
    const withoutTime = (text: string): string => text.replace(/\(\d+(\.\d+)? m?s\)/, "");
    expect(withoutTime(respawned.stdout)).toBe(withoutTime(here.stdout));
    expect(respawned.stderr).toBe(here.stderr);
  });
});

describe("--max-memory and maxMemory", { timeout: 60_000 }, () => {
  it("checks the value and where it applies", () => {
    expect(parseArgs(["check", "--max-memory", "6144"]).ok).toBe(true);
    expect(parseArgs(["baseline", "--max-memory", "6144"]).ok).toBe(true);
    expect(parseArgs(["check", "--max-memory", "100"])).toEqual({
      ok: false,
      errors: ['--max-memory must be a whole number of MB, at least 512 (like 6144), not "100"'],
    });
    expect(parseArgs(["init", "--max-memory", "6144"])).toEqual({
      ok: false,
      errors: [
        "--max-memory only applies to check, baseline, coverage, plan, next, deps, guarantees",
      ],
    });
  });

  it("runs the command again with the config's maxMemory and ends with its exit code", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-heap-"));
    try {
      writeFileSync(
        path.join(dir, "stateward.config.mjs"),
        "export default { preset: 'recommended', plugins: [], maxMemory: 6144 };\n",
      );
      writeFileSync(path.join(dir, "tsconfig.json"), '{ "include": ["*.ts"] }\n');
      writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
      const asked: number[] = [];
      let stdout = "";
      const env = {
        cwd: dir,
        stdout: (text: string) => (stdout += text),
        stderr: () => undefined,
        color: false,
      };
      const restarted = await main(["check"], {
        ...env,
        restartWithMemory: (limitMb) => {
          asked.push(limitMb);
          return Promise.resolve(1);
        },
      });
      expect(asked).toEqual([6144]);
      expect(restarted).toBe(1);
      expect(stdout).toBe("");
      // Already running with it: the command runs here.
      const here = await main(["check"], {
        ...env,
        restartWithMemory: () => Promise.resolve(undefined),
      });
      expect(here).toBe(0);
      expect(stdout).toContain("No rules are on");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a maxMemory that is not a whole number of MB", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-heap-"));
    try {
      writeFileSync(
        path.join(dir, "stateward.config.mjs"),
        "export default { preset: 'recommended', plugins: [], maxMemory: '6g' };\n",
      );
      let stderr = "";
      const code = await main(["check"], {
        cwd: dir,
        stdout: () => undefined,
        stderr: (text) => (stderr += text),
        color: false,
      });
      expect(code).toBe(2);
      expect(stderr).toContain(
        'maxMemory must be a whole number of MB, at least 512 (like 6144), got "6g"',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes the output and the exit code through with --max-memory", () => {
    const args = [cli, "check", "--no-cache", "--max-memory", "1024", "--cwd", example];
    const env = { ...process.env, NO_COLOR: "1" };
    const respawned = spawnSync(process.execPath, args, { encoding: "utf8", env });
    expect(respawned.status).toBe(1);
    expect(respawned.stdout).toContain("3 errors");
  });
});
