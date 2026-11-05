import { createPropagationMemo, propagate } from "@stateward/core";
import type { Location } from "@stateward/core";
import type { Dependency, FileSummary, FunctionFact } from "./summary.js";
import type { CallSite, Closure, Fresh, Site } from "./value.js";
import { MAX_PATH } from "./value.js";

/** The function a value is created in, for messages: `useCart` in `src/cart.ts`. */
export type Owner = { name: string; file: string; relative: string };

/**
 * Where a value a plain (non-hook) function returns is to be memoized: at the call to it, in the
 * hook that calls it (`hook`), or in the component that has the dependency (`here`). A hook
 * cannot be called inside the plain function itself.
 */
export type Wrap = { call: CallSite; in: { kind: "here" } | { kind: "hook"; owner: Owner } };

/** What one position of a function's result is, once calls to other functions are followed. */
export type Resolved =
  | {
      kind: "fresh";
      what: Fresh;
      label: string | null;
      at: Site;
      owner: Owner;
      /** Where the value sits in its owner's result: `["onSave"]`. */
      path: readonly string[];
      /** The owner is a hook: the value can be memoized where it is created. */
      ownerHook: boolean;
      /** Where to memoize it otherwise; null until a hook or a component calls the owner. */
      wrap: Wrap | null;
      /** A function: what it captures from its owner. */
      closure: Closure | null;
      /** A data value built only from the owner's state: these names. */
      derived: readonly string[];
    }
  | { kind: "unknown"; text: string; at: Site; owner: Owner };

/** A function's result, position by position (`JSON.stringify(path)`), sorted by position. */
export type Result = readonly (readonly [string, Resolved])[];

const NOTHING: Result = [];

type Node = { file: string; compiled: boolean; fact: FunctionFact };

function ownerOf(node: Node): Owner {
  const hash = node.fact.id.indexOf("#");
  return {
    name: node.fact.name,
    file: node.file,
    relative: hash < 0 ? node.file : node.fact.id.slice(0, hash),
  };
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key);
}

function compute(node: Node | undefined, resultOf: (id: string) => Result | undefined): Result {
  if (node === undefined || node.compiled) return NOTHING;
  const out = new Map<string, Resolved>();
  const put = (path: readonly string[], value: Resolved): void => {
    if (path.length > MAX_PATH) return;
    const key = JSON.stringify(path);
    const was = out.get(key);
    if (was === undefined || (was.kind === "unknown" && value.kind === "fresh"))
      out.set(key, value);
  };
  const owner = ownerOf(node);
  for (const { path, origin } of node.fact.returns) {
    switch (origin.kind) {
      case "fresh":
        put(path, {
          kind: "fresh",
          what: origin.what,
          label: origin.label,
          at: origin.at,
          owner,
          path,
          ownerHook: node.fact.hook,
          wrap: null,
          closure: origin.closure,
          derived: origin.derived,
        });
        break;
      case "unknown":
        put(path, { kind: "unknown", text: origin.text, at: origin.at, owner });
        break;
      case "from":
        for (const [key, value] of resultOf(origin.fn) ?? NOTHING) {
          const inner = parsePath(key);
          if (!startsWith(inner, origin.path)) continue;
          const rest = inner.slice(origin.path.length);
          const first = rest[0];
          if (first !== undefined && origin.except.includes(first)) continue;
          put([...path, ...rest], wrapped(value, node, origin.call, owner));
        }
        break;
      default: {
        const unreachable: never = origin;
        return unreachable;
      }
    }
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** A plain function's value as a hook that calls it sees it: memoized at that call. */
function wrapped(value: Resolved, node: Node, call: CallSite, owner: Owner): Resolved {
  if (value.kind !== "fresh" || value.ownerHook || value.wrap !== null || !node.fact.hook)
    return value;
  return { ...value, wrap: { call, in: { kind: "hook", owner } } };
}

function parsePath(key: string): string[] {
  const parsed: unknown = JSON.parse(key);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function sameResult(a: Result, b: Result): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function sameNode(a: Node | undefined, b: Node | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.file === b.file &&
    a.compiled === b.compiled &&
    JSON.stringify(a.fact) === JSON.stringify(b.fact)
  );
}

/** The last solve, so a full pass after an edit recomputes only what changed (as the Errors pack does). */
const memo = createPropagationMemo<Node | undefined, Result>();

export type Analysis = {
  summaries: ReadonlyMap<string, FileSummary>;
  results: ReadonlyMap<string, Result>;
};

const analyses = new WeakMap<ReadonlyMap<string, FileSummary>, Analysis>();

/** What every function of the project returns, followed across files and through cycles. */
export function analyse(raw: ReadonlyMap<string, FileSummary>): Analysis {
  const known = analyses.get(raw);
  if (known !== undefined) return known;
  // By file name: the same findings in the same order whatever order the files were read in.
  const summaries = new Map([...raw].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const nodes = new Map<string, Node>();
  for (const [file, summary] of summaries) {
    for (const fact of summary.functions)
      nodes.set(fact.id, { file, compiled: summary.compiled, fact });
  }
  const { results } = propagate<Node | undefined, Result>({
    nodes: [...nodes.keys()],
    successors: (id) =>
      (nodes.get(id)?.fact.returns ?? []).flatMap(({ origin }) =>
        origin.kind === "from" ? [origin.fn] : [],
      ),
    input: (id) => nodes.get(id),
    sameInput: sameNode,
    compute: (id, resultOf) => compute(nodes.get(id), resultOf),
    initial: NOTHING,
    same: sameResult,
    memo,
  });
  const analysis = { summaries, results };
  analyses.set(raw, analysis);
  return analysis;
}

/** A dependency, with what its value turned out to be. */
export type Use = { file: string; dependency: Dependency; value: Resolved };

/**
 * The dependencies whose value a project function creates anew each render, or comes from a hook
 * of the project stateward cannot read; in the engine's file order, then in file order. A
 * dependency in a file the React Compiler builds is left out: the compiler memoizes it.
 */
export function usesOf(analysis: Analysis): Use[] {
  const uses: Use[] = [];
  for (const [file, summary] of analysis.summaries) {
    if (summary.compiled) continue;
    for (const dependency of summary.dependencies) {
      const value = valueOf(analysis, file, dependency);
      if (value !== undefined) uses.push({ file, dependency, value });
    }
  }
  return uses;
}

function valueOf(analysis: Analysis, file: string, dependency: Dependency): Resolved | undefined {
  const { via } = dependency;
  if (via.kind === "unknown") return undefined;
  const result = new Map(analysis.results.get(via.fn) ?? NOTHING);
  const exact = result.get(JSON.stringify(via.path));
  if (exact?.kind === "fresh" && !exact.ownerHook && exact.wrap === null) {
    // A plain function called right here: the call is what the component memoizes.
    return { ...exact, wrap: { call: via.call, in: { kind: "here" } } };
  }
  if (exact !== undefined) return exact;
  // A position inside a value stateward cannot read is unknown as well.
  for (let length = via.path.length - 1; length >= 0; length--) {
    const outer = result.get(JSON.stringify(via.path.slice(0, length)));
    if (outer?.kind === "unknown") return outer;
    if (outer !== undefined) return undefined;
  }
  return undefined;
}

export const locationOf = (file: string, at: { start: number; end: number }): Location => ({
  file,
  start: at.start,
  end: at.end,
});
