import { propagate } from "@stateward/core";
import type { FileContext, Json, Location, StringListRecord } from "@stateward/core";
import { summarizeOnce } from "../inference/project.js";
import { analyse, evaluated } from "../inference/solve.js";
import type { Analysis, Collected, Source } from "../inference/solve.js";
import { className, unknownText } from "../inference/format.js";
import { fieldsOf } from "../inference/summary.js";
import type { Effect, ThrowsSummary } from "../inference/summary.js";
import { ALL_GUARDS, type GuardSkips } from "./render-guards.js";
import { LIBRARY_BOUNDARIES, readTree, summarizeTree } from "./tree.js";
import type { BoundaryElement, TreeFunction, TreeRender, TreeSummary } from "./tree.js";

/**
 * Errors in React: what each component throws while React
 * renders it or runs its effects, which error boundary is nearest above each render, and what
 * each boundary can catch. Handlers, timers and async code are left out: a boundary never sees
 * their errors.
 */

/** The summary of the pack's React rules: the throws facts and the render tree of one file. */
export type ReactSummary = { readonly throws: ThrowsSummary; readonly tree: TreeSummary };

/** The rules whose summaries hold a render tree; the first that ran is read. */
export const TREE_RULES = [
  "errors/render-throw-without-boundary",
  "errors/catch-misses-error",
] as const;

/**
 * The last file's trees by program, then by the boundaries the rule's config adds (as JSON): the
 * pack's two React rules summarize the same file one after the other. Only the last file is
 * kept, as in `summarizeOnce`.
 */
const last = new WeakMap<
  FileContext["types"],
  { sourceFile: object; trees: Map<string, TreeSummary> }
>();

export function summarizeReact(
  ctx: FileContext,
  libraryBoundaries: StringListRecord = LIBRARY_BOUNDARIES,
  skips: GuardSkips = ALL_GUARDS,
): ReactSummary {
  let known = last.get(ctx.types);
  if (known?.sourceFile !== ctx.sourceFile) {
    known = { sourceFile: ctx.sourceFile, trees: new Map() };
    last.set(ctx.types, known);
  }
  const key = JSON.stringify([libraryBoundaries, skips.contextGuards, skips.inputGuards]);
  let tree = known.trees.get(key);
  if (tree === undefined) {
    tree = summarizeTree(ctx, libraryBoundaries, skips);
    known.trees.set(key, tree);
  }
  return { throws: summarizeOnce(ctx), tree };
}

/** What `nearest` answers for a render stateward cannot follow to where it is placed. */
const UNFOLLOWED = "?";

/** A render with the file it is written in. */
export type Site = { readonly to: string; readonly file: string; readonly render: TreeRender };

/** One class a component throws: whether surely, and the call that brings it. */
export type Brought = {
  readonly certain: boolean;
  /** `useUser` for `(via <UserPage> → useUser)`; null when the component throws it itself. */
  readonly step: string | null;
  readonly location: Location;
  /** `` `useUser(…)` can throw `NotFoundError` `` once the class's name is known. */
  readonly what: string;
};

export type Own = {
  readonly classes: ReadonlyMap<string, Brought>;
  /**
   * The classes it throws only from guards (render-guards.ts): a missing context or input, a
   * mistake of the caller. A boundary still catches them; they do not make a render failure.
   */
  readonly guarded: ReadonlySet<string>;
  readonly unknowns: readonly Source[];
  readonly more: boolean;
};

