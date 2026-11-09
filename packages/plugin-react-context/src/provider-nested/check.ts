import { matchesName, type ProjectContext, type RelatedLocation } from "@stateward/core";
import { configuredEntries, entrySites } from "../provider-missing/check.js";
import { buildGraph, placementSets } from "../provider-missing/graph.js";
import type { EntryPoint } from "../provider-missing/options.js";
import type { Loc, ProviderSite, Summary } from "../provider-missing/summary.js";
import { sitesIn, type Site } from "../provider-missing/walk.js";
import * as message from "./messages.js";

type Single = { id: string; name: string; loc: Loc };

/** What provides a single-provider context above a place: a Provider, a render, or an entry. */
type Outer =
  | { kind: "provider"; loc: Loc }
  /** Given to a slot of `owner`, which renders it inside its Provider at `provider`. */
  | { kind: "slot"; provider: Loc; loc: Loc; tag: string; owner: string }
  | { kind: "render"; loc: Loc; tag: string }
  | { kind: "entry"; file: string; name: string };

function contains(span: Loc, loc: Loc): boolean {
  return span.file === loc.file && span.start <= loc.start && loc.end <= span.end;
}

function compareLoc(a: Loc, b: Loc): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start;
}

function toRelated(loc: Loc, text: string): RelatedLocation {
  return { location: { file: loc.file, start: loc.start, end: loc.end }, message: text };
}

/**
 * The project-wide step of `provider-nested`: walks down from the entry points as
 * `provider-missing` does, carrying, for each context stated `SingleProvider`, what provides it
 * above. A Provider of one met where it is already provided is reported once, with the outer
 * Provider as a note. Pure over the summaries.
 */
