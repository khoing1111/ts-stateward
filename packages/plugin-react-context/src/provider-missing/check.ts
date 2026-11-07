import { matchesName, type Fix, type ProjectContext, type TextEdit } from "@stateward/core";
import {
  buildGraph,
  computeNeeds,
  placementSets,
  provides,
  type ContextInfo,
  type ContextSet,
  type Graph,
} from "./graph.js";
import * as message from "./messages.js";
import type { EntryPoint } from "./options.js";
import type { DeclareFix, Edit, Loc, Render, Summary, UnknownRender } from "./summary.js";
import { limitNotes, originNote, slotNote, trailNotes, type Note } from "./trail.js";
import { walkFromEntries, type Arrival, type Site, type WalkResult } from "./walk.js";

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

/**
 * What the check needs to know about the contexts stated required (`RequiredContext`): which are
 * stated, and, as it reports, which are not proven somewhere. A stated context with no finding is
 * proven, and its run-time checks can go.
 */
type Strict = {
  stated: ReadonlySet<string>;
  unproven: Set<string>;
  ignored: readonly string[];
};

function toLocation(loc: Loc): { file: string; start: number; end: number } {
  return { file: loc.file, start: loc.start, end: loc.end };
}

function toEdit(edit: Edit): TextEdit {
  return { location: toLocation(edit), newText: edit.newText };
}

function toRelated(notes: readonly Note[]): { location: Loc; message: string }[] {
  return notes.map((note) => ({ location: note.loc, message: note.message }));
}

/** The note at a stated context's declaration, which says where the guarantee comes from. */
function statedNote(context: ContextInfo): Note {
  return { loc: context.loc, message: message.guaranteeNotes.stated(context.name) };
}

/** The quick fix that states a guessed context required: the first form that compiles is offered. */
function declareFix(context: ContextInfo, declare: DeclareFix): Fix | undefined {
  const [first, ...rest] = declare.forms.map((edits) => ({
    title: message.fixTitles.declare(context.name, declare.call),
    edits: edits.map(toEdit),
    changesType: true as const,
  }));
  return first === undefined ? undefined : { ...first, alternatives: rest };
}

function reportMissingProviders(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  sites: readonly Site[],
  ctx: ProjectContext,
  strict: Strict,
): WalkResult {
  const walk = walkFromEntries(graph, needs, sites);
  for (const { site, context } of walk.missing) {
    const target = graph.components.get(site.target);
    const info = graph.contexts.get(context);
    if (target === undefined || info === undefined) continue;
    if (matchesName(info.name, strict.ignored)) continue;
    const text = message.missingProvider(
      site.name,
      info.name,
      info.stated ? undefined : info.declare?.call,
    );
    const trail = limitNotes([
      ...slotNote(graph, site.via, context),
      ...originNote(site.origin, target),
      ...trailNotes(graph, needs, target, context),
    ]);
    if (info.stated) {
      strict.unproven.add(context);
      const related = toRelated([...trail, statedNote(info)]);
      ctx.report({ ...text, location: site.loc, related });
      continue;
    }
    const fix = info.declare === null ? undefined : declareFix(info, info.declare);
    ctx.report({
      ...text,
      location: site.loc,
      related: toRelated(trail),
      ...(fix === undefined ? {} : { fixes: [fix] }),
    });
  }
  return walk;
}

/** The components some element of which escapes: reported as escaping, so not also as unreachable. */
function escapedComponents(graph: Graph): ReadonlySet<string> {
  const ids = allRenders(graph).flatMap((render) =>
    render.kind === "unknown" && render.reason === "escapes" ? [render.target] : [],
  );
  return new Set(ids.map((id) => graph.resolve(id)?.id ?? id));
}

/**
 * The stated contexts provided on every path at some tag stateward cannot tell (`<Picked/>`
 * under the Provider): a reader no entry reaches may be rendered there, under its Provider, so it
 * is not reported as unreachable.
 */
function coveredByUnknown(graph: Graph, walk: WalkResult, strict: Strict): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const { render, owner } of unknownRenders(graph)) {
    if (render.reason !== "computed" && render.reason !== "class") continue;
    const aboveSets = owner === null ? [new Set<string>()] : walk.above.get(owner);
    if (aboveSets === undefined) continue;
    const under = new Set(render.under);
    for (const id of strict.stated) {
      if (aboveSets.every((above) => provides(above, id) || provides(under, id))) covered.add(id);
    }
  }
  return covered;
}

