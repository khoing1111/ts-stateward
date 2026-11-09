import type { CoveredPlace, EditorContributions, StatedGuarantee } from "@stateward/core";
import { analysisOf, type Analysis } from "./hover.js";
import { hookReadsOf } from "./provider-missing/graph.js";
import { REQUIRED_CONTEXT, SINGLE_PROVIDER, STABLE_CONTEXT } from "./provider-missing/resolve.js";
import { PROVIDER_MISSING_ID } from "./provider-missing/rule.js";
import type { Loc, StatedDeclaration } from "./provider-missing/summary.js";

type Guarantees = NonNullable<EditorContributions["guarantees"]>;

const PROVIDER_NESTED_ID = "react-context/provider-nested";
const PROVIDER_VALUE_ID = "react-context/provider-value-changes-every-render";

const READERS = { one: "reader", many: "readers" } as const;
const PROVIDERS = { one: "Provider", many: "Providers" } as const;

/** What each trait a context can state promises, which rule proves it, and what it covers. */
const TRAITS = {
  [REQUIRED_CONTEXT]: {
    ruleId: PROVIDER_MISSING_ID,
    promise: "every reader is rendered under its Provider",
  },
  [SINGLE_PROVIDER]: {
    ruleId: PROVIDER_NESTED_ID,
    promise: "its Provider appears once on any render path",
    marker: "SingleProvider",
  },
  [STABLE_CONTEXT]: {
    ruleId: PROVIDER_VALUE_ID,
    promise: "the value its Provider gives never changes",
    marker: "Stable",
  },
} as const;

function compareLoc(a: Loc, b: Loc): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start;
}

function place(loc: Loc): CoveredPlace["location"] {
  return { file: loc.file, start: loc.start, end: loc.end };
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
    .map(({ name, loc }) => ({ name, location: place(loc) }));
}

/** The Providers of `context` in the project, as their tags are written. */
function providersOf(analysis: Analysis, context: string): CoveredPlace[] {
  return [...analysis.summaries.values()]
    .flatMap((summary) => summary.statedProviders.filter((one) => one.context === context))
    .sort((a, b) => compareLoc(a.loc, b.loc))
    .map((one) => ({ name: `<${one.name}>`, location: place(one.loc) }));
}

/**
 * The contexts that state a trait on their type: `RequiredContext` (each one declared in the
 * project, read or not, and each read one declared elsewhere, another package of a monorepo), with
 * the components that read it; `SingleProvider` and `Stable`, with their Providers. One guarantee
 * per trait. From the last full check's summaries of `provider-missing`, which every rule of the
 * pack shares; nothing when it did not run.
 */
export const guarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(PROVIDER_MISSING_ID);
  if (summaries === undefined) return [];
  const analysis = analysisOf(summaries);
  const stated = new Map<string, StatedDeclaration>();
  for (const summary of analysis.summaries.values()) {
    for (const declared of summary.declared) {
      if (!stated.has(declared.id)) stated.set(declared.id, declared);
    }
  }
  for (const context of analysis.graph.contextList) {
    if (!context.stated || stated.has(context.id)) continue;
    stated.set(context.id, {
      id: context.id,
      name: context.name,
      loc: context.loc,
      marker: REQUIRED_CONTEXT,
      traits: [REQUIRED_CONTEXT],
    });
  }
  return [...stated.values()]
    .sort((a, b) => compareLoc(a.loc, b.loc))
    .flatMap((declared) =>
      declared.traits.flatMap((trait): StatedGuarantee[] => {
        const base = { name: declared.name, location: place(declared.loc) };
        if (trait === REQUIRED_CONTEXT) {
          return [
            {
              ...base,
              ...TRAITS[REQUIRED_CONTEXT],
              guarantee: trait,
              marker: declared.marker,
              covers: READERS,
              covered: readersOf(analysis, declared.id),
            },
          ];
        }
        if (trait === SINGLE_PROVIDER || trait === STABLE_CONTEXT) {
          return [
            {
              ...base,
              ...TRAITS[trait],
              guarantee: trait,
              covers: PROVIDERS,
              covered: providersOf(analysis, declared.id),
            },
          ];
        }
        return [];
      }),
    );
};
