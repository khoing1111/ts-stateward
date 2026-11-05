import { minus, placementSets, union, type ContextSet, type Graph } from "./graph.js";
import type { Loc, Origin, SlotRef } from "./summary.js";

/** A place a component is rendered, with the Providers that can be above it there. */
export type Site = {
  /** The tag as written, for messages. */
  name: string;
  loc: Loc;
  /** The id of the component rendered (after `memo`/`forwardRef` wrappers). */
  target: string;
  /** One set for each way the site is rendered (a slot renders at each of its positions). */
  sets: readonly ContextSet[];
  via: readonly SlotRef[];
  /** Why a dynamic tag renders the target (a map entry, a branch); null for a tag that names it. */
  origin: Origin | null;
};

export type Missing = { site: Site; context: string };

export type WalkResult = { reached: ReadonlySet<string>; missing: readonly Missing[] };

/** The sites inside a component: each render of an own component, where it is written. */
export function sitesIn(graph: Graph, componentId: string): Site[] {
  const component = graph.components.get(componentId);
  return (component?.renders ?? []).flatMap((render): Site[] => {
    if (render.kind !== "component") return [];
    const target = graph.resolve(render.id);
    if (target === undefined) return [];
    return [
      {
        name: render.name,
        loc: render.loc,
        target: target.id,
        sets: placementSets(graph, render),
        via: render.via,
        origin: render.origin,
      },
    ];
  });
}

function stateKey(target: string, above: ContextSet, suppressed: ContextSet): string {
  return JSON.stringify([target, [...above].sort(), [...suppressed].sort()]);
}

function siteKey(site: Site, context: string): string {
  return JSON.stringify([site.loc.file, site.loc.start, context]);
}

/**
 * Walks down from the entry sites, carrying the Providers above. At a site, every context the
 * rendered component needs and nothing above provides is missing: it is reported at that site
 * and not again further down the same path. Each (site, context) is reported once.
 */
export function walkFromEntries(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  entries: readonly Site[],
): WalkResult {
  const reached = new Set<string>();
  const missing = new Map<string, Missing>();
  const seen = new Set<string>();

  const visit = (site: Site, outer: ContextSet, suppressed: ContextSet): void => {
    for (const here of site.sets) {
      const above = union(outer, here);
      const key = stateKey(site.target, above, suppressed);
      if (seen.has(key)) continue;
      seen.add(key);
      reached.add(site.target);
      const absent = minus(needs.get(site.target) ?? new Set<string>(), above, suppressed);
      for (const context of absent) {
        const found = siteKey(site, context);
        if (!missing.has(found)) missing.set(found, { site, context });
      }
      const next = union(suppressed, absent);
      for (const inner of sitesIn(graph, site.target)) visit(inner, above, next);
    }
  };

  for (const entry of entries) visit(entry, new Set<string>(), new Set<string>());
  return { reached, missing: [...missing.values()] };
}
