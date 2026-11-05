import { createPropagationMemo, propagate } from "@stateward/core";
import type { Json, Location } from "@stateward/core";
import { builtinParent, isBuiltin } from "./builtins.js";
import { ANONYMOUS, REASON } from "./summarize.js";
import { readSummary } from "./summary.js";
import type {
  ClassFact,
  Effect,
  FunctionFact,
  Handler,
  PackageFacts,
  ThrowsSummary,
} from "./summary.js";

/** `zod 3.23.8`, or `zod` when its version is not known. */
export function packageLabel(facts: Pick<PackageFacts, "name" | "version">): string {
  return facts.version === "" ? facts.name : `${facts.name} ${facts.version}`;
}

/** Something that cannot be followed, where it is and why: shown as `api.get: no declaration`. */
export type Source = {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly reason: string;
  /** The package whose facts this unknown comes from, when it does. */
  readonly package?: string;
};

/** At most this many unknown sources are kept per set; `more` says there were others. */
const MAX_SOURCES = 50;

/**
 * A set of errors: known classes by id (true when the class surely reaches here, false when it
 * may have been handled by a test this analysis does not read), and the unknown sources.
 */
export type Thrown = {
  readonly classes: ReadonlyMap<string, boolean>;
  /**
   * Where a class known from a package's facts comes from, by id: `zod 3.23.8: declared`
   *. Classes of the project have none.
   */
  readonly origins: ReadonlyMap<string, string>;
  readonly unknowns: readonly Source[];
  readonly more: boolean;
};

/** What calling a function throws, and what the promise it returns rejects with. */
export type Result = { readonly throws: Thrown; readonly rejects: Thrown };

/** Where a class first comes into a set: the call that brings it, null for a `throw`. */
export type Via = Location & { readonly text: string };

/** The set while it is being computed, with where each class comes from. */
export type Collected = {
  readonly classes: Map<string, { certain: boolean; via: Via | null; from: string | null }>;
  readonly unknowns: Map<string, Source>;
  more: boolean;
};

export type FunctionEntry = { readonly file: string; readonly fact: FunctionFact };

export type Analysis = {
  readonly functions: ReadonlyMap<string, FunctionEntry>;
  readonly classes: ReadonlyMap<string, ClassFact>;
  readonly results: ReadonlyMap<string, Result>;
  /** Every class's facts as one text: equal texts, equal `instanceof` answers. */
  readonly classesKey: string;
  /** The top-level code of each file. */
  readonly modules: readonly { file: string; effects: readonly Effect[] }[];
  /** Functions computed by this solve (not reused from the last one): early cut-off at work. */
  readonly computed: number;
};

/** A catch as the evaluation met it: what its `try` throws, and what no branch handles. */
export type CatchSeen = {
  readonly file: string;
  readonly handler: Handler;
  readonly thrown: Collected;
  readonly unhandled: ReadonlyMap<
    string,
    { certain: boolean; via: Via | null; from: string | null }
  >;
};

const EMPTY: Thrown = { classes: new Map(), origins: new Map(), unknowns: [], more: false };
const NOTHING: Result = { throws: EMPTY, rejects: EMPTY };

export function collected(): Collected {
  return { classes: new Map(), unknowns: new Map(), more: false };
}

function sourceKey(source: Source): string {
  return `${source.file}\u0000${String(source.start)}\u0000${String(source.end)}\u0000${source.reason}`;
}

function addClass(
  into: Collected,
  id: string,
  certain: boolean,
  via: Via | null,
  from: string | null = null,
): void {
  const known = into.classes.get(id);
  if (known === undefined) {
    into.classes.set(id, { certain, via, from });
    return;
  }
  if (certain && !known.certain) known.certain = true;
  // The least label: the same whatever order the sets were merged in.
  if (from !== null && (known.from === null || from < known.from)) known.from = from;
}

function addSource(into: Collected, source: Source): void {
  into.unknowns.set(sourceKey(source), source);
}