function reportUnreachable(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  walk: WalkResult,
  ctx: ProjectContext,
  strict: Strict,
): void {
  const escaped = escapedComponents(graph);
  const covered = coveredByUnknown(graph, walk, strict);
  for (const component of graph.componentList) {
    if (walk.reached.has(component.id) || escaped.has(component.id)) continue;
    const ids = [...(needs.get(component.id) ?? [])];
    const stated = ids.filter((id) => strict.stated.has(id) && !covered.has(id));
    const guessed = ids.filter((id) => !strict.stated.has(id));
    if (stated.length > 0) {
      for (const id of stated) strict.unproven.add(id);
      const names = stated.map((id) => contextName(graph, id)).sort();
      ctx.report({
        ...message.unreachableStated(component.name, names),
        location: component.loc,
        related: toRelated(statedNotes(graph, stated)),
      });
    }
    if (guessed.length > 0) {
      ctx.unknown({
        ...message.unreachableComponent(
          component.name,
          guessed.map((id) => contextName(graph, id)).sort(),
        ),
        location: component.loc,
      });
    }
  }
}

function statedNotes(graph: Graph, ids: readonly string[]): Note[] {
  return ids.flatMap((id) => {
    const info = graph.contexts.get(id);
    return info === undefined ? [] : [statedNote(info)];
  });
}

function allRenders(graph: Graph): Render[] {
  return [
    ...graph.componentList.flatMap((component) => component.renders),
    ...graph.entries.map((entry) => entry.render),
    ...graph.unknowns,
  ];
}

/** An unknown render and the component it is written in (null: an entry call or a plain function). */
type PlacedUnknown = { render: UnknownRender; owner: string | null };

function unknownRenders(graph: Graph): PlacedUnknown[] {
  const placed = (owner: string | null, render: Render): PlacedUnknown[] =>
    render.kind === "unknown" ? [{ render, owner }] : [];
  return [
    ...graph.componentList.flatMap((component) =>
      component.renders.flatMap((render) => placed(component.id, render)),
    ),
    ...graph.entries.flatMap((entry) => placed(null, entry.render)),
    ...graph.unknowns.flatMap((render) => placed(null, render)),
  ];
}

/** The path from an entry down to the component `owner`: one note per render, from the top. */
function pathNotes(arrivals: ReadonlyMap<string, Arrival>, owner: string | null): Note[] {
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (let at = owner; at !== null && !seen.has(at);) {
    seen.add(at);
    const arrival = arrivals.get(at);
    if (arrival === undefined) break;
    notes.unshift({ loc: arrival.site.loc, message: message.notes.rendered(arrival.site.name) });
    at = arrival.from;
  }
  return notes;
}

/**
 * The stated contexts an unknown render leaves unproven. A tag stateward cannot tell (`computed`,
 * `class`) may render any reader, so every stated context with readers that is not provided above
 * it on some path; a render of a known component (`escapes`, `router`), the stated contexts it
 * needs. A render in a component no entry reaches proves nothing either way: what leads to it is
 * reported instead.
 */
function unprovenAt(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  walk: WalkResult,
  strict: Strict,
  { render, owner }: PlacedUnknown,
): string[] {
  const aboveSets = owner === null ? [new Set<string>()] : walk.above.get(owner);
  if (aboveSets === undefined) return [];
  const needed = (id: string): ContextSet => needs.get(graph.resolve(id)?.id ?? id) ?? new Set();
  const candidates =
    render.reason === "escapes"
      ? [...needed(render.target)]
      : render.reason === "router"
        ? render.targets.flatMap((target) => [...needed(target)])
        : [...strict.stated];
  const under = new Set(render.under);
  return [...new Set(candidates)].filter(
    (id) =>
      strict.stated.has(id) &&
      !matchesName(contextName(graph, id), strict.ignored) &&
      aboveSets.some((above) => !provides(above, id) && !provides(under, id)),
  );
}

function unknownMessage(render: UnknownRender): message.Unchecked {
  switch (render.reason) {
    case "computed":
      return message.computedComponent(render.name, render.fix);
    case "class":
      return message.classComponent(render.name);
    case "escapes":
      return message.escapingJsx(render.name, render.detail);
    case "router":
      return message.routerNotFollowed();
    default: {
      const unreachable: never = render;
      return unreachable;
    }
  }
}

/**
 * Unknown renders of components and of plain functions, each reported once: as an error where a
 * stated context is not proven, else as not checked where a guessed context may be needed.
 */
