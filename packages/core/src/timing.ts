import { getHeapStatistics } from "node:v8";
import type { TypeQueries } from "./types.js";

/**
 * Where a check spends its time, rule by rule (`check --timing`, `pnpm run bench:rules`): for the
 * developers of stateward and of rule packs, not part of a result. Nothing here runs unless a
 * caller passes a recorder (`createChecker({ timing })`); without one the engine only tests that
 * it is undefined.
 */

/** One rule's cost in one run. */
export type RuleCost = {
  readonly ruleId: string;
  readonly kind: "file" | "project";
  /** Wall time in the rule's own code: its file side plus, for a project rule, its check. */
  readonly ms: number;
  /** A project rule's file side (`summarize`); a file rule's `check` on each file. */
  readonly fileMs: number;
  /** A project rule's `check` over every summary, with the summaries parsed for it. 0 for a file rule. */
  readonly projectMs: number;
  /**
   * Of `ms`, the time inside type questions (`TypeQueries`): mostly the type checking a question
   * triggers first, which later questions of any rule then reuse.
   */
  readonly typeMs: number;
  /** Files the rule ran on (not counting results reused from the cache). */
  readonly files: number;
  /**
   * With a second pass (`createTimingRecorder({ secondPass: true })`): the rule's time when run
   * again on every file after the whole check, the type checker warm. What is left is the rule's
   * own work and the questions nothing caches; the difference to `fileMs` is type checking that
   * the rule was the first to ask for. Undefined without a second pass.
   */
  readonly warmMs: number | undefined;
  /** Of `warmMs`, inside type questions. */
  readonly warmTypeMs: number | undefined;
  /** Files whose result was taken from the cache instead. */
  readonly reused: number;
  /**
   * Bytes the heap grew by while the rule ran, summed over its runs: an estimate of what it
   * allocated (most of it freed again), not memory it holds. It undercounts when a garbage
   * collection lands inside a run.
   */
  readonly allocatedBytes: number;
};

/** One run's costs: the phases around the rules, and each rule (by time, largest first). */
export type RunTiming = {
  /** Wall time of the whole check, from the start of program building to the result (without a second pass). */
  readonly totalMs: number;
  /** Building the TypeScript programs (parsing, module resolution) and binding them. */
  readonly programMs: number;
  /** Of the rules' time, inside type questions: the type checking the rules ask for. */
  readonly typeMs: number;
  /** Dependency fingerprints for the results cache. */
  readonly fingerprintMs: number;
  /** Everything else: syntax and import findings, ignore comments, sorting, the cache. */
  readonly otherMs: number;
  /** The second pass's time (not part of the check's result), when there was one. */
  readonly secondPassMs: number | undefined;
  readonly rules: readonly RuleCost[];
};

type Mutable = {
  ruleId: string;
  kind: "file" | "project";
  warmMs: number;
  warmTypeMs: number;
  fileMs: number;
  projectMs: number;
  typeMs: number;
  files: number;
  reused: number;
  allocatedBytes: number;
};

/** The recorder the engine reports to while a check runs. */
export type TimingRecorder = {
  /** The time of building programs, added to `programMs`. */
  program(ms: number): void;
  fingerprint(ms: number): void;
  /** Runs `run` as `ruleId`'s file side on one file and records its cost. */
  fileSide<T>(ruleId: string, kind: "file" | "project", run: () => T): T;
  /** Counts one result of `ruleId` reused from the cache. */
  reused(ruleId: string, kind: "file" | "project"): void;
  /** Whether the engine runs every rule again after the check, to measure it warm. */
  readonly secondPass: boolean;
  /** Runs `run` as `ruleId`'s file side on one file in the second pass and records its cost. */
  warmSide(ruleId: string, kind: "file" | "project", run: () => void): void;
  /** Runs `run` as a project rule's check and records its cost. */
  projectSide<T>(ruleId: string, run: () => T): T;
  /** `types` with the time of every question added to the rule that is running. */
  timedTypes(types: TypeQueries): TypeQueries;
  /** Marks the start of a run (resets nothing: one recorder is one run). */
  start(): void;
  /** The costs so far, with the run's total measured up to now. */
  result(): RunTiming;
};

const usedHeap = (): number => getHeapStatistics().used_heap_size;

