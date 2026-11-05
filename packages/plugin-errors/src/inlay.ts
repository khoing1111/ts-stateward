import ts from "@stateward/core/typescript";
import type { EditorContributions, EditorHint, Json } from "@stateward/core";
import { FACT_RULES } from "./inference/deps.js";
import { catchesOf } from "./inference/catches.js";
import { className, rejectsShown, resultLines, thrownText } from "./inference/format.js";
import { analyse, toThrown } from "./inference/solve.js";
import type { Source, Thrown } from "./inference/solve.js";
import type { ClassFact } from "./inference/summary.js";
import { TREE_RULES, throwsOf } from "./react/boundaries.js";

type InlayHints = NonNullable<EditorContributions["inlayHints"]>;

/** The two kinds of hint, as the `stateward.inlayHints.<kind>` settings name them. */
export const HINT_KINDS = { throws: "throws", catchVariable: "catchVariable" } as const;

/** At most this many class names are listed in a hint; the rest are counted (`+2`). */
const MAX_NAMES = 3;

/**
 * Where the unknown part of a signature's hint comes from: `(unknown from \`fetchAvatar\`)`, or
 * `(unknown from \`fetchAvatar\`, +2)` for several calls. `others` when no call is named, and
 * nothing at all when the set has no unknown part.
 */
function unknownPart(thrown: Thrown): string | undefined {
  if (thrown.unknowns.length === 0 && !thrown.more) return undefined;
  const calls = [...new Set(thrown.unknowns.map((source) => source.text).filter((t) => t !== ""))];
  const [first] = calls;
  if (first === undefined) return "others";
  const rest = calls.length - 1 + (thrown.more ? 1 : 0);
  const more = rest > 0 ? `, +${String(rest)}` : "";
  return `(unknown from \`${first}\`${more})`;
}

/** Whether an unknown error comes from a package's declaration, not from the project's own code. */
function fromLibrary(source: Source): boolean {
  return source.package !== undefined || source.reason.startsWith("package ");
}

function fromLibrariesOnly(thrown: Thrown): boolean {
  return !thrown.more && thrown.unknowns.length > 0 && thrown.unknowns.every(fromLibrary);
}

/**
 * `A | B | C | +2 | others`: the names in the hover's order, then the unknown part: where it comes
 * from after a signature (`unknownPart`), `unknown` after a catch variable. Empty when the set is
 * empty, and after a signature when nothing in it is named: a bare "throws others" says nothing.
 */
function listed(
  thrown: Thrown,
  classes: ReadonlyMap<string, ClassFact>,
  unknown: "sources" | "unknown",
): string {
  const ids = [...thrown.classes.keys()];
  const hoverText = (id: string): string => {
    const origin = thrown.origins.get(id);
    const name = className(id, classes);
    return origin === undefined ? name : `${name} (${origin})`;
  };
  // Sorted by the hover's text, so the order is the hover's.
  const names = [...new Set(ids.map((id) => [hoverText(id), className(id, classes)] as const))]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, name]) => name);
  const unique = [...new Set(names)];
  const rest = unique.length - MAX_NAMES;
  const hasUnknown = thrown.unknowns.length > 0 || thrown.more;
  const tail = unknown === "unknown" ? (hasUnknown ? "unknown" : undefined) : unknownPart(thrown);
  if (unique.length === 0 && (tail === undefined || tail === "others")) return "";
  // Nothing known, and every unknown comes from a library function: the hint says nothing the
  // person can act on (the hover still lists it).
  if (unique.length === 0 && unknown === "sources" && fromLibrariesOnly(thrown)) return "";
  return [
    ...unique.slice(0, MAX_NAMES),
    ...(rest > 0 ? [`+${String(rest)}`] : []),
    ...(tail === undefined ? [] : [tail]),
  ].join(" | ");
}

/** The name a function-like is bound to: its own, or the `const` / property it is the value of. */
function nameOf(node: ts.FunctionLikeDeclaration): ts.Identifier | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name !== undefined && ts.isIdentifier(node.name) ? node.name : undefined;
  }
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.initializer === node &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name;
  }
  return undefined;
}

/** Where the signature ends: after the return type, else after the `)` of the parameters. */
function signatureEnd(
  node: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
): number | undefined {
  if (node.type !== undefined) return node.type.end;
  return node.getChildren(sourceFile).find((child) => child.kind === ts.SyntaxKind.CloseParenToken)
    ?.end;
}

function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)) &&
    node.body !== undefined
  );
}

/** The summaries that hold the throws facts, from the rules that ran (as the hover reads them). */
export function factSummaries(input: {
  projectSummaries(ruleId: string): ReadonlyMap<string, Json> | undefined;
}): ReadonlyMap<string, Json> | undefined {
  let summaries: ReadonlyMap<string, Json> | undefined;
  for (const ruleId of FACT_RULES) summaries ??= input.projectSummaries(ruleId);
  let trees: ReadonlyMap<string, Json> | undefined;
  for (const ruleId of TREE_RULES) trees ??= input.projectSummaries(ruleId);
  return summaries ?? (trees === undefined ? undefined : throwsOf(trees));
}

/**
 * Two kinds of hint, from the last full check's solve (no recomputation, as the hover):
 * `throws A | B` or `throws (unknown from \`fetchAvatar\`)` after a named function's signature (the hover's facts, `rejects` for what its
 * promise rejects with), and `: A | B | unknown` after a catch variable (what the `try` can throw).
 */
export const inlayHints: InlayHints = (input) => {
  const summaries = factSummaries(input);
  if (summaries === undefined) return [];
  const analysis = analyse(summaries);
  const { sourceFile } = input;
  const hints: EditorHint[] = [];

  const catches = new Map(
    catchesOf(analysis, sourceFile.fileName).map((seen) => [seen.handler.at[0], seen] as const),
  );

  const visit = (node: ts.Node): void => {
    if (isFunctionWithBody(node)) {
      const name = nameOf(node);
      const end = signatureEnd(node, sourceFile);
      const symbol = name === undefined ? undefined : input.types.symbolAt(name);
      const result = symbol === undefined ? undefined : analysis.results.get(symbol.id);
      if (result !== undefined && end !== undefined) {
        const thrown = listed(result.throws, analysis.classes, "sources");
        const rejected = listed(rejectsShown(result), analysis.classes, "sources");
        const parts = [
          ...(thrown === "" ? [] : [`throws ${thrown}`]),
          ...(rejected === "" ? [] : [`rejects ${rejected}`]),
        ];
        if (parts.length > 0) {
          hints.push({
            offset: end,
            kind: HINT_KINDS.throws,
            label: parts.join(" · "),
            paddingLeft: true,
            tooltip: resultLines(result, analysis.classes).join("\n\n"),
          });
        }
      }
    } else if (ts.isCatchClause(node)) {
      const declaration = node.variableDeclaration;
      const name = declaration?.name;
      const seen = catches.get(node.getStart(sourceFile));
      if (
        name !== undefined &&
        ts.isIdentifier(name) &&
        declaration?.type === undefined &&
        seen?.handler.variable === name.text
      ) {
        const thrown = toThrown(seen.thrown);
        if (thrown.classes.size > 0) {
          hints.push({
            offset: name.end,
            kind: HINT_KINDS.catchVariable,
            label: `: ${listed(thrown, analysis.classes, "unknown")}`,
            tooltip: `The \`try\` can throw: ${thrownText(thrown, analysis.classes)}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hints;
};
