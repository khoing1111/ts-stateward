import { spawn } from "node:child_process";

/**
 * The heap stateward runs with. Node's default heap limit is about 2 GB up to Node 22 whatever the
 * machine has, which a project of a few thousand files can need more than. When nothing else sets the limit, the command starts
 * itself once more with a larger one;
 * that second process is watched, so running out of memory ends with a plain message instead of
 * V8's crash report. `--max-memory <MB>` and the config's `maxMemory` set the limit on every
 * system (Windows' `cmd` has no `NODE_OPTIONS=… command`).
 */

/** Set in the environment of the second process to its limit (MB), so it never starts a third. */
export const RESPAWNED_ENV = "STATEWARD_RESPAWNED";
/** `STATEWARD_NO_RESPAWN=1` keeps the command in its first process, with Node's own limit. */
export const NO_RESPAWN_ENV = "STATEWARD_NO_RESPAWN";
/** The largest heap stateward asks for by itself (MB). */
export const HEAP_CAP_MB = 4096;
/** The share of the machine's memory stateward asks for at most. */
const MEMORY_SHARE = 0.75;
/** The least limit the out-of-memory message suggests (MB): above any stateward sets itself. */
const SUGGESTED_MB = 6144;

const MB = 1024 * 1024;
const HEAP_FLAG = /--max[-_]old[-_]space[-_]size\b/;

/** The heap limit stateward asks for on a machine with `totalMemory` bytes (MB). */
export function heapTarget(totalMemory: number): number {
  return Math.min(HEAP_CAP_MB, Math.floor((totalMemory / MB) * MEMORY_SHARE));
}

/** The least `--max-memory` (MB): the same as core's `MIN_MAX_MEMORY`, without loading core. */
const LEAST_MAX_MEMORY = 512;

/** Whether `--max-memory` may be followed before args.ts has checked it (heap.test.ts). */
export function usableMaxMemory(mb: number): boolean {
  return Number.isInteger(mb) && mb >= LEAST_MAX_MEMORY;
}

/** The limit `--max-memory <MB>` asks for; undefined without it or with a value args.ts refuses. */
export function maxMemoryArg(
  args: readonly string[],
  isValid: (mb: number) => boolean,
): number | undefined {
  const at = args.indexOf("--max-memory");
  const value = at === -1 ? undefined : args[at + 1];
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const mb = Number(value);
  return isValid(mb) ? mb : undefined;
}

export type HeapPlan =
  { readonly kind: "run-here" } | { readonly kind: "respawn"; readonly limitMb: number };

type HeapState = {
  env: Readonly<Record<string, string | undefined>>;
  execArgv: readonly string[];
};

function setByNode({ env, execArgv }: HeapState): boolean {
  return HEAP_FLAG.test(env.NODE_OPTIONS ?? "") || execArgv.some((arg) => HEAP_FLAG.test(arg));
}

/**
 * Whether to run in this process or start a second one with another heap limit. `--max-memory`
 * is always followed. Otherwise only when nobody set the limit (in `NODE_OPTIONS` or on node's
 * command line), this is not already the second process, and the current limit is below the
 * target. `STATEWARD_NO_RESPAWN=1` turns both off.
 */
export function planHeap({
  env,
  execArgv,
  heapLimit,
  totalMemory,
  requested,
}: HeapState & {
  /** `v8.getHeapStatistics().heap_size_limit`, bytes. */
  heapLimit: number;
  /** `os.totalmem()`, bytes. */
  totalMemory: number;
  /** `--max-memory <MB>`. */
  requested: number | undefined;
}): HeapPlan {
  if (env[NO_RESPAWN_ENV] === "1") return { kind: "run-here" };
  if (requested !== undefined) {
    return env[RESPAWNED_ENV] === String(requested)
      ? { kind: "run-here" }
      : { kind: "respawn", limitMb: requested };
  }
  if (env[RESPAWNED_ENV] !== undefined || setByNode({ env, execArgv })) return { kind: "run-here" };
  const target = heapTarget(totalMemory);
  return heapLimit / MB < target ? { kind: "respawn", limitMb: target } : { kind: "run-here" };
}

/**
 * Whether the config's `maxMemory` needs another process: not when `--max-memory`, `NODE_OPTIONS`
 * or node's command line set the limit (they win over the config), not when this process already
 * runs with it, and not when turned off.
 */
