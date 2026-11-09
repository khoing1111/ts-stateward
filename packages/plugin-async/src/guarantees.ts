import type { CoveredPlace, EditorContributions, Json, StatedGuarantee } from "@stateward/core";
// Types only: the rule's module (and TypeScript) loads when the rule runs, not with the plugin.
import type { PendingSummary } from "./pending-state-stuck-on-failure.js";

type Guarantees = NonNullable<EditorContributions["guarantees"]>;
type Place = { file: string; start: number; end: number };

const PENDING_ID = "async/pending-state-stuck-on-failure";

function isSummary(value: Json): value is PendingSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, Json>(Object.entries(value));
  return Array.isArray(fields.get("pending")) && Array.isArray(fields.get("starts"));
}

function comparePlace(a: Place, b: Place): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start || a.end - b.end;
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/**
 * The states stated `Pending`, each with the places that set it running: proven when each of
 * them settles on every way out and does not start while it runs.
 */
export const guarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(PENDING_ID);
  if (summaries === undefined) return [];
  const declared = new Map<string, PendingSummary["pending"][number]>();
  const starts = new Map<string, Place[]>();
  for (const summary of summaries.values()) {
    if (!isSummary(summary)) continue;
    for (const one of summary.pending) declared.set(`${one.file}#${String(one.start)}`, one);
    for (const one of summary.starts) starts.set(one.id, [...(starts.get(one.id) ?? []), one]);
  }
  return [...declared.entries()]
    .sort(([, a], [, b]) => comparePlace(a, b))
    .map(([id, state]): StatedGuarantee => {
      const covered = (starts.get(id) ?? []).sort(comparePlace).map((place): CoveredPlace => ({
        name: baseName(place.file),
        location: { file: place.file, start: place.start, end: place.end },
      }));
      const running = state.running.map((label) => `\`${label}\``).join(" or ");
      return {
        guarantee: "pending",
        source: { kind: "marker" },
        marker: "Pending",
        name: state.name,
        location: { file: state.file, start: state.start, end: state.end },
        ruleId: PENDING_ID,
        promise:
          running === ""
            ? `nothing yet: no value of \`${state.name}\` is stated running`
            : `\`${state.name}\` is running while ${running}; every way out of a function that sets it leaves another value, and that function does not start while it is ${running}`,
        covers: { one: "function that sets it", many: "functions that set it" },
        covered,
      };
    });
};