function merge(into: Collected, from: Collected, certain = true): void {
  for (const [id, info] of from.classes) {
    addClass(into, id, certain && info.certain, info.via, info.from);
  }
  for (const source of from.unknowns.values()) addSource(into, source);
  into.more ||= from.more;
}

function mergeThrown(into: Collected, from: Thrown, via: Via): void {
  for (const [id, certain] of from.classes) {
    addClass(into, id, certain, via, from.origins.get(id) ?? null);
  }
  for (const source of from.unknowns) addSource(into, source);
  into.more ||= from.more;
}

function compareSources(a: Source, b: Source): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return (
    a.start - b.start || a.end - b.end || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)
  );
}

/** The set as a result: classes sorted by id, unknown sources sorted and capped. */
export function toThrown(from: Collected): Thrown {
  const ids = [...from.classes.keys()].sort();
  const sources = [...from.unknowns.values()].sort(compareSources);
  const origins = new Map<string, string>();
  for (const id of ids) {
    const origin = from.classes.get(id)?.from;
    if (origin !== undefined && origin !== null) origins.set(id, origin);
  }
  return {
    classes: new Map(ids.map((id) => [id, from.classes.get(id)?.certain ?? false])),
    origins,
    unknowns: sources.slice(0, MAX_SOURCES),
    more: from.more || sources.length > MAX_SOURCES,
  };
}

function sameThrown(a: Thrown, b: Thrown): boolean {
  if (a.classes.size !== b.classes.size || a.unknowns.length !== b.unknowns.length) return false;
  if (a.more !== b.more) return false;
  for (const [id, certain] of a.classes) if (b.classes.get(id) !== certain) return false;
  if (a.origins.size !== b.origins.size) return false;
  for (const [id, origin] of a.origins) if (b.origins.get(id) !== origin) return false;
  return a.unknowns.every((source, i) => {
    const other = b.unknowns[i];
    return (
      other !== undefined && sourceKey(source) === sourceKey(other) && source.text === other.text
    );
  });
}

export function sameResult(a: Result, b: Result): boolean {
  return sameThrown(a.throws, b.throws) && sameThrown(a.rejects, b.rejects);
}

/**
 * Whether `instanceof <handler>` is true for an error of class `cls`: "yes" when `handler` is the
 * class or one it extends, "no" when the chain is known and does not reach it, "undecided" when
 * the chain cannot be followed.
 */
export function relation(
  handler: string,
  cls: string,
  classes: ReadonlyMap<string, ClassFact>,
): "yes" | "no" | "undecided" {
  let current: string | null = cls;
  const seen = new Set<string>();
  while (current !== null) {
    if (current === handler) return "yes";
    if (seen.has(current)) return "undecided";
    seen.add(current);
    if (isBuiltin(current)) {
      current = builtinParent(current);
      continue;
    }
    const fact = classes.get(current);
    if (fact === undefined || fact.open) return "undecided";
    current = fact.parent;
  }
  return "no";
}

/** What evaluating a function body needs. */
type Context = {
  readonly file: string;
  readonly classes: ReadonlyMap<string, ClassFact>;
  resultOf(id: string): Result | undefined;
  /** Told about every catch the evaluation passes, for `catch-misses-error`. */
  onCatch?: (seen: CatchSeen) => void;
};

function locationOf(file: string, at: readonly [number, number]): Location {
  return { file, start: at[0], end: at[1] };
}

