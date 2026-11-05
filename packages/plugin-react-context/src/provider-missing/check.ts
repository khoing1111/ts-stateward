import { matchesName, type ProjectContext } from "@stateward/core";
import { buildGraph, computeNeeds, placementSets, type ContextSet, type Graph } from "./graph.js";
import * as message from "./messages.js";
import type { EntryPoint } from "./options.js";
import type { ComponentSummary, Loc, Render, Summary } from "./summary.js";
import { limitNotes, originNote, slotNote, trailNotes } from "./trail.js";
import { walkFromEntries, type Site } from "./walk.js";

function contextName(graph: Graph, id: string): string {
  return graph.contexts.get(id)?.name ?? id;
}

function matchesFile(file: string, wanted: string): boolean {
  return file === wanted || file.endsWith(`/${wanted}`);
}

type ConfiguredEntries = {
  sites: Site[];
  problems: { entry: EntryPoint; message: message.Message }[];
};

/** Matches the `entries` option against components (by file and export) and context names. */
function configuredEntries(graph: Graph, entries: readonly EntryPoint[]): ConfiguredEntries {
  const sites: Site[] = [];
  const problems: ConfiguredEntries["problems"] = [];
  for (const entry of entries) {
    const found = graph.componentList.filter(
      (component) =>
        matchesFile(component.loc.file, entry.file) && component.exports.includes(entry.export),
    );
    if (found.length === 0) {
      problems.push({ entry, message: message.entryMatchesNoComponent(entry.file, entry.export) });
    }
    const provided: string[] = [];
    for (const name of entry.provides) {
      const matching = graph.contextList.filter((context) => context.name === name);
      if (matching.length === 0) {
        problems.push({
          entry,
          message: message.providesMatchesNoContext(entry.file, entry.export, name),
        });
      }
      provided.push(...matching.map((context) => context.id));
    }
    for (const component of found) {
      sites.push({
        name: component.name,
        loc: component.loc,
        target: component.id,
        sets: [new Set(provided)],
        via: [],
        origin: null,
      });
    }
  }
  return { sites, problems };
}

function entrySites(graph: Graph): Site[] {
  return graph.entries.flatMap(({ render }): Site[] => {
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

function reportMissingProviders(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  sites: readonly Site[],
  ctx: ProjectContext,
  ignored: readonly string[],
): ReadonlySet<string> {
  const { reached, missing } = walkFromEntries(graph, needs, sites);
  for (const { site, context } of missing) {
    const target = graph.components.get(site.target);
    if (target === undefined) continue;
    const name = contextName(graph, context);
    if (matchesName(name, ignored)) continue;
    const text = message.missingProvider(site.name, name);
    const related = limitNotes([
      ...slotNote(graph, site.via, context),
      ...originNote(site.origin, target),
      ...trailNotes(graph, needs, target, context),
    ]).map((note) => ({ location: note.loc, message: note.message }));
    ctx.report({ ...text, location: site.loc, related });
  }
  return reached;
}

/** The components some element of which escapes: reported as escaping, so not also as unreachable. */
function escapedComponents(graph: Graph): ReadonlySet<string> {
  const ids = allRenders(graph).flatMap((render) =>
    render.kind === "unknown" && render.reason === "escapes" ? [render.target] : [],
  );
  return new Set(ids.map((id) => graph.resolve(id)?.id ?? id));
}

function reportUnreachable(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  reached: ReadonlySet<string>,
  ctx: ProjectContext,
): void {
  const escaped = escapedComponents(graph);
  for (const component of graph.componentList) {
    const needed = [...(needs.get(component.id) ?? [])].map((id) => contextName(graph, id));
    if (needed.length === 0 || reached.has(component.id) || escaped.has(component.id)) continue;
    ctx.unknown({
      ...message.unreachableComponent(component.name, needed.sort()),
      location: component.loc,
    });
  }
}

function allRenders(graph: Graph): Render[] {
  return [
    ...graph.componentList.flatMap((component: ComponentSummary) => component.renders),
    ...graph.entries.map((entry) => entry.render),
    ...graph.unknowns,
  ];
}

/** Unknown renders of components and of plain functions, each reported once. */
function reportUnknownRenders(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  ctx: ProjectContext,
): void {
  const anyNeeds = [...needs.values()].some((set) => set.size > 0);
  const needsAny = (id: string): boolean => (needs.get(graph.resolve(id)?.id ?? id)?.size ?? 0) > 0;
  const reported = new Set<string>();
  for (const render of allRenders(graph)) {
    if (render.kind !== "unknown") continue;
    const key = JSON.stringify([render.loc.file, render.loc.start, render.reason]);
    if (reported.has(key)) continue;
    reported.add(key);
    switch (render.reason) {
      case "computed":
        if (anyNeeds) {
          ctx.unknown({
            ...message.computedComponent(render.name, render.fix),
            location: render.loc,
          });
        }
        break;
      case "class":
        if (anyNeeds) {
          ctx.unknown({ ...message.classComponent(render.name), location: render.loc });
        }
        break;
      case "escapes":
        if (needsAny(render.target)) {
          ctx.unknown({ ...message.escapingJsx(render.name, render.detail), location: render.loc });
        }
        break;
      case "router":
        if (render.targets.some(needsAny)) {
          ctx.unknown({ ...message.routerNotFollowed(), location: render.loc });
        }
        break;
      default: {
        const unreachable: never = render;
        return unreachable;
      }
    }
  }
}

/** One unknown for each context declared outside the checked files, at its first read. */
function reportExternalContexts(
  summaries: ReadonlyMap<string, Summary>,
  ctx: ProjectContext,
): void {
  const first = new Map<string, { name: string; loc: Loc }>();
  for (const summary of summaries.values()) {
    for (const external of summary.externalContexts) {
      const seen = first.get(external.id);
      const before =
        seen !== undefined &&
        (seen.loc.file < external.loc.file ||
          (seen.loc.file === external.loc.file && seen.loc.start <= external.loc.start));
      if (!before) first.set(external.id, { name: external.name, loc: external.loc });
    }
  }
  for (const { name, loc } of first.values()) {
    ctx.unknown({ ...message.externalContext(name), location: loc });
  }
}

/**
 * The project-wide step: needs flow up from reads, Providers remove them, and every render site
 * reachable from an entry point is checked. Pure over the summaries.
 */
export function checkSummaries(
  summaries: ReadonlyMap<string, Summary>,
  entries: readonly EntryPoint[],
  ctx: ProjectContext,
  ignored: readonly string[] = [],
): void {
  reportExternalContexts(summaries, ctx);
  const graph = buildGraph(summaries);
  const first = graph.contextList[0];
  if (first === undefined) return;
  const needs = computeNeeds(graph);
  const configured = configuredEntries(graph, entries);
  for (const problem of configured.problems) {
    ctx.unknown({ ...problem.message, location: first.loc });
  }
  const sites = [...entrySites(graph), ...configured.sites];
  if (sites.length === 0 && graph.entryCalls.length === 0) {
    const names = graph.contextList.map((context) => context.name);
    ctx.unknown({ ...message.noEntryPoint([...new Set(names)]), location: first.loc });
  } else {
    const reached = reportMissingProviders(graph, needs, sites, ctx, ignored);
    reportUnreachable(graph, needs, reached, ctx);
  }
  reportUnknownRenders(graph, needs, ctx);
}