export type Model = {
  readonly analysis: Analysis;
  readonly functions: ReadonlyMap<string, { file: string; fn: TreeFunction }>;
  readonly boundaries: ReadonlyMap<string, { file: string; element: BoundaryElement }>;
  /** Boundaries by file, for the hover. */
  readonly byFile: ReadonlyMap<string, readonly BoundaryElement[]>;
  readonly entries: readonly Site[];
  /** Every render (entries first), by file and offset. */
  readonly sites: readonly Site[];
  /** The renders written in a component, in order. */
  edges(id: string): readonly Site[];
  /** The boundary nearest above a render, by key; undefined when there is none in its component. */
  nearest(site: Site): string | undefined;
  own(id: string): Own;
  /** The classes a component surely throws, with what it renders outside any boundary. */
  needs(id: string): ReadonlySet<string>;
  /** What a boundary catches: from the renders whose nearest boundary it is, down to nested ones. */
  catches(key: string): Omit<Own, "guarded"> & { readonly labels: ReadonlyMap<string, string> };
};

const models = new WeakMap<ReadonlyMap<string, Json>, Model>();
const throwsMaps = new WeakMap<ReadonlyMap<string, Json>, ReadonlyMap<string, Json>>();

/** The throws part of each summary: the same facts `catch-misses-error` solves. */
export function throwsOf(summaries: ReadonlyMap<string, Json>): ReadonlyMap<string, Json> {
  let known = throwsMaps.get(summaries);
  if (known === undefined) {
    const made = new Map<string, Json>();
    for (const [file, value] of summaries) {
      const throws = fieldsOf(value)?.throws;
      if (throws !== undefined) made.set(file, throws);
    }
    known = made;
    throwsMaps.set(summaries, known);
  }
  return known;
}

function compareSites(a: Site, b: Site): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.render.at[0] - b.render.at[0];
}

function stepOf(text: string): string {
  return text.endsWith("(…)") ? text.slice(0, -"(…)".length) : text;
}