export function checkNested(
  summaries: ReadonlyMap<string, Summary>,
  entries: readonly EntryPoint[],
  ctx: ProjectContext,
  ignored: readonly string[] = [],
): void {
  const all = [...summaries.values()];
  const singles = new Map<string, Single>();
  for (const single of all.flatMap((summary) => summary.singles)) {
    if (!singles.has(single.id) && !matchesName(single.name, ignored)) {
      singles.set(single.id, single);
    }
  }
  if (singles.size === 0) return;
  const providers = all
    .flatMap((summary) => summary.providers)
    .sort((a, b) => compareLoc(a.loc, b.loc));
  const byOwner = new Map<string | null, ProviderSite[]>();
  for (const provider of providers) {
    byOwner.set(provider.owner, [...(byOwner.get(provider.owner) ?? []), provider]);
  }
  const graph = buildGraph(summaries);
  const reported = new Set<string>();
  const keyOf = (loc: Loc): string => `${loc.file}\u0000${String(loc.start)}`;

  /**
   * Reports `provider` under `outer`. `site`: the render of the component that writes it, when the
   * outer Provider is above that component; the finding is then at that render, where the second
   * Provider comes in, and the inner Provider is a note.
   */
  const report = (provider: ProviderSite, outer: Outer | undefined, site?: Site): void => {
    const at = site?.loc ?? provider.loc;
    const key = `${keyOf(at)}\u0000${keyOf(provider.loc)}`;
    if (reported.has(key) || reported.has(keyOf(provider.loc))) return;
    reported.add(key);
    const single = singles.get(provider.context);
    if (single === undefined) return;
    const related: RelatedLocation[] = [];
    if (outer?.kind === "provider") {
      related.push(toRelated(outer.loc, message.notes.outer(single.name)));
    }
    if (outer?.kind === "slot") {
      // The same Provider seen twice (a component inside itself) reads better as the render.
      if (keyOf(outer.provider) !== keyOf(provider.loc)) {
        related.push(toRelated(outer.provider, message.notes.outerIn(single.name, outer.owner)));
      } else if (keyOf(outer.loc) !== keyOf(at)) {
        related.push(
          toRelated(outer.loc, message.notes.inside(outer.tag, outer.owner, single.name)),
        );
      }
    }
    if (outer?.kind === "render" && keyOf(outer.loc) !== keyOf(at)) {
      related.push(toRelated(outer.loc, message.notes.renderedUnder(outer.tag, single.name)));
    }
    if (site !== undefined) {
      related.push(toRelated(provider.loc, message.notes.inner(single.name)));
    }
    related.push(toRelated(single.loc, message.notes.stated(single.name)));
    const text =
      site === undefined
        ? message.nested(provider.name, single.name)
        : outer?.kind === "entry"
          ? message.rendersUnderEntry(site.name, single.name, outer.file, outer.name)
          : message.rendersNested(site.name, single.name);
    ctx.report({ ...text, location: at, related });
  };

  /** The Provider of `context` around `loc` in what `owner` writes, as an outer note. */
  const enclosing = (owner: string | null, context: string, loc: Loc): Loc | undefined =>
    byOwner
      .get(owner)
      ?.find((provider) => provider.context === context && contains(provider.span, loc))?.loc;

  /**
   * The Provider of `context` around the place a slot renders what `site` is given (`children`
   * inside `<StoreContext.Provider>` in `Layout`): the outer Provider when the site's own
   * component does not write it.
   */
  const throughSlots = (site: Site, context: string): Outer | undefined => {
    for (const slot of site.via) {
      const owner = graph.resolve(slot.owner);
      if (owner === undefined) continue;
      for (const position of graph.positions(slot)) {
        if (!position.under.includes(context)) continue;
        const found = enclosing(owner.id, context, position.loc);
        if (found !== undefined) {
          return {
            kind: "slot",
            provider: found,
            loc: site.loc,
            tag: site.name,
            owner: owner.name,
          };
        }
      }
    }
    return undefined;
  };

  /** Checks the Providers `owner` writes, with what is provided above it. */
  const checkOwner = (
    owner: string | null,
    above: ReadonlyMap<string, Outer>,
    site: Site | undefined,
  ): void => {
    for (const provider of byOwner.get(owner) ?? []) {
      if (provider.outer !== null) {
        report(provider, { kind: "provider", loc: provider.outer });
        continue;
      }
      const outer = above.get(provider.context);
      if (outer !== undefined) {
        report(provider, outer, site);
        continue;
      }
      // Given to a slot (`children`) that another component renders inside a Provider of it.
      if (placementSets(graph, provider).some((set) => set.has(provider.context))) {
        report(provider, undefined);
      }
    }
  };

  const seen = new Set<string>();
  const visit = (site: Site, above: ReadonlyMap<string, Outer>, from: string | null): void => {
    for (const set of site.sets) {
      const here = new Map(above);
      for (const id of set) {
        if (!singles.has(id) || here.has(id)) continue;
        const loc = enclosing(from, id, site.loc);
        here.set(
          id,
          loc === undefined
            ? (throughSlots(site, id) ?? { kind: "render", loc: site.loc, tag: site.name })
            : { kind: "provider", loc },
        );
      }
      // Per render site, not per component: each render that brings in a second Provider is
      // its own finding.
      const key = JSON.stringify([
        site.loc.file,
        site.loc.start,
        site.target,
        [...here.keys()].sort(),
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      checkOwner(site.target, here, site);
      for (const inner of sitesIn(graph, site.target)) visit(inner, here, site.target);
    }
  };

  checkOwner(null, new Map(), undefined);
  for (const site of entrySites(graph)) visit(site, new Map(), null);
  for (const entry of entries) {
    const provided = new Map<string, Outer>();
    for (const name of entry.provides) {
      for (const single of singles.values()) {
        if (single.name === name) {
          provided.set(single.id, { kind: "entry", file: entry.file, name: entry.export });
        }
      }
    }
    for (const site of configuredEntries(graph, [entry]).sites) visit(site, provided, null);
  }
  // What no entry reaches still has the Providers nested in its own JSX; one outside any
  // component cannot be followed, and the trait is stated, so it is an error that says so.
  for (const [owner, list] of byOwner) {
    if (owner === null) continue;
    for (const provider of list) {
      if (reported.has(keyOf(provider.loc))) continue;
      if (provider.outer !== null) report(provider, { kind: "provider", loc: provider.outer });
      else if (owner === "") {
        const single = singles.get(provider.context);
        if (single === undefined) continue;
        reported.add(keyOf(provider.loc));
        ctx.report({
          ...message.notFollowed(provider.name, single.name),
          location: provider.loc,
          related: [toRelated(single.loc, message.notes.stated(single.name))],
        });
      }
    }
  }
}
