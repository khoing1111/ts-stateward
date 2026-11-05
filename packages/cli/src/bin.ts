#!/usr/bin/env node
import { readFileSync } from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";

import {
  commandOf,
  followsConfig,
  isOutOfMemory,
  maxMemoryArg,
  outOfMemoryMessage,
  planHeap,
  runWithHeap,
  usableMaxMemory,
} from "./heap.js";

const args = process.argv.slice(2);
const script = fileURLToPath(import.meta.url);

/** The script as the developer can type it: relative to their folder when it is inside it. */
function scriptShown(): string {
  const relative = path.relative(process.cwd(), script);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? script
    : relative.split(path.sep).join("/");
}

/**
 * Runs the command in another process with a `limitMb` heap (`heap.ts`) and returns its exit
 * code; undefined when that process could not be started (the command then runs here).
 */
async function runElsewhere(limitMb: number): Promise<number | undefined> {
  const { end, held, errorTail } = await runWithHeap({
    script,
    args,
    execArgv: process.execArgv,
    env: process.env,
    limitMb,
    stderr: (text) => process.stderr.write(text),
  });
  if (end.kind === "not-started") return undefined;
  if (isOutOfMemory(end, errorTail)) {
    process.stderr.write(outOfMemoryMessage(limitMb, scriptShown(), commandOf(args)));
    return 2;
  }
  process.stderr.write(held);
  if (end.signal !== null) {
    // Ended by a signal (Ctrl-C): end the same way, so the shell sees what happened.
    process.kill(process.pid, end.signal);
    return 128 + os.constants.signals[end.signal];
  }
  return end.code ?? 1;
}

const requested = maxMemoryArg(args, usableMaxMemory);
const plan = planHeap({
  env: process.env,
  execArgv: process.execArgv,
  heapLimit: v8.getHeapStatistics().heap_size_limit,
  totalMemory: os.totalmem(),
  requested,
});
const exitCode = plan.kind === "respawn" ? await runElsewhere(plan.limitMb) : undefined;
if (exitCode === undefined) await runHere();
else process.exitCode = exitCode;

/** The command itself, in this process. */
async function runHere(): Promise<void> {
  // Node's on-disk cache of compiled code (as tsc enables it since TypeScript 5.7): loading
  // TypeScript's 9 MB compiler is a fifth of a run answered from stateward's own cache. Node 20 has
  // no such cache; NODE_DISABLE_COMPILE_CACHE turns it off. Enabled before anything else loads.
  if ("enableCompileCache" in module && typeof module.enableCompileCache === "function") {
    module.enableCompileCache();
  }

  const { defaultCacheDir } = await import("@stateward/core/internal");
  const { main } = await import("./main.js");

  /** The version in this package's package.json, or undefined when it cannot be read. */
  function readVersion(): string | undefined {
    try {
      const manifest: unknown = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      );
      if (typeof manifest === "object" && manifest !== null && "version" in manifest) {
        return typeof manifest.version === "string" ? manifest.version : undefined;
      }
    } catch {
      // An unreadable package.json only means `--version` cannot say.
    }
    return undefined;
  }

  // Questions only when a person is there to answer them: both ends must be terminals.
  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  process.exitCode = await main(args, {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    color: process.stdout.isTTY && process.env.NO_COLOR === undefined,
    terminal: interactive ? { input: process.stdin, output: process.stdout } : undefined,
    version: readVersion(),
    environment: process.env,
    cacheDir: (project) => defaultCacheDir(project, process.env),
    restartWithMemory: async (limitMb) => {
      const state = { env: process.env, execArgv: process.execArgv };
      if (!followsConfig({ ...state, maxMemory: limitMb, flagGiven: requested !== undefined })) {
        return undefined;
      }
      const code = await runElsewhere(limitMb);
      return code === undefined ? undefined : code === 0 || code === 1 ? code : 2;
    },
  });
}
