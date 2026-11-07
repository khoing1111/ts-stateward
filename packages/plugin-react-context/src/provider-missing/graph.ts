import {
  ANY_CONTEXT,
  type ComponentSummary,
  type ContextDeclaration,
  type HookSummary,
  type Loc,
  type Placement,
  type RouteSummary,
  type SlotPosition,
  type SlotRef,
  type Summary,
} from "./summary.js";

export type ContextSet = ReadonlySet<string>;

/** A place a slot renders, with the name of the component (or route) that renders it. */
export type Position = SlotPosition & { owner: string };

/** A context that needs a Provider; `stated` when its type says so (`RequiredContext`). */
export type ContextInfo = ContextDeclaration;

/** Every summary of the project, indexed by id. Built once per check. */
export type Graph = {
  contexts: ReadonlyMap<string, ContextInfo>;
  /** Contexts in declaration order (file, then position). */
  contextList: readonly ContextInfo[];
  /** Components that are not wrappers of another own component. */
  components: ReadonlyMap<string, ComponentSummary>;
  componentList: readonly ComponentSummary[];
  hooks: ReadonlyMap<string, HookSummary>;
  entries: Summary["entries"];
  entryCalls: readonly Loc[];
  unknowns: Summary["unknowns"];
  /** Follows `memo(Inner)` to `Inner`; undefined when the id is no component. */
  resolve(id: string): ComponentSummary | undefined;
  positions(slot: SlotRef): readonly Position[];
};

/** The route's `outlet` slot: its own `<Outlet/>`s, and those of the components of its element. */
function routePositions(
  route: RouteSummary,
  positionsOf: (slot: SlotRef) => readonly Position[],
  resolve: (id: string) => ComponentSummary | undefined,
): Position[] {
  const inElement = route.outlets.map((position) => ({ ...position, owner: "Route" }));
  const inComponents = route.carriers.flatMap((carrier) => {
    const target = resolve(carrier.id);
    if (target === undefined) return [];
    return positionsOf({ owner: target.id, name: "outlet" }).map((position) => ({
      under: [...position.under, ...carrier.under],
      via: [...position.via, ...carrier.via],
      loc: position.loc,
      owner: position.owner,
    }));
  });
  return [...inElement, ...inComponents];
}

function compareLoc(a: Loc, b: Loc): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start;
}

export function buildGraph(summaries: ReadonlyMap<string, Summary>): Graph {
  const all = [...summaries.values()];
  // A plain `createContext(undefined)` is required once some reader checks its value.
  const read = new Set(
    all.flatMap((summary) =>
      [...summary.components, ...summary.hooks].flatMap((reader) =>
        reader.reads.map((one) => one.context),
      ),
    ),
  );
  // A stated context is listed by every file that reads it: one entry each, stated if any says so.
  const byId = new Map<string, ContextInfo>();
  for (const context of all.flatMap((summary) => summary.contexts)) {
    if (!read.has(context.id)) continue;
    const known = byId.get(context.id);
    if (known === undefined || (context.stated && !known.stated)) byId.set(context.id, context);
  }
  const contextList = [...byId.values()].sort((a, b) => compareLoc(a.loc, b.loc));
  const everyComponent = new Map(
    all.flatMap((summary) => summary.components).map((component) => [component.id, component]),
  );
  const resolve = (id: string): ComponentSummary | undefined => {
    const seen = new Set<string>();
    let current = everyComponent.get(id);
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const next = current.wraps === null ? undefined : everyComponent.get(current.wraps);
      if (next === undefined) break;
      current = next;
    }
    return current;
  };
  const componentList = [...everyComponent.values()]
    .filter((component) => resolve(component.id) === component)
    .sort((a, b) => compareLoc(a.loc, b.loc));
  const routes = new Map(
    all.flatMap((summary) => summary.routes).map((route) => [route.id, route] as const),
  );
  const slots = new Map<string, readonly SlotPosition[]>(
    componentList.flatMap((component) =>
      component.slots.map((slot) => [`${component.id}\u0000${slot.name}`, slot.positions] as const),
    ),
  );
  return {
    contexts: new Map(contextList.map((context) => [context.id, context])),
    contextList,
    components: new Map(componentList.map((component) => [component.id, component])),
    componentList,
    hooks: new Map(all.flatMap((summary) => summary.hooks).map((hook) => [hook.id, hook])),
    entries: all.flatMap((summary) => summary.entries),
    entryCalls: all.flatMap((summary) => summary.entryCalls),
    unknowns: all.flatMap((summary) => summary.unknowns),
    resolve,
    positions,
  };

  function positions(slot: SlotRef): readonly Position[] {
    const route = routes.get(slot.owner);
    if (route !== undefined) return routePositions(route, positions, resolve);
    const owner = resolve(slot.owner);
    const found = owner && slots.get(`${owner.id}\u0000${slot.name}`);
    return (found ?? []).map((position) => ({ ...position, owner: owner?.name ?? "" }));
  }
}

export function union(a: ContextSet, b: Iterable<string>): Set<string> {
  return new Set([...a, ...b]);
}

/** Whether `set` provides `context`: it holds it, or holds every context (`ANY_CONTEXT`). */
export function provides(set: ContextSet, context: string): boolean {
  return set.has(context) || set.has(ANY_CONTEXT);
}

export function minus(a: ContextSet, ...others: ContextSet[]): string[] {
  return [...a].filter((id) => !others.some((other) => provides(other, id)));
}

const MAX_SLOT_DEPTH = 8;

/**
 * The Providers that can be above something at a placement: one set for each way it is rendered.
 * Something given to a slot is rendered at each position of that slot, so it has one set per
 * position; a slot nobody renders gives no set at all, and nothing is rendered.
 */
export function placementSets(graph: Graph, placement: Placement, depth = 0): ContextSet[] {
  if (depth > MAX_SLOT_DEPTH) return [];
  let sets: ContextSet[] = [new Set(placement.under)];
  for (const slot of placement.via) {
    const next: ContextSet[] = [];
    for (const position of graph.positions(slot)) {
      for (const inner of placementSets(graph, position, depth + 1)) {
        for (const set of sets) next.push(union(set, inner));
      }
    }
    sets = next;
  }
  return sets;
}

/** What each component and hook needs: its reads, its hooks' reads, and what it renders unprovided. */
export function computeNeeds(graph: Graph): Map<string, Set<string>> {
  const needs = new Map<string, Set<string>>();
  for (const component of graph.componentList) {
    const direct = [
      ...component.reads.map((read) => read.context),
      ...component.hooks.flatMap((call) => [...hookReadsOf(graph, call.id)]),
    ];
    needs.set(component.id, new Set(direct.filter((id) => graph.contexts.has(id))));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const component of graph.componentList) {
      const mine = needs.get(component.id);
      if (mine === undefined) continue;
      for (const render of component.renders) {
        if (render.kind !== "component") continue;
        const target = graph.resolve(render.id);
        const theirs = target && needs.get(target.id);
        if (theirs === undefined) continue;
        for (const set of placementSets(graph, render)) {
          for (const id of minus(theirs, set, mine)) {
            mine.add(id);
            changed = true;
          }
        }
      }
    }
  }
  return needs;
}

export function hookReadsOf(graph: Graph, id: string): ContextSet {
  const result = new Set<string>();
  const seen = new Set<string>();
  const visit = (hookId: string): void => {
    const hook = graph.hooks.get(hookId);
    if (hook === undefined || seen.has(hookId)) return;
    seen.add(hookId);
    for (const read of hook.reads) result.add(read.context);
    for (const call of hook.hooks) visit(call.id);
  };
  visit(id);
  return result;
}