export function followsConfig(
  state: HeapState & { maxMemory: number; flagGiven: boolean },
): boolean {
  const { env, maxMemory, flagGiven } = state;
  if (flagGiven || env[NO_RESPAWN_ENV] === "1" || env[RESPAWNED_ENV] === String(maxMemory)) {
    return false;
  }
  // Started by stateward itself: the limit there is stateward's own choice, which the config overrides.
  return env[RESPAWNED_ENV] !== undefined || !setByNode(state);
}

/** How the second process ended. */
export type ChildEnd =
  | {
      readonly kind: "exited";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  /** It could not be started at all (the command then runs in the first process). */
  | { readonly kind: "not-started" };

/** Where V8's report of a fatal error starts: everything from here on is held back. */
const CRASH_REPORT = /\n?<--- Last few GCs --->|\n?FATAL ERROR:/;
const OUT_OF_MEMORY = /heap out of memory|Allocation failed - process out of memory/;
/** The end of the second process's error output that is kept to recognise the crash (chars). */
const TAIL = 16_384;

/** Whether the second process died because its heap was full. */
export function isOutOfMemory(end: ChildEnd, errorTail: string): boolean {
  if (end.kind !== "exited" || (end.code === 0 && end.signal === null)) return false;
  return OUT_OF_MEMORY.test(errorTail);
}

/**
 * What stateward prints when its heap was full. `bin` is the stateward script as the developer
 * can type it, `command` the stateward command run.
 */
export function outOfMemoryMessage(limitMb: number, bin: string, command: string): string {
  const raised = String(Math.max(SUGGESTED_MB, Math.ceil((limitMb * 1.5) / 1024) * 1024));
  return (
    `stateward ran out of memory (the limit was ${String(limitMb)} MB).\n` +
    `Raise it: \`node --max-old-space-size=${raised} ${bin} ${command}\`, or set ` +
    `\`NODE_OPTIONS=--max-old-space-size=${raised}\` (docs/user/ci.md, Big projects)\n`
  );
}

/**
 * Runs `script` with `args` in a second node process with a `limitMb` heap. Standard input and
 * output are shared; error output passes through `stderr`, except V8's crash report, which is
 * held back and returned so the caller can say what happened instead.
 */
export function runWithHeap({
  script,
  args,
  execArgv,
  env,
  limitMb,
  stderr,
  forwardSignals = true,
}: {
  script: string;
  args: readonly string[];
  execArgv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  limitMb: number;
  stderr: (text: string) => void;
  /** Pass SIGINT, SIGTERM and SIGHUP sent to this process on to the second one. */
  forwardSignals?: boolean;
}): Promise<{ end: ChildEnd; held: string; errorTail: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...execArgv, `--max-old-space-size=${String(limitMb)}`, script, ...args],
      {
        stdio: ["inherit", "inherit", "pipe"],
        env: { ...env, [RESPAWNED_ENV]: String(limitMb) },
      },
    );
    let held = "";
    let holding = false;
    let errorTail = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorTail = (errorTail + chunk).slice(-TAIL);
      if (holding) {
        held += chunk;
        return;
      }
      const at = chunk.search(CRASH_REPORT);
      if (at === -1) {
        stderr(chunk);
        return;
      }
      if (at > 0) stderr(chunk.slice(0, at));
      held = chunk.slice(at);
      holding = true;
    });
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    const forward = (signal: NodeJS.Signals): void => {
      child.kill(signal);
    };
    if (forwardSignals) for (const signal of signals) process.on(signal, forward);
    let finished = false;
    const done = (end: ChildEnd): void => {
      if (finished) return;
      finished = true;
      if (forwardSignals) for (const signal of signals) process.off(signal, forward);
      resolve({ end, held, errorTail });
    };
    child.on("error", () => {
      done({ kind: "not-started" });
    });
    child.on("close", (code, signal) => {
      done({ kind: "exited", code, signal });
    });
  });
}

/** The stateward command named in `args`, for the out-of-memory message (`check` by default). */
export function commandOf(args: readonly string[]): string {
  const first = args[0];
  return first !== undefined && /^[a-z][a-z-]*$/.test(first) ? first : "check";
}
