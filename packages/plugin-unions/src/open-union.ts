import type { CoveredPlace, EditorContributions, Json, StatedGuarantee } from "@stateward/core";

/** The trait `OpenUnion<T>` states: `"__guarantee:open-union"?: true`. */
export const OPEN_UNION = "open-union";

/** The rule that proves it. */
export const NON_EXHAUSTIVE_SWITCH_ID = "unions/non-exhaustive-switch";

type Place = { file: string; start: number; end: number };

/**
 * What `unions/non-exhaustive-switch` keeps of a file for the guarantees list: the open unions it
 * states (`type OrderStatus = OpenUnion<…>`) and its switches over one, each with the id of the
 * union's declaration (`<file>#<offset>`).
 */
export type OpenSummary = {
  declared: (Place & { name: string })[];
  switches: (Place & { id: string })[];
};

/** The engine hands summaries over as JSON; ours have these two lists. */
function isSummary(value: Json): value is OpenSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, Json>(Object.entries(value));
  return Array.isArray(fields.get("declared")) && Array.isArray(fields.get("switches"));
}

function comparePlace(a: Place, b: Place): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start || a.end - b.end;
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

type Guarantees = NonNullable<EditorContributions["guarantees"]>;

/**
 * The unions stated open (`OpenUnion<T>`), each with the switches over it: proven when every one
 * has a `default`, which handles a value the union does not list. From the last full check's
 * summaries; nothing when the rule did not run.
 */
export const guarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(NON_EXHAUSTIVE_SWITCH_ID);
  if (summaries === undefined) return [];
  const declared = new Map<string, Place & { name: string }>();
  const switches = new Map<string, Place[]>();
  for (const summary of summaries.values()) {
    if (!isSummary(summary)) continue;
    for (const one of summary.declared) declared.set(`${one.file}#${String(one.start)}`, one);
    for (const one of summary.switches)
      switches.set(one.id, [...(switches.get(one.id) ?? []), one]);
  }
  return [...declared.entries()]
    .sort(([, a], [, b]) => comparePlace(a, b))
    .map(([id, declaration]): StatedGuarantee => {
      const covered = (switches.get(id) ?? []).sort(comparePlace).map((place): CoveredPlace => ({
        name: baseName(place.file),
        location: { file: place.file, start: place.start, end: place.end },
      }));
      return {
        guarantee: OPEN_UNION,
        marker: "OpenUnion",
        name: declaration.name,
        location: { file: declaration.file, start: declaration.start, end: declaration.end },
        ruleId: NON_EXHAUSTIVE_SWITCH_ID,
        promise: "every `switch` on it handles a value it does not list",
        covers: { one: "switch", many: "switches" },
        covered,
      };
    });
};