/** Adds what `effects` throw to `into`; `caught` holds, by catch, what reaches its variable. */
export function evaluate(
  effects: readonly Effect[],
  context: Context,
  caught: ReadonlyMap<number, Collected>,
  into: Collected,
): void {
  const { file } = context;
  for (const effect of effects) {
    switch (effect.k) {
      case "class":
        addClass(
          into,
          effect.id,
          true,
          effect.text === null ? null : { ...locationOf(file, effect.at), text: effect.text },
        );
        break;
      case "unknown":
        addSource(into, {
          ...locationOf(file, effect.at),
          text: effect.text,
          reason: effect.reason,
        });
        break;
      case "call": {
        const result = context.resultOf(effect.id);
        if (result === undefined) {
          addSource(into, {
            ...locationOf(file, effect.at),
            text: effect.text,
            reason: REASON.noDeclaration,
          });
          break;
        }
        const via = { ...locationOf(file, effect.at), text: `${effect.text}(…)` };
        if (effect.part !== "rejects") mergeThrown(into, result.throws, via);
        if (effect.part !== "throws") mergeThrown(into, result.rejects, via);
        break;
      }
      case "package": {
        const { facts } = effect;
        const side = facts[effect.part];
        const label = packageLabel(facts);
        const via = { ...locationOf(file, effect.at), text: `${effect.text}(…)` };
        for (const id of side.classes) addClass(into, id, true, via, `${label}: ${facts.source}`);
        for (const reason of side.unknown) {
          addSource(into, {
            ...locationOf(file, effect.at),
            text: effect.text,
            reason: `${label}: ${reason}`,
            package: facts.name,
          });
        }
        break;
      }
      case "maybe": {
        // What the callback throws, evaluated apart: its own catches are checked as its own function.
        const inner = collected();
        const quiet: Context = {
          file,
          classes: context.classes,
          resultOf: (id) => context.resultOf(id),
        };
        evaluate(effect.body, quiet, caught, inner);
        if (inner.classes.size > 0 || inner.unknowns.size > 0 || inner.more) {
          addSource(into, {
            ...locationOf(file, effect.at),
            text: effect.text,
            reason: effect.reason,
          });
        }
        break;
      }
      case "rethrow": {
        const reaching = caught.get(effect.of);
        if (reaching === undefined) {
          addSource(into, {
            ...locationOf(file, effect.at),
            text: "throw",
            reason: "a caught error thrown from elsewhere",
          });
        } else {
          merge(into, reaching, !effect.maybe);
        }
        break;
      }
      case "try": {
        const body = collected();
        evaluate(effect.body, context, caught, body);
        if (effect.handler === null) merge(into, body);
        else evaluateCatch(effect.handler, body, context, caught, into);
        evaluate(effect.fin, context, caught, into);
        break;
      }
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }
}

function withUnknowns(from: Collected): Collected {
  const made = collected();
  for (const [key, source] of from.unknowns) made.unknowns.set(key, source);
  made.more = from.more;
  return made;
}

function evaluateCatch(
  handler: Handler,
  thrown: Collected,
  context: Context,
  caught: ReadonlyMap<number, Collected>,
  into: Collected,
): void {
  const bound = (reaching: Collected): ReadonlyMap<number, Collected> =>
    new Map([...caught, [handler.of, reaching]]);
  evaluate(handler.pre, context, bound(thrown), into);

  const remaining = new Map(
    [...thrown.classes].map(([id, info]) => [
      id,
      { certain: info.certain, via: info.via, from: info.from },
    ]),
  );
  const afterwards = withUnknowns(thrown);
  for (const branch of handler.branches) {
    const reaching = withUnknowns(thrown);
    for (const [id, info] of [...remaining]) {
      const relations = branch.classes.map((handled) => relation(handled, id, context.classes));
      const verdict = relations.includes("yes")
        ? "yes"
        : relations.includes("undecided") || branch.classes.length === 0
          ? "undecided"
          : "no";
      if (verdict === "no") continue;
      if (verdict === "yes" && branch.exact) {
        addClass(reaching, id, info.certain, info.via, info.from);
        remaining.delete(id);
      } else {
        // It may go to this branch, or on to the next: certain of neither.
        addClass(reaching, id, false, info.via, info.from);
        info.certain = false;
      }
    }
    evaluate(branch.body, context, bound(reaching), into);
    if (!branch.exits) merge(afterwards, reaching);
  }
  const rest = withUnknowns(thrown);
  for (const [id, info] of remaining) addClass(rest, id, info.certain, info.via, info.from);
  if (handler.otherwise !== null) {
    evaluate(handler.otherwise, context, bound(rest), into);
    if (!handler.otherwiseExits) merge(afterwards, rest);
  } else {
    merge(afterwards, rest);
  }
  evaluate(handler.after, context, bound(afterwards), into);
  context.onCatch?.({ file: context.file, handler, thrown, unhandled: remaining });
}

/** What the body of a function throws and rejects with, ignoring its `@throws`. */
export function inferred(
  entry: FunctionEntry,
  analysis: Pick<Analysis, "classes" | "results">,
  onCatch?: (seen: CatchSeen) => void,
): { throws: Collected; rejects: Collected } {
  const context: Context = {
    file: entry.file,
    classes: analysis.classes,
    resultOf: (id) => analysis.results.get(id),
    ...(onCatch === undefined ? {} : { onCatch }),
  };
  return inferWith(entry, context);
}

function inferWith(
  entry: FunctionEntry,
  context: Context,
): { throws: Collected; rejects: Collected } {
  const body = collected();
  const returns = collected();
  evaluate(entry.fact.body, context, new Map(), body);
  evaluate(entry.fact.returns, context, new Map(), returns);
  if (!entry.fact.async) return { throws: body, rejects: returns };
  merge(body, returns);
  return { throws: collected(), rejects: body };
}

/** What a `@throws` declares, as the function's result. */
function declared(entry: FunctionEntry): Collected {
  const made = collected();
  const doc = entry.fact.doc;
  if (doc === null) return made;
  for (const item of doc.entries) {
    if (item.id !== null) {
      addClass(made, item.id, true, null);
    } else {
      addSource(made, {
        ...locationOf(entry.file, item.at),
        text: item.name,
        reason: "`@throws` names no class stateward can find",
      });
    }
  }
  for (const at of doc.untyped) {
    addSource(made, {
      ...locationOf(entry.file, at),
      text: entry.fact.name,
      reason: "`@throws` without a type",
    });
  }
  return made;
}

/** The ids a function's effects call, each once, in order. */
const callees = new WeakMap<FunctionFact, readonly string[]>();
const bodyCallees = new WeakMap<FunctionFact, readonly string[]>();

/**
 * What the function's result is computed from; with `body`, what its body calls even when a
 * `@throws` decides its result.
 */
function calleesOf(fact: FunctionFact, body = false): readonly string[] {
  const cache = body ? bodyCallees : callees;
  const known = cache.get(fact);
  if (known !== undefined) return known;
  const found = new Set<string>();
  const visit = (effects: readonly Effect[]): void => {
    for (const effect of effects) {
      if (effect.k === "call") found.add(effect.id);
      else if (effect.k === "maybe") visit(effect.body);
      else if (effect.k === "try") {
        visit(effect.body);
        visit(effect.fin);
        const handler = effect.handler;
        if (handler !== null) {
          visit(handler.pre);
          for (const branch of handler.branches) visit(branch.body);
          visit(handler.otherwise ?? []);
          visit(handler.after);
        }
      }
    }
  };
  // A function with a `@throws` is what its tag says: it depends on nothing.
  if (fact.doc === null || body) {
    visit(fact.body);
    visit(fact.returns);
  }
  const list = [...found];
  cache.set(fact, list);
  return list;
}

/**
 * What a function's result depends on besides its callees: its facts, and every class's
 * `extends` (which `instanceof` tests a catch passes), as one text for the whole project.
 */
type Input = { readonly fact: FunctionFact; readonly classes: string };

/** One input object per facts object and classes text, so the memo compares them by identity. */
const inputs = new WeakMap<FunctionFact, Input>();

function inputOf(fact: FunctionFact, classes: string): Input {
  const known = inputs.get(fact);
  if (known?.classes === classes) return known;
  const made = { fact, classes };
  inputs.set(fact, made);
  return made;
}

const texts = new WeakMap<object, string>();

function textOf(value: object): string {
  let text = texts.get(value);
  if (text === undefined) {
    text = JSON.stringify(value);
    texts.set(value, text);
  }
  return text;
}

/**
 * The last solve, for early cut-off: in the language server, a full pass after an edit computes
 * only the functions whose facts changed, and their callers only while a result changes.
 * Keeping it here is safe: a result is reused only for equal facts and the same callee results.
 */
const memo = createPropagationMemo<Input, Result>();

/** One analysis per summaries map: the engine hands out the same map until they change. */
const analyses = new WeakMap<ReadonlyMap<string, Json>, Analysis>();

/**
 * The summaries of the last analysis, by their JSON text. Each rule of the pack (and the hover)
 * receives its own parsed copy of the same facts; mapping equal texts to one object lets the
 * second rule, and the next full pass, find the facts unchanged by identity.
 */
let canonical = new Map<string, ThrowsSummary>();
let last:
  { files: readonly string[]; summaries: readonly ThrowsSummary[]; analysis: Analysis } | undefined;

/** Solves what every function of the project throws. */
export function analyse(summaries: ReadonlyMap<string, Json>): Analysis {
  const known = analyses.get(summaries);
  if (known !== undefined) return known;
  const files: string[] = [];
  const read: ThrowsSummary[] = [];
  const next = new Map<string, ThrowsSummary>();
  for (const [file, value] of summaries) {
    const parsed = readSummary(value);
    if (parsed === undefined || typeof value !== "object" || value === null) continue;
    const text = textOf(value);
    const summary = canonical.get(text) ?? next.get(text) ?? parsed;
    next.set(text, summary);
    files.push(file);
    read.push(summary);
  }
  canonical = next;
  if (
    last?.files.length === files.length &&
    last.files.every((file, i) => file === files[i] && last?.summaries[i] === read[i])
  ) {
    analyses.set(summaries, last.analysis);
    return last.analysis;
  }

  const functions = new Map<string, FunctionEntry>();
  const named: string[] = [];
  const classes = new Map<string, ClassFact>();
  const modules: { file: string; effects: readonly Effect[] }[] = [];
  for (const [i, summary] of read.entries()) {
    const file = files[i] ?? "";
    for (const fact of summary.classes) classes.set(fact.id, fact);
    for (const fact of summary.functions) {
      if (fact.id === ANONYMOUS) {
        // Nothing calls it by name: its catches are checked, it has no result to propagate.
        functions.set(`${file}#@${String(fact.at[0])}`, { file, fact });
      } else {
        functions.set(fact.id, { file, fact });
        named.push(fact.id);
      }
    }
    if (summary.module.length > 0) modules.push({ file, effects: summary.module });
  }

  const freshKey = JSON.stringify(
    [...classes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  // The last text when equal: every function compares it, and the same string compares at once.
  const classesKey = last?.analysis.classesKey === freshKey ? last.analysis.classesKey : freshKey;
  const { results, computed } = propagate<Input, Result>({
    nodes: named,
    successors: (id) => {
      const entry = functions.get(id);
      return entry === undefined ? [] : calleesOf(entry.fact);
    },
    input: (id) => inputOf(functions.get(id)?.fact ?? emptyFact(id), classesKey),
    sameInput: (a, b) =>
      a.classes === b.classes && (a.fact === b.fact || textOf(a.fact) === textOf(b.fact)),
    compute: (id, resultOf) => resultOfEntry(functions.get(id), classes, resultOf),
    initial: NOTHING,
    same: sameResult,
    memo,
  });
  const analysis = { functions, classes, classesKey, results, modules, computed };
  analyses.set(summaries, analysis);
  last = { files, summaries: read, analysis };
  return analysis;
}

/** A function's result: what its `@throws` declares, else what its body throws and rejects with. */
function resultOfEntry(
  entry: FunctionEntry | undefined,
  classes: ReadonlyMap<string, ClassFact>,
  resultOf: (id: string) => Result | undefined,
): Result {
  if (entry === undefined) return NOTHING;
  if (entry.fact.doc !== null) {
    const set = toThrown(declared(entry));
    // On a function that returns a promise, `@throws` says what the promise rejects with.
    return entry.fact.promise ? { throws: EMPTY, rejects: set } : { throws: set, rejects: EMPTY };
  }
  const { throws, rejects } = inferWith(entry, { file: entry.file, classes, resultOf });
  return { throws: toThrown(throws), rejects: toThrown(rejects) };
}

/**
 * Solves a closed set of functions on its own, without the project's memo: a package's functions
 * read from its source. Calls outside the set are unknown.
 */
export function solveFunctions(
  functions: ReadonlyMap<string, FunctionEntry>,
  classes: ReadonlyMap<string, ClassFact>,
): ReadonlyMap<string, Result> {
  return propagate<FunctionEntry | undefined, Result>({
    nodes: [...functions.keys()],
    successors: (id) => {
      const entry = functions.get(id);
      return entry === undefined ? [] : calleesOf(entry.fact);
    },
    input: (id) => functions.get(id),
    sameInput: (a, b) => a === b,
    compute: (id, resultOf) => resultOfEntry(functions.get(id), classes, resultOf),
    initial: NOTHING,
    same: sameResult,
  }).results;
}

function emptyFact(id: string): FunctionFact {
  return {
    id,
    name: "",
    at: [0, 0],
    async: false,
    promise: false,
    doc: null,
    local: false,
    body: [],
    returns: [],
  };
}

/**
 * What a function's own evaluation gives the rules (its catches, what its body throws), kept per
 * facts object while its callees' results and the classes are the same objects: a full pass
 * after an edit evaluates only the functions whose facts or callees changed.
 */
type Evaluated = {
  readonly callees: readonly (Result | undefined)[];
  readonly classesKey: string;
  readonly catches: readonly CatchSeen[];
  readonly body: { throws: Collected; rejects: Collected };
};

const evaluations = new WeakMap<FunctionFact, Map<string, Evaluated>>();

/** The function's catches and inferred result, evaluated with the analysis's callee results. */
export function evaluated(entry: FunctionEntry, analysis: Analysis): Evaluated {
  const callees = calleesOf(entry.fact, true).map((id) => analysis.results.get(id));
  const byFile = evaluations.get(entry.fact) ?? new Map<string, Evaluated>();
  evaluations.set(entry.fact, byFile);
  const known = byFile.get(entry.file);
  if (
    known?.classesKey === analysis.classesKey &&
    known.callees.length === callees.length &&
    known.callees.every((result, i) => result === callees[i])
  ) {
    return known;
  }
  const catches: CatchSeen[] = [];
  const body = inferred(entry, analysis, (one) => {
    if (one.handler.branches.length > 0) catches.push(one);
  });
  const made = { callees, classesKey: analysis.classesKey, catches, body };
  byFile.set(entry.file, made);
  return made;
}

/** Every catch of the project, with what reaches it, for `catch-misses-error`. */
export function everyCatch(analysis: Analysis): readonly CatchSeen[] {
  const seen: CatchSeen[] = [];
  // A callback of a built-in (`items.forEach(…)`) is evaluated where it is called and on its own.
  const where = new Set<string>();
  const add = (one: CatchSeen): void => {
    const key = `${one.file}\u0000${String(one.handler.at[0])}`;
    if (where.has(key)) return;
    where.add(key);
    seen.push(one);
  };
  for (const entry of analysis.functions.values()) {
    if (hasDispatch(entry.fact.body) || hasDispatch(entry.fact.returns)) {
      for (const one of evaluated(entry, analysis).catches) add(one);
    }
  }
  for (const { file, effects } of analysis.modules) {
    if (!hasDispatch(effects)) continue;
    evaluate(
      effects,
      {
        file,
        classes: analysis.classes,
        resultOf: (id) => analysis.results.get(id),
        onCatch: (one) => {
          if (one.handler.branches.length > 0) add(one);
        },
      },
      new Map(),
      collected(),
    );
  }
  return seen;
}

function hasDispatch(effects: readonly Effect[]): boolean {
  return effects.some((effect) => {
    if (effect.k !== "try") return false;
    const handler = effect.handler;
    if (hasDispatch(effect.body) || hasDispatch(effect.fin)) return true;
    if (handler === null) return false;
    return (
      handler.branches.length > 0 ||
      hasDispatch(handler.pre) ||
      handler.branches.some((branch) => hasDispatch(branch.body)) ||
      hasDispatch(handler.otherwise ?? []) ||
      hasDispatch(handler.after)
    );
  });
}