function reportUnknownRenders(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  walk: WalkResult,
  ctx: ProjectContext,
  strict: Strict,
): void {
  const guessed = (id: string): boolean => !strict.stated.has(id);
  const anyNeeds = [...needs.values()].some((set) => [...set].some(guessed));
  const needsAny = (id: string): boolean =>
    [...(needs.get(graph.resolve(id)?.id ?? id) ?? [])].some(guessed);
  const reported = new Set<string>();
  for (const placed of unknownRenders(graph)) {
    const { render } = placed;
    const key = JSON.stringify([render.loc.file, render.loc.start, render.reason]);
    if (reported.has(key)) continue;
    reported.add(key);
    const unproven = unprovenAt(graph, needs, walk, strict, placed);
    if (unproven.length > 0) {
      for (const id of unproven) strict.unproven.add(id);
      const names = unproven.map((id) => contextName(graph, id)).sort();
      const related = toRelated([
        ...limitNotes(pathNotes(walk.arrivals, placed.owner)),
        ...statedNotes(graph, unproven),
      ]);
      ctx.report({
        ...message.unprovable(unknownMessage(render), names),
        location: render.loc,
        related,
      });
      continue;
    }
    const notChecked =
      render.reason === "escapes"
        ? needsAny(render.target)
        : render.reason === "router"
          ? render.targets.some(needsAny)
          : anyNeeds;
    if (notChecked)
      ctx.unknown({ ...message.notChecked(unknownMessage(render)), location: render.loc });
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
 * The run-time checks of stated contexts that every reader is proven for: an info each, with the
 * fix that drops it. A context with any finding is not proven, so its checks stay.
 */
function reportGuards(
  summaries: ReadonlyMap<string, Summary>,
  graph: Graph,
  ctx: ProjectContext,
  strict: Strict,
): void {
  const guards = [...summaries.values()]
    .flatMap((summary) => summary.guards)
    .sort((a, b) =>
      a.loc.file === b.loc.file ? a.loc.start - b.loc.start : a.loc.file < b.loc.file ? -1 : 1,
    );
  for (const guard of guards) {
    if (!strict.stated.has(guard.context) || strict.unproven.has(guard.context)) continue;
    const name = contextName(graph, guard.context);
    if (matchesName(name, strict.ignored)) continue;
    ctx.report({
      ...message.guardNotNeeded(guard.hook, name),
      location: toLocation(guard.loc),
      severity: "info",
      fixes: [{ title: message.fixTitles.dropGuard(guard.hook), edits: [toEdit(guard.removal)] }],
    });
  }
}

/**
 * The project-wide step: needs flow up from reads, Providers remove them, and every render site
 * reachable from an entry point is checked. A context stated required (`RequiredContext`) is
 * proven strictly: every place that is not proven is an error, never "not checked". Pure over the
 * summaries.
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
  const strict: Strict = {
    stated: new Set(graph.contextList.filter((context) => context.stated).map((c) => c.id)),
    unproven: new Set(),
    ignored,
  };
  const needs = computeNeeds(graph);
  const configured = configuredEntries(graph, entries);
  for (const problem of configured.problems) {
    ctx.unknown({ ...problem.message, location: first.loc });
  }
  const sites = [...entrySites(graph), ...configured.sites];
  if (sites.length === 0 && graph.entryCalls.length === 0) {
    const stated = graph.contextList.filter(
      (context) => context.stated && !matchesName(context.name, ignored),
    );
    const guessed = graph.contextList.filter((context) => !context.stated);
    if (stated.length > 0) {
      for (const context of stated) strict.unproven.add(context.id);
      ctx.report({
        ...message.noEntryPointStated([...new Set(stated.map((context) => context.name))]),
        location: (stated[0] ?? first).loc,
        related: toRelated(stated.map(statedNote)),
      });
    }
    if (guessed.length > 0) {
      const names = guessed.map((context) => context.name);
      ctx.unknown({ ...message.noEntryPoint([...new Set(names)]), location: first.loc });
    }
    reportUnknownRenders(graph, needs, emptyWalk(), ctx, strict);
  } else {
    const walk = reportMissingProviders(graph, needs, sites, ctx, strict);
    reportUnreachable(graph, needs, walk, ctx, strict);
    reportUnknownRenders(graph, needs, walk, ctx, strict);
  }
  reportGuards(summaries, graph, ctx, strict);
}

function emptyWalk(): WalkResult {
  return { reached: new Set(), missing: [], above: new Map(), arrivals: new Map() };
}
