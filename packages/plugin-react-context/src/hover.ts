import ts from "@stateward/core/typescript";
import type { EditorContributions, Json } from "@stateward/core";
import { buildGraph, computeNeeds, type ContextSet, type Graph } from "./provider-missing/graph.js";
import { codeList } from "./provider-missing/messages.js";
import { PROVIDER_MISSING_ID } from "./provider-missing/rule.js";
import { ANY_CONTEXT, type ComponentSummary, type Summary } from "./provider-missing/summary.js";
import { routeTo } from "./provider-missing/trail.js";

type Hover = NonNullable<EditorContributions["hover"]>;

const SUMMARY_LISTS = [
  "contexts",
  "components",
  "hooks",
  "entries",
  "entryCalls",
  "unknowns",
  "routes",
  "externalContexts",
  "guards",
  "declared",
  "providers",
  "statedProviders",
  "singles",
] as const;

/** The engine hands summaries over as JSON; ours have these lists, whatever else they hold. */
function isSummary(value: Json): value is Summary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, Json>(Object.entries(value));
  return SUMMARY_LISTS.every((key) => Array.isArray(fields.get(key)));
}

export type Analysis = {
  graph: Graph;
  needs: ReadonlyMap<string, ContextSet>;
  /** The summaries, read as ours. */
  summaries: ReadonlyMap<string, Summary>;
};

/**
 * One analysis for each full check: the engine hands out the same `Map` until the next check, so
 * hovering does not recompute the project.
 */
const analyses = new WeakMap<ReadonlyMap<string, Json>, Analysis>();

export function analysisOf(summaries: ReadonlyMap<string, Json>): Analysis {
  const known = analyses.get(summaries);
  if (known !== undefined) return known;
  const typed = new Map<string, Summary>();
  for (const [file, summary] of summaries) {
    if (isSummary(summary)) typed.set(file, summary);
  }
  const graph = buildGraph(typed);
  const made = { graph, needs: computeNeeds(graph), summaries: typed };
  analyses.set(summaries, made);
  return made;
}

/** The identifier that covers `offset`, if any. */
function identifierAt(root: ts.Node, offset: number): ts.Identifier | undefined {
  if (offset < root.getStart() || offset >= root.getEnd()) return undefined;
  if (ts.isIdentifier(root)) return root;
  return ts.forEachChild(root, (child) => identifierAt(child, offset));
}

/** The name of a component declaration, or the last name of a JSX tag. */
function isComponentName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) {
    return parent.name === identifier;
  }
  const tag =
    ts.isPropertyAccessExpression(parent) && parent.name === identifier ? parent : identifier;
  const owner = tag.parent;
  return (
    (ts.isJsxOpeningElement(owner) ||
      ts.isJsxSelfClosingElement(owner) ||
      ts.isJsxClosingElement(owner)) &&
    owner.tagName === tag
  );
}

function needsLine(analysis: Analysis, component: ComponentSummary): string[] {
  const { graph, needs } = analysis;
  const names = [...(needs.get(component.id) ?? [])]
    .flatMap((id) => {
      const name = graph.contexts.get(id)?.name;
      return name === undefined ? [] : [{ id, name }];
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return names.map(({ id, name }) => {
    const first = routeTo(graph, needs, component, id)?.steps[0];
    return first === undefined
      ? `\`${name}\` (read in the component)`
      : `\`${name}\` (via \`${first.via}\`)`;
  });
}

/** The contexts every position of each slot is under: what the component provides to it. */
function providesLine(analysis: Analysis, component: ComponentSummary): string[] {
  const { graph } = analysis;
  return component.slots.flatMap((slot) => {
    const [first, ...rest] = slot.positions;
    if (first === undefined) return [];
    const everywhere = first.under.filter(
      (id) => id !== ANY_CONTEXT && rest.every((position) => position.under.includes(id)),
    );
    const names = [
      ...new Set(everywhere.flatMap((id) => graph.contexts.get(id)?.name ?? [])),
    ].sort();
    if (names.length === 0) return [];
    const target = slot.name === "children" ? "its children" : `its \`${slot.name}\``;
    return [`${codeList(names)} to ${target}`];
  });
}

/**
 * "needs / provides" on a component's declaration name and on the JSX tags of own components
 *. Answers from the last full check's summaries, and says nothing when
 * the rule has not run or the component needs and provides nothing.
 */
export const hover: Hover = (input) => {
  const { offset, sourceFile, types } = input;
  const summaries = input.projectSummaries(PROVIDER_MISSING_ID);
  if (summaries === undefined) return undefined;
  const identifier = identifierAt(sourceFile, offset);
  if (identifier === undefined || !isComponentName(identifier)) return undefined;
  const symbol = types.symbolAt(identifier);
  if (symbol === undefined) return undefined;
  const analysis = analysisOf(summaries);
  const component = analysis.graph.resolve(symbol.id);
  if (component === undefined) return undefined;
  const needed = needsLine(analysis, component);
  const provided = providesLine(analysis, component);
  const head = `**<${identifier.text}>**`;
  const lines = [
    ...(needed.length === 0 ? [] : [`${head} needs ${needed.join(", ")}`]),
    ...(provided.length === 0
      ? []
      : [`${needed.length === 0 ? `${head} ` : ""}provides ${provided.join("; ")}`]),
  ];
  // A blank line between them: Markdown joins single-newline lines into one paragraph.
  return lines.length === 0 ? undefined : lines.join("\n\n");
};
