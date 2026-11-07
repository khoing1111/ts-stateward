import type { CoveredPlace, EditorContributions, StatedGuarantee } from "@stateward/core";
import { analysisOf, type Analysis } from "./hover.js";
import { hookReadsOf } from "./provider-missing/graph.js";
import { REQUIRED_CONTEXT } from "./provider-missing/resolve.js";
import { PROVIDER_MISSING_ID } from "./provider-missing/rule.js";
import type { Loc } from "./provider-missing/summary.js";

type Guarantees = NonNullable<EditorContributions["guarantees"]>;

const PROMISE = "every reader is rendered under its Provider";

function compareLoc(a: Loc, b: Loc): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start;
}

/** The components that read `context`, themselves or through a hook of the project. */
function readersOf(analysis: Analysis, context: string): CoveredPlace[] {
  const { graph } = analysis;
  return graph.componentList
    .filter(
      (component) =>
        component.reads.some((read) => read.context === context) ||
        component.hooks.some((call) => hookReadsOf(graph, call.id).has(context)),
    )
    .map((component) => ({ name: `<${component.name}>`, loc: component.loc }))
    .sort((a, b) => compareLoc(a.loc, b.loc))
    .map(({ name, loc }) => ({
      name,
      location: { file: loc.file, start: loc.start, end: loc.end },
    }));
}

/**
 * The contexts stated required (`RequiredContext`): each one declared in the project, read or
 * not, and each read one declared elsewhere (another package of a monorepo), with the components
 * that read it. From the last full check's summaries of `provider-missing`; nothing when it did
 * not run.
 */
export const guarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(PROVIDER_MISSING_ID);
  if (summaries === undefined) return [];
  const analysis = analysisOf(summaries);
  const stated = new Map<string, { name: string; loc: Loc; marker: string }>();
  for (const summary of analysis.summaries.values()) {
    for (const declared of summary.declared) {
      if (!stated.has(declared.id)) stated.set(declared.id, declared);
    }
  }
  for (const context of analysis.graph.contextList) {
    if (!context.stated || stated.has(context.id)) continue;
    stated.set(context.id, { name: context.name, loc: context.loc, marker: REQUIRED_CONTEXT });
  }
  return [...stated]
    .sort(([, a], [, b]) => compareLoc(a.loc, b.loc))
    .map(([id, declared]): StatedGuarantee => ({
      guarantee: REQUIRED_CONTEXT,
      marker: declared.marker,
      name: declared.name,
      location: { file: declared.loc.file, start: declared.loc.start, end: declared.loc.end },
      ruleId: PROVIDER_MISSING_ID,
      promise: PROMISE,
      covers: "readers",
      covered: readersOf(analysis, id),
    }));
};
