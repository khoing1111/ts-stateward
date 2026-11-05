import type { ContextSet, Graph } from "./graph.js";
import { hookReadsOf, placementSets, provides } from "./graph.js";
import { notes } from "./messages.js";
import type { ComponentSummary, ComponentRender, Loc, Origin, Read, SlotRef } from "./summary.js";

export type Note = { loc: Loc; message: string };

const MAX_NOTES = 5;

function firstRead(reads: readonly Read[], context: string): Read | undefined {
  return reads.find((read) => read.context === context);
}

/** Where the first slot of `via` renders what it is given without `context` above. */
export function slotNote(graph: Graph, via: readonly SlotRef[], context: string): Note[] {
  const slot = via[0];
  if (slot === undefined) return [];
  const position = graph
    .positions(slot)
    .find((candidate) => !provides(new Set(candidate.under), context));
  return position ? [{ loc: position.loc, message: notes.slot(position.owner, slot.name) }] : [];
}

/** Why a dynamic tag renders `target`: the map entry or the branch; nothing for a plain tag. */
export function originNote(origin: Origin | null, target: ComponentSummary): Note[] {
  return origin === null ? [] : [{ loc: origin.loc, message: notes.origin(origin, target.name) }];
}

/** One step down a path: the notes it adds, and how the step reads in a sentence (`<Avatar>`). */
type Step = { to: string; notes: Note[]; via: string };

/** The shortest way from a component down to a read of a context: its steps, then the read. */
export type Route = { steps: readonly Step[]; read: Note };

/**
 * The shortest way from `start` down to a read of `context`. A step is only followed where the
 * context is not provided, so the route explains the error (or the need) it belongs to.
 */
export function routeTo(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  start: ComponentSummary,
  context: string,
): Route | undefined {
  const stepsFrom = (node: string): Step[] => {
    const component = graph.components.get(node);
    const renders = (component?.renders ?? []).flatMap((render): Step[] => {
      if (render.kind !== "component") return [];
      const target = graph.resolve(render.id);
      if (!target || !needs.get(target.id)?.has(context)) return [];
      if (placementSets(graph, render).every((set) => provides(set, context))) return [];
      return [
        {
          to: target.id,
          notes: renderNotes(graph, render, target, context),
          via: `<${render.name}>`,
        },
      ];
    });
    const calls = (component?.hooks ?? graph.hooks.get(node)?.hooks ?? []).flatMap(
      (call): Step[] => {
        const hook = graph.hooks.get(call.id);
        if (!hook || !hookReadsOf(graph, hook.id).has(context)) return [];
        return [
          {
            to: hook.id,
            notes: [{ loc: call.loc, message: notes.called(hook.name) }],
            via: `${hook.name}()`,
          },
        ];
      },
    );
    return [...renders, ...calls];
  };

  const readerOf = (node: string): Note | undefined => {
    const component = graph.components.get(node);
    const read = firstRead(component?.reads ?? graph.hooks.get(node)?.reads ?? [], context);
    const name = component?.name ?? graph.hooks.get(node)?.name ?? "";
    const contextName = graph.contexts.get(context)?.name ?? "";
    return read && { loc: read.loc, message: notes.reads(name, contextName) };
  };

  const parents = new Map<string, { from: string; step: Step }>();
  const queue = [start.id];
  const visited = new Set(queue);
  for (const node of queue) {
    const reader = readerOf(node);
    if (reader !== undefined) return { steps: pathTo(parents, node), read: reader };
    for (const step of stepsFrom(node)) {
      if (visited.has(step.to)) continue;
      visited.add(step.to);
      parents.set(step.to, { from: node, step });
      queue.push(step.to);
    }
  }
  return undefined;
}

/** The notes of `routeTo`, in the order a developer follows them: each step, then the read. */
export function trailNotes(
  graph: Graph,
  needs: ReadonlyMap<string, ContextSet>,
  start: ComponentSummary,
  context: string,
): Note[] {
  const route = routeTo(graph, needs, start, context);
  return route === undefined ? [] : [...route.steps.flatMap((step) => step.notes), route.read];
}

function renderNotes(
  graph: Graph,
  render: ComponentRender,
  target: ComponentSummary,
  context: string,
): Note[] {
  return [
    { loc: render.loc, message: notes.rendered(render.name) },
    ...slotNote(graph, render.via, context),
    ...originNote(render.origin, target),
  ];
}

function pathTo(parents: ReadonlyMap<string, { from: string; step: Step }>, node: string): Step[] {
  const path: Step[] = [];
  for (let found = parents.get(node); found; found = parents.get(found.from)) {
    path.unshift(found.step);
  }
  return path;
}

/**
 * At most five notes. A longer path keeps its first three and its last (the read, which is what
 * the developer came to see) and says how many steps lie between.
 */
export function limitNotes(path: Note[]): Note[] {
  if (path.length <= MAX_NOTES) return path;
  const head = path.slice(0, MAX_NOTES - 2);
  const last = path.at(-1);
  const skipped = path.slice(MAX_NOTES - 2, -1);
  const first = skipped[0];
  if (first === undefined || last === undefined) return head;
  return [...head, { loc: first.loc, message: notes.more(skipped.length) }, last];
}