export function createTimingRecorder({
  secondPass = false,
}: {
  /** Run every rule a second time after the check (`RuleCost.warmMs`): for benchmarks. */
  secondPass?: boolean;
} = {}): TimingRecorder {
  const rules = new Map<string, Mutable>();
  let started = performance.now();
  let programMs = 0;
  let fingerprintMs = 0;
  /** The type time of the rule that is running; undefined between rules. */
  let current: Mutable | undefined;
  const wrapped = new WeakMap<TypeQueries, TypeQueries>();

  const costOf = (ruleId: string, kind: "file" | "project"): Mutable => {
    let found = rules.get(ruleId);
    if (found === undefined) {
      found = {
        ruleId,
        kind,
        warmMs: 0,
        warmTypeMs: 0,
        fileMs: 0,
        projectMs: 0,
        typeMs: 0,
        files: 0,
        reused: 0,
        allocatedBytes: 0,
      };
      rules.set(ruleId, found);
    }
    return found;
  };

  /** Where the type questions of the rule that is running are added. */
  let typeSide: "typeMs" | "warmTypeMs" = "typeMs";

  const measure = <T>(cost: Mutable, side: "fileMs" | "projectMs" | "warmMs", run: () => T): T => {
    const outer = current;
    const outerSide = typeSide;
    current = cost;
    typeSide = side === "warmMs" ? "warmTypeMs" : "typeMs";
    const heap = usedHeap();
    const at = performance.now();
    try {
      return run();
    } finally {
      cost[side] += performance.now() - at;
      // The heap is the check's own: the second pass's growth is not added.
      if (side !== "warmMs") cost.allocatedBytes += Math.max(0, usedHeap() - heap);
      current = outer;
      typeSide = outerSide;
    }
  };

  return {
    program(ms) {
      programMs += ms;
    },
    fingerprint(ms) {
      fingerprintMs += ms;
    },
    fileSide(ruleId, kind, run) {
      const cost = costOf(ruleId, kind);
      cost.files += 1;
      return measure(cost, "fileMs", run);
    },
    secondPass,
    warmSide(ruleId, kind, run) {
      measure(costOf(ruleId, kind), "warmMs", run);
    },
    reused(ruleId, kind) {
      costOf(ruleId, kind).reused += 1;
    },
    projectSide(ruleId, run) {
      return measure(costOf(ruleId, "project"), "projectMs", run);
    },
    timedTypes(types) {
      const known = wrapped.get(types);
      if (known !== undefined) return known;
      const methods = new Map<string | symbol, unknown>();
      const proxy = new Proxy(types, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== "function") return value;
          let method = methods.get(key);
          if (method === undefined) {
            method = (...args: unknown[]): unknown => {
              const cost = current;
              if (cost === undefined) {
                const untimed: unknown = Reflect.apply(value, target, args);
                return untimed;
              }
              // A question asked inside another (none today) is counted once, by the outer one.
              current = undefined;
              const at = performance.now();
              try {
                const answer: unknown = Reflect.apply(value, target, args);
                return answer;
              } finally {
                cost[typeSide] += performance.now() - at;
                current = cost;
              }
            };
            methods.set(key, method);
          }
          return method;
        },
      });
      wrapped.set(types, proxy);
      return proxy;
    },
    start() {
      started = performance.now();
    },
    result() {
      const elapsed = performance.now() - started;
      const costs = [...rules.values()]
        .map((cost) => ({
          ...cost,
          ms: cost.fileMs + cost.projectMs,
          warmMs: secondPass ? cost.warmMs : undefined,
          warmTypeMs: secondPass ? cost.warmTypeMs : undefined,
        }))
        .sort((a, b) => b.ms - a.ms || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
      const ruleMs = costs.reduce((sum, cost) => sum + cost.ms, 0);
      const warmMs = costs.reduce((sum, cost) => sum + (cost.warmMs ?? 0), 0);
      const typeMs = costs.reduce((sum, cost) => sum + cost.typeMs, 0);
      // The second pass is not part of the check: the total is what the check alone took.
      const totalMs = elapsed - warmMs;
      return {
        totalMs,
        programMs,
        typeMs,
        fingerprintMs,
        otherMs: Math.max(0, totalMs - programMs - fingerprintMs - ruleMs),
        secondPassMs: secondPass ? warmMs : undefined,
        rules: costs,
      };
    },
  };
}
