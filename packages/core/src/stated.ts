import { summaryOf, summaryValue } from "./cache.js";
import type { RuleResult } from "./cache.js";
import type { Json, StatedDeclaration, StatedGuarantee, TypeQueries } from "./types.js";
import type ts from "typescript";

/**
 * Where a file's stated declarations are kept in its entry of the cache (`results`), under the
 * same fingerprint as its findings: that covers the file's text and what it imports, which is all
 * a written type depends on. Like the ignore comments, it is not a rule's result.
 */
const STATED_KEY = "stateward/stated";

/** The rule id of a guarantee no plugin lists (`unlistedGuarantees`): core states it, no rule runs it. */
export const STATED_RULE_ID = "stateward/stated";

/**
 * The id of a stated declaration: `<file>#<offset>` of where its node starts, the place a plugin
 * lists it at (`StatedGuarantee.location`). A finding names the guarantees it is against by it
 * (`Finding.guarantees`).
 */
export function declarationId(at: { readonly file: string; readonly start: number }): string {
  return `${at.file}#${String(at.start)}`;
}

function isRecord(value: Json | undefined): value is Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOne(value: Json): StatedDeclaration | undefined {
  if (!isRecord(value)) return undefined;
  const { file, start, headEnd, end, name, marker, guarantees } = value;
  if (
    typeof file !== "string" ||
    typeof start !== "number" ||
    typeof headEnd !== "number" ||
    typeof end !== "number" ||
    typeof name !== "string" ||
    typeof marker !== "string" ||
    !isList(guarantees) ||
    !guarantees.every((one): one is string => typeof one === "string")
  ) {
    return undefined;
  }
  return { file, start, headEnd, end, name, marker, guarantees };
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function parseAll(value: Json): readonly StatedDeclaration[] | undefined {
  if (!isList(value)) return undefined;
  const found: StatedDeclaration[] = [];
  for (const item of value) {
    const one = parseOne(item);
    if (one === undefined) return undefined;
    found.push(one);
  }
  return found;
}

/**
 * The declarations of one file that state a guarantee in their written type, read from the cache
 * entry when it has them, else from the program (`read` gives the file's queries and source, and
 * is only called then). `stored` is true when this call added them to `results`.
 */
export function fileStated(
  results: Map<string, RuleResult>,
  read: () => { types: TypeQueries; sourceFile: ts.SourceFile } | undefined,
): { stated: readonly StatedDeclaration[]; stored: boolean } {
  const kept = results.get(STATED_KEY);
  if (kept !== undefined) {
    if (kept.summary === undefined) return { stated: [], stored: false };
    const parsed = parseAll(summaryValue(kept.summary));
    if (parsed !== undefined) return { stated: parsed, stored: false };
  }
  const opened = read();
  const stated = opened === undefined ? [] : opened.types.statedDeclarationsIn(opened.sourceFile);
  results.set(
    STATED_KEY,
    stated.length === 0
      ? { findings: [] }
      : {
          findings: [],
          summary: summaryOf(
            stated.map((one) => ({
              file: one.file,
              start: one.start,
              headEnd: one.headEnd,
              end: one.end,
              name: one.name,
              marker: one.marker,
              guarantees: [...one.guarantees],
            })),
          ),
        },
  );
  return { stated, stored: true };
}

/** The reason a synthesised guarantee reads "not checked": no rule checks the marker there. */
export function noRuleChecks(marker: string): string {
  return `\`${marker}\` is stated on a declaration no rule checks: state it where its pack's page shows`;
}

/**
 * A guarantee for each stated declaration (and each guarantee it states) that no plugin lists:
 * a rule that proves it would list it, so nothing here proves it, and it reads "not checked"
 * (never "unused", never "proven") until a rule does, or a finding is against it. A plugin lists a
 * declaration at where it starts, so a listed guarantee of the same name that starts inside the
 * declaration's head is the same one.
 */
export function unlistedGuarantees(
  scanned: readonly StatedDeclaration[],
  listed: readonly StatedGuarantee[],
): StatedGuarantee[] {
  const found: StatedGuarantee[] = [];
  for (const one of scanned) {
    for (const name of one.guarantees) {
      const known = listed.some(
        (guarantee) =>
          guarantee.guarantee === name &&
          guarantee.location.file === one.file &&
          guarantee.location.start >= one.start &&
          guarantee.location.start <= one.headEnd,
      );
      if (known) continue;
      const location = { file: one.file, start: one.start, end: one.end };
      found.push({
        guarantee: name,
        source: { kind: "marker" },
        marker: one.marker,
        name: one.name,
        declaration: declarationId(location),
        location,
        ruleId: STATED_RULE_ID,
        promise: "nothing yet: no rule proves it",
        covers: { one: "place", many: "places" },
        covered: [],
        unchecked: [{ location, reason: noRuleChecks(one.marker) }],
      });
    }
  }
  return found;
}