/** The pack's view of the app's render tree, built once per summaries map. */
export function modelOf(summaries: ReadonlyMap<string, Json>): Model {
  const known = models.get(summaries);
  if (known !== undefined) return known;
  const analysis = analyse(throwsOf(summaries));
  const functions = new Map<string, { file: string; fn: TreeFunction }>();
  const boundaries = new Map<string, { file: string; element: BoundaryElement }>();
  const byFile = new Map<string, readonly BoundaryElement[]>();
  const entries: Site[] = [];
  const sites: Site[] = [];
  for (const file of [...summaries.keys()].sort()) {
    const value = summaries.get(file);
    const tree = value === undefined ? undefined : readTree(fieldsOf(value)?.tree);
    if (tree === undefined) continue;
    for (const fn of tree.functions) functions.set(fn.id, { file, fn });
    for (const element of tree.boundaries) boundaries.set(element.key, { file, element });
    byFile.set(file, tree.boundaries);
    for (const render of tree.entries) entries.push({ to: render.target, file, render });
  }
  for (const { file, fn } of functions.values()) {
    for (const render of fn.renders) sites.push({ to: render.target, file, render });
  }
  sites.sort(compareSites);
  const edgesOf = new Map<string, Site[]>();
  for (const { file, fn } of functions.values()) {
    edgesOf.set(
      fn.id,
      fn.renders
        .filter((render) => functions.has(render.target))
        .map((render) => ({ to: render.target, file, render })),
    );
  }
  const edges = (id: string): readonly Site[] => edgesOf.get(id) ?? [];

  const nearest = (site: Site): string | undefined => {
    // Not a key of any boundary: nothing is reported for it, and no boundary counts it.
    if (site.render.unknown) return UNFOLLOWED;
    for (const one of site.render.around) {
      if ("boundary" in one) return one.boundary;
      const inner = functions.get(one.via)?.fn.children?.[0];
      if (inner !== undefined) return inner;
    }
    return undefined;
  };

  const effectsOf = (id: string): { file: string; start: number }[] => {
    const found: { file: string; start: number }[] = [];
    const seen = new Set<string>();
    const visit = (one: string): void => {
      if (seen.has(one)) return;
      seen.add(one);
      const entry = functions.get(one);
      if (entry === undefined) return;
      for (const start of entry.fn.effects) found.push({ file: entry.file, start });
      for (const hook of entry.fn.hooks) visit(hook);
    };
    visit(id);
    return found;
  };

  /**
   * Whether every way function `fnId` throws `cls` is a guard: a `throw` its tree summary lists
   * as one, or a call of a function that throws it only from guards. A `@throws` tag, a package
   * or a built-in that throws it is not.
   */
  const guardOnly = (fnId: string, cls: string, seen: Set<string>): boolean => {
    const fact = analysis.functions.get(fnId)?.fact;
    if (fact === undefined || seen.has(fnId)) return false;
    seen.add(fnId);
    if (fact.doc?.entries.some((entry) => entry.id === cls) === true) return false;
    const guards = functions.get(fnId)?.fn.guards ?? [];
    let found = false;
    const walk = (effects: readonly Effect[]): boolean => {
      for (const effect of effects) {
        switch (effect.k) {
          case "class":
            if (effect.id !== cls) break;
            if (effect.text !== null || !guards.includes(effect.at[0])) return false;
            found = true;
            break;
          case "call":
            if (analysis.results.get(effect.id)?.throws.classes.has(cls) !== true) break;
            if (!guardOnly(effect.id, cls, seen)) return false;
            found = true;
            break;
          case "package":
            if (effect.facts[effect.part].classes.includes(cls)) return false;
            break;
          case "maybe":
            if (!walk(effect.body)) return false;
            break;
          case "try": {
            const handler = effect.handler;
            const parts = [
              effect.body,
              effect.fin,
              ...(handler === null
                ? []
                : [
                    handler.pre,
                    ...handler.branches.map((branch) => branch.body),
                    handler.otherwise ?? [],
                    handler.after,
                  ]),
            ];
            if (!parts.every(walk)) return false;
            break;
          }
          case "unknown":
          case "rethrow":
            break;
          default: {
            const unreachable: never = effect;
            return unreachable;
          }
        }
      }
      return true;
    };
    return walk(fact.body) && found;
  };

  const owns = new Map<string, Own>();
  const own = (id: string): Own => {
    const cached = owns.get(id);
    if (cached !== undefined) return cached;
    const entry = functions.get(id);
    const classes = new Map<string, Brought>();
    const unknowns = new Map<string, Source>();
    let more = false;
    const guarded = new Set<string>();
    const add = (key: string, inEffect: boolean, file: string, name: string): void => {
      const fact = analysis.functions.get(key);
      if (fact === undefined) return;
      const thrown: Collected = evaluated(fact, analysis).body.throws;
      // A class an effect throws is a render failure, whatever the body's guards throw.
      if (inEffect) for (const cls of thrown.classes.keys()) guarded.delete(cls);
      for (const [cls, info] of thrown.classes) {
        if (classes.get(cls)?.certain === true) continue;
        const location =
          info.via === null
            ? { file, start: fact.fact.at[0], end: fact.fact.at[1] }
            : { file: info.via.file, start: info.via.start, end: info.via.end };
        const step = info.via === null ? (inEffect ? "an effect" : null) : stepOf(info.via.text);
        classes.set(cls, {
          certain: info.certain,
          step,
          location,
          what:
            info.via === null
              ? inEffect
                ? "this effect throws"
                : `\`${name}\` throws`
              : `\`${info.via.text}\` can throw`,
        });
      }
      for (const [k, source] of thrown.unknowns) unknowns.set(k, source);
      more ||= thrown.more;
    };
    if (entry !== undefined) {
      const ids = entry.fn.kind === "class" ? entry.fn.methods : [entry.fn.id];
      for (const one of ids) add(one, false, entry.file, entry.fn.name);
      if (entry.fn.kind !== "class") {
        for (const cls of classes.keys()) if (guardOnly(id, cls, new Set())) guarded.add(cls);
      }
      for (const effect of effectsOf(id)) {
        add(`${effect.file}#@${String(effect.start)}`, true, effect.file, entry.fn.name);
      }
    }
    const made = {
      classes,
      guarded,
      unknowns: [...unknowns.values()].sort((a, b) =>
        a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.start - b.start,
      ),
      more,
    };
    owns.set(id, made);
    return made;
  };

  const ids = [...functions.keys()].sort();
  const { results } = propagate<string, ReadonlySet<string>>({
    nodes: ids,
    successors: (id) =>
      edges(id)
        .filter((site) => nearest(site) === undefined)
        .map((site) => site.to),
    input: (id) => id,
    sameInput: (a, b) => a === b,
    compute: (id, resultOf) => {
      const found = new Set<string>();
      const mine = own(id);
      for (const [cls, brought] of mine.classes) {
        if (brought.certain && !mine.guarded.has(cls)) found.add(cls);
      }
      for (const site of edges(id)) {
        if (nearest(site) !== undefined) continue;
        for (const cls of resultOf(site.to) ?? []) found.add(cls);
      }
      return found;
    },
    initial: new Set<string>(),
    same: (a, b) => a.size === b.size && [...a].every((cls) => b.has(cls)),
  });
  const needs = (id: string): ReadonlySet<string> => results.get(id) ?? new Set<string>();

  const caught = new Map<string, ReturnType<Model["catches"]>>();
  const catches = (key: string): ReturnType<Model["catches"]> => {
    const cached = caught.get(key);
    if (cached !== undefined) return cached;
    const classes = new Map<string, Brought>();
    const labels = new Map<string, string>();
    const unknowns = new Map<string, Source>();
    let more = false;
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const entry = functions.get(id);
      if (entry === undefined) return;
      const mine = own(id);
      for (const [cls, brought] of mine.classes) {
        const before = classes.get(cls);
        if (before !== undefined && (before.certain || !brought.certain)) continue;
        classes.set(cls, brought);
        const name = `<${entry.fn.name}>`;
        labels.set(cls, brought.step === null ? name : `${name} → ${brought.step}`);
      }
      for (const source of mine.unknowns) {
        unknowns.set(`${source.file}:${String(source.start)}:${source.reason}`, source);
      }
      more ||= mine.more;
      for (const site of edges(id)) if (nearest(site) === undefined) visit(site.to);
    };
    for (const site of [...entries, ...sites]) {
      if (nearest(site) === key) visit(site.to);
    }
    const made = { classes, labels, unknowns: [...unknowns.values()], more };
    caught.set(key, made);
    return made;
  };

  const model: Model = {
    analysis,
    functions,
    boundaries,
    byFile,
    entries,
    sites: [...entries, ...sites],
    edges,
    nearest,
    own,
    needs,
    catches,
  };
  models.set(summaries, model);
  return model;
}

/** The line every boundary hover ends with: what no boundary ever catches. */
export const NOT_CAUGHT = "not caught here: errors in event handlers and async code";

/**
 * On a boundary's tag: `catches: NotFoundError (via <UserPage> → useUser) | others stateward
 * cannot see (from …)`, then `NOT_CAUGHT`. Undefined when `offset` is on no boundary's tag.
 */
export function boundaryLines(model: Model, file: string, offset: number): string[] | undefined {
  const element = model.byFile.get(file)?.find((one) => offset >= one.at[0] && offset < one.at[1]);
  if (element === undefined) return undefined;
  const caught = model.catches(element.key);
  const names = [...caught.classes.keys()]
    .map((id) => {
      const label = caught.labels.get(id);
      const name = className(id, model.analysis.classes);
      return label === undefined ? name : `${name} (via ${label})`;
    })
    .sort();
  const parts =
    caught.unknowns.length > 0 || caught.more
      ? [...names, unknownText(caught.unknowns, caught.more)]
      : names;
  return [
    parts.length === 0 ? "catches nothing stateward can see" : `catches: ${parts.join(" | ")}`,
    NOT_CAUGHT,
  ];
}
