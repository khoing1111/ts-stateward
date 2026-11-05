/**
 * Strongly connected components (Tarjan), iterative so a long chain of imports cannot overflow the
 * stack. Components come out in reverse topological order: every component a node reaches comes
 * before the node's own, so a fact can be computed from its successors' in one pass. Within a component, nodes keep the order of `nodes`. Deterministic: the
 * same nodes and successors in the same order give the same components in the same order.
 */
export function stronglyConnectedComponents<T>(
  nodes: readonly T[],
  successors: (node: T) => readonly T[],
): T[][] {
  const position = new Map<T, number>(nodes.map((node, i) => [node, i]));
  const index = new Map<T, number>();
  const low = new Map<T, number>();
  const onStack = new Set<T>();
  const stack: T[] = [];
  const components: T[][] = [];
  let counter = 0;

  type Frame = { node: T; next: readonly T[]; at: number };
  const enter = (node: T): Frame => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    return { node, next: successors(node).filter((s) => position.has(s)), at: 0 };
  };

  for (const root of nodes) {
    if (index.has(root)) continue;
    const frames: Frame[] = [enter(root)];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) break;
      const successor = frame.next[frame.at];
      if (successor !== undefined) {
        frame.at++;
        if (!index.has(successor)) {
          frames.push(enter(successor));
        } else if (onStack.has(successor)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(successor) ?? 0));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      const nodeLow = low.get(frame.node) ?? 0;
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, nodeLow));
      }
      if (nodeLow !== index.get(frame.node)) continue;
      const component: T[] = [];
      for (;;) {
        const member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
        if (member === frame.node) break;
      }
      components.push(component.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0)));
    }
  }
  return components;
}

/**
 * What `propagate` keeps of a solve for the next one, by node: its input, the results of its
 * successors it was computed from, and its result; and the graph's components, reused while the
 * nodes and their edges are the same. Create one with `createPropagationMemo` and pass it to
 * every solve of the same graph (the language server's full passes).
 */
export type PropagationMemo<I, R> = {
  entries: Map<string, { input: I; successors: readonly (R | undefined)[]; result: R }>;
  graph?: {
    nodes: readonly string[];
    edges: ReadonlyMap<string, readonly string[]>;
    components: readonly (readonly string[])[];
  };
};

export function createPropagationMemo<I, R>(): PropagationMemo<I, R> {
  return { entries: new Map() };
}

/** What `propagate` needs: the graph, each node's own input, and how a result is computed. */
export type Propagation<I, R> = {
  nodes: readonly string[];
  /** A node's successors (what its result is computed from); others than `nodes` are ignored. */
  successors: (node: string) => readonly string[];
  /** What a node's result depends on besides its successors' results. */
  input: (node: string) => I;
  /** Whether two inputs give the same result: compared by identity first, then by this. */
  sameInput: (a: I, b: I) => boolean;
  /**
   * One node's result. `resultOf` answers for its successors: final for those outside its
   * component, the current estimate inside (`initial` at first), so a cycle is solved by iterating
   * until nothing changes. A successor that is not a node gives undefined.
   */
  compute: (node: string, resultOf: (successor: string) => R | undefined) => R;
  /** The result to start a cycle from: the least one (an empty set). `compute` must only grow it. */
  initial: R;
  same: (a: R, b: R) => boolean;
  memo?: PropagationMemo<I, R>;
};

/** A cycle that has not settled after this many rounds keeps its last estimate. */
const MAX_ROUNDS = 100;

/**
 * Solves facts that flow from a node's successors to the node (what a function throws, from what
 * it calls), component by component in reverse topological order.
 *
 * Early cut-off with a `memo`: a component whose nodes have the same inputs as in the last solve,
 * and whose successors' results are the very objects that solve saw, takes its results from the
 * memo without computing. A component that is computed again but ends with a result equal to its
 * last one (`same`) keeps the last result object, so its callers in turn see nothing new: an edit
 * that changes a body but not the result stops there. `computed` counts the nodes computed.
 */
export function propagate<I, R>(
  problem: Propagation<I, R>,
): { results: ReadonlyMap<string, R>; computed: number } {
  const { nodes, successors, input, sameInput, compute, initial, same, memo } = problem;
  const before = memo?.entries ?? new Map<string, never>();
  const next: PropagationMemo<I, R>["entries"] = new Map();
  const results = new Map<string, R>();
  const known = new Set(nodes);
  let computed = 0;

  // The components of the last solve while the graph is the same: most edits change a body,
  // not what it calls, and the components are a tenth of a solve that computes nothing.
  const edges = new Map<string, readonly string[]>();
  const previous = memo?.graph;
  let sameGraph = previous?.nodes.length === nodes.length;
  for (const [i, node] of nodes.entries()) {
    const found = successors(node).filter((successor) => known.has(successor));
    edges.set(node, found);
    if (!sameGraph) continue;
    const old = previous?.edges.get(node);
    sameGraph =
      previous?.nodes[i] === node &&
      old?.length === found.length &&
      old.every((successor, j) => successor === found[j]);
  }
  const outgoing = (node: string): readonly string[] => edges.get(node) ?? [];
  const components =
    sameGraph && previous !== undefined
      ? previous.components
      : stronglyConnectedComponents(nodes, outgoing);

  for (const component of components) {
    const single = component.length === 1;
    const members = single ? undefined : new Set(component);
    const inside = (node: string): boolean =>
      members === undefined ? component[0] === node : members.has(node);
    const reused = component.every((node) => {
      const entry = before.get(node);
      if (entry === undefined) return false;
      const own = input(node);
      if (entry.input !== own) {
        if (!sameInput(entry.input, own)) return false;
        // Equal: keep the new one, so the next solve compares by identity.
        entry.input = own;
      }
      const out = outgoing(node);
      if (out.length !== entry.successors.length) return false;
      for (const [i, successor] of out.entries()) {
        const seen = entry.successors[i];
        const now = inside(successor) ? before.get(successor)?.result : results.get(successor);
        if (now !== seen) return false;
      }
      return true;
    });
    if (reused) {
      for (const node of component) {
        const entry = before.get(node);
        if (entry === undefined) continue;
        results.set(node, entry.result);
        next.set(node, entry);
      }
      continue;
    }

    const current = new Map<string, R>();
    for (const node of component) current.set(node, initial);
    const resultOf = (successor: string): R | undefined =>
      inside(successor) ? current.get(successor) : results.get(successor);
    const cyclic = !single || outgoing(component[0] ?? "").includes(component[0] ?? "");
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let changed = false;
      for (const node of component) {
        computed++;
        const result = compute(node, resultOf);
        const was = current.get(node);
        if (was === undefined || !same(was, result)) {
          current.set(node, result);
          changed = true;
        }
      }
      if (!changed || !cyclic) break;
    }
    for (const node of component) {
      const last = before.get(node)?.result;
      const result = current.get(node);
      if (result === undefined) continue;
      results.set(node, last !== undefined && same(last, result) ? last : result);
    }
    for (const node of component) {
      const result = results.get(node);
      if (result === undefined) continue;
      next.set(node, {
        input: input(node),
        successors: outgoing(node).map((successor) => results.get(successor)),
        result,
      });
    }
  }
  if (memo !== undefined) {
    memo.entries = next;
    memo.graph = { nodes, edges, components };
  }
  return { results, computed };
}
