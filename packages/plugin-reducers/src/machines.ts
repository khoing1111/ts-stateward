import type { Edge, FileSummary, Place, Reducer, Reference, Use } from "./summary.js";

/** Where a reducer starts: the states, and the place that says so. */
export type Start = { file: string; at: Place; tags: string[]; label: string };

/** How a state is reached: from `from`, by this edge of the reducer. */
export type Hop = { from: string; edge: Edge; to: string };

export type Machine = {
  /** The file that declares the reducer. */
  file: string;
  reducer: Reducer;
  /** Declares where it starts: `useReducer` or `@initial`. */
  active: boolean;
  starts: Start[];
  /** Some start is unknown, so any state may be the first. */
  startsAny: boolean;
  /** Uses of `useReducer` whose start cannot be read. */
  unreadStarts: { file: string; use: Use }[];
  /** `@initial` names that are not states. */
  badInitial: string[];
  references: readonly { file: string; reference: Reference }[];
  /** Each state the starts reach, with the hop that first reached it (null for a start). */
  reached: Map<string, Hop | null>;
  /** The hops out of each state to another state, in order. */
  out: Map<string, Hop[]>;
};

const byId = <T>(map: Map<string, T[]>, id: string): T[] => {
  let list = map.get(id);
  if (list === undefined) {
    list = [];
    map.set(id, list);
  }
  return list;
};

/** The reducers of the project joined with their uses and references, in file and place order. */
export function machinesOf(summaries: ReadonlyMap<string, FileSummary>): Machine[] {
  const files = [...summaries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const uses = new Map<string, { file: string; use: Use }[]>();
  const references = new Map<string, { file: string; reference: Reference }[]>();
  for (const [file, summary] of files) {
    for (const use of summary.uses) byId(uses, use.reducer).push({ file, use });
    for (const reference of summary.references)
      byId(references, reference.id).push({ file, reference });
  }
  const machines: Machine[] = [];
  const seen = new Set<string>();
  for (const [file, summary] of files) {
    for (const reducer of summary.reducers) {
      if (seen.has(reducer.id)) continue;
      seen.add(reducer.id);
      machines.push(
        build(file, reducer, uses.get(reducer.id) ?? [], references.get(reducer.id) ?? []),
      );
    }
  }
  return machines;
}

function build(
  file: string,
  reducer: Reducer,
  uses: readonly { file: string; use: Use }[],
  references: readonly { file: string; reference: Reference }[],
): Machine {
  const starts: Start[] = [];
  const unreadStarts: Machine["unreadStarts"] = [];
  const badInitial: string[] = [];
  const known = new Set(reducer.tags);
  if (reducer.initial !== null) {
    const names = reducer.initial.names.filter((name) => known.has(name));
    badInitial.push(...reducer.initial.names.filter((name) => !known.has(name)));
    if (names.length > 0) {
      starts.push({ file, at: reducer.initial.at, tags: names, label: "starts" });
    }
  }
  for (const { file: useFile, use } of uses) {
    if (use.starts === null) unreadStarts.push({ file: useFile, use });
    else starts.push({ file: useFile, at: use.at, tags: use.starts, label: "starts" });
  }
  const active = reducer.initial !== null || uses.length > 0;
  const startsAny =
    unreadStarts.length > 0 ||
    (reducer.initial === null && (references.length > 0 || reducer.external)) ||
    (active && starts.length === 0);
  const out = new Map<string, Hop[]>();
  for (const edge of reducer.edges) {
    for (const from of edge.from) {
      for (const to of edge.to) {
        if (from !== to) byId(out, from).push({ from, edge, to });
      }
    }
  }
  const reached = new Map<string, Hop | null>();
  if (startsAny) reducer.tags.forEach((tag) => reached.set(tag, null));
  else {
    const queue = [...new Set(starts.flatMap((start) => start.tags))].sort();
    queue.forEach((tag) => reached.set(tag, null));
    // Breadth first: the queue grows while it is walked.
    for (const tag of queue) {
      const hops = [...(out.get(tag) ?? [])].sort((a, b) =>
        a.to < b.to ? -1 : a.to > b.to ? 1 : a.edge.start - b.edge.start,
      );
      for (const hop of hops) {
        if (reached.has(hop.to)) continue;
        reached.set(hop.to, hop);
        queue.push(hop.to);
      }
    }
  }
  return {
    file,
    reducer,
    active,
    starts,
    startsAny,
    unreadStarts,
    badInitial,
    references,
    reached,
    out,
  };
}

/** The hops from a start to `tag`, first hop first. */
export function pathTo(machine: Machine, tag: string): Hop[] {
  const hops: Hop[] = [];
  let hop = machine.reached.get(tag) ?? null;
  while (hop !== null) {
    hops.unshift(hop);
    hop = machine.reached.get(hop.from) ?? null;
  }
  return hops;
}

export const quoted = (tag: string): string => JSON.stringify(tag);
