/**
 * Walking down a tree of places (a component rendering another, a function calling another) from
 * its roots. It knows no library: a plugin says what an edge is, which edges are covered (a
 * Provider, an error boundary above), and what each node needs.
 */

/** One place a node leads to another: `to` is the node it leads to. */
export type TreeEdge = { readonly to: string };

export type WalkDown<E extends TreeEdge> = {
  /** Where the walk starts (an app's entry points), in the order findings come out. */
  readonly roots: readonly E[];
  /** The edges out of a node, in a fixed order. */
  readonly edges: (node: string) => readonly E[];
  /** Whether what is below this edge is taken care of above it: the walk stops there. */
  readonly covered: (edge: E) => boolean;
  /** What a node needs from above, with what it reaches through uncovered edges. */
  readonly needs: (node: string) => ReadonlySet<string>;
  /** The same text for the same place: an edge reached from two roots is reported once. */
  readonly key: (edge: E) => string;
};

/** An uncovered edge, and what its target needs that nothing above it on the way gives. */
export type Uncovered<E extends TreeEdge> = { readonly edge: E; readonly needs: readonly string[] };

/**
 * The highest uncovered edges on every path from the roots: at an edge whose target needs
 * something, it is reported there and not again further down the same path (one cause, one
 * finding). Deterministic: the order of `roots` and `edges`, then each need sorted.
 */
export function highestUncovered<E extends TreeEdge>(walk: WalkDown<E>): Uncovered<E>[] {
  const found = new Map<string, { edge: E; needs: Set<string> }>();
  const seen = new Set<string>();
  const visit = (edge: E, reported: ReadonlySet<string>): void => {
    if (walk.covered(edge)) return;
    const state = JSON.stringify([edge.to, [...reported].sort()]);
    const key = walk.key(edge);
    if (seen.has(`${key}\u0000${state}`)) return;
    seen.add(`${key}\u0000${state}`);
    const missing = [...walk.needs(edge.to)].filter((need) => !reported.has(need));
    if (missing.length > 0) {
      const known = found.get(key) ?? { edge, needs: new Set<string>() };
      for (const need of missing) known.needs.add(need);
      found.set(key, known);
    }
    const below = missing.length === 0 ? reported : new Set([...reported, ...missing]);
    for (const next of walk.edges(edge.to)) visit(next, below);
  };
  for (const root of walk.roots) visit(root, new Set());
  return [...found.values()].map(({ edge, needs }) => ({ edge, needs: [...needs].sort() }));
}

/**
 * The shortest way down from `start` to a node where `goal` holds, following only the edges
 * `follow` allows: the edges taken, in order (empty when `start` is the goal), or undefined when
 * no such node is reached. Ties go to the first edge in `edges` order.
 */
export function shortestPath<E extends TreeEdge>(
  start: string,
  edges: (node: string) => readonly E[],
  follow: (edge: E) => boolean,
  goal: (node: string) => boolean,
): E[] | undefined {
  const parents = new Map<string, { from: string; edge: E }>();
  const queue = [start];
  const visited = new Set(queue);
  for (const node of queue) {
    if (goal(node)) {
      const path: E[] = [];
      for (let step = parents.get(node); step !== undefined; step = parents.get(step.from)) {
        path.unshift(step.edge);
      }
      return path;
    }
    for (const edge of edges(node)) {
      if (visited.has(edge.to) || !follow(edge)) continue;
      visited.add(edge.to);
      parents.set(edge.to, { from: node, edge });
      queue.push(edge.to);
    }
  }
  return undefined;
}
