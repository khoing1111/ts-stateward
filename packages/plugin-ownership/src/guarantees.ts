import type { CoveredPlace, EditorContributions, Json, StatedGuarantee } from "@stateward/core";
// Types only: the rule's modules (and TypeScript) load when the rule runs, not with the plugin.
import type { OwnedDeclaration, Place } from "./owned.js";

/** The guarantee `Owned<T>` states (owned.ts `OWNED`). */
const OWNED = "owned";

type Guarantees = NonNullable<EditorContributions["guarantees"]>;

export const STATE_WRITTEN_ID = "ownership/state-written-outside-owner";

/** What the list reads of a file's summary: the values it states owned, and who changes them. */
type GuaranteeSummary = {
  ownedDeclared: OwnedDeclaration[];
  ownerWrites: (Place & { id: string })[];
  owned: (Place & { kind: string; id: string | null })[];
};

const LISTS = ["ownedDeclared", "ownerWrites", "owned"] as const;

/** The engine hands summaries over as JSON; ours have these lists, whatever else they hold. */
function isSummary(value: Json): value is GuaranteeSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, Json>(Object.entries(value));
  return LISTS.every((key) => Array.isArray(fields.get(key)));
}

function comparePlace(a: Place, b: Place): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start || a.end - b.end;
}

/** `src/settings.ts#settings` → `src/settings.ts`: the owner, as the rule's messages name it. */
function ownerOf(id: string): string {
  return id.slice(0, Math.max(0, id.indexOf("#")));
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/**
 * The values stated owned (`Owned<T>`): each one declared in the project, changed or not, with
 * the modules that change it (one place each, its first change). Proven when only its owner (or
 * a file `owners` allows) does: the rule's errors say which others do. From the last full check's
 * summaries; nothing when the rule did not run.
 */
export const guarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(STATE_WRITTEN_ID);
  if (summaries === undefined) return [];
  const declared = new Map<string, OwnedDeclaration>();
  /** By declaration id, then by writing file: its first change there. */
  const writers = new Map<string, Map<string, Place>>();
  const addWriter = (id: string, place: Place): void => {
    const byFile = writers.get(id) ?? new Map<string, Place>();
    const known = byFile.get(place.file);
    if (known === undefined || comparePlace(place, known) < 0) byFile.set(place.file, place);
    writers.set(id, byFile);
  };
  for (const summary of summaries.values()) {
    if (!isSummary(summary)) continue;
    for (const declaration of summary.ownedDeclared) {
      if (!declared.has(declaration.id)) declared.set(declaration.id, declaration);
    }
    for (const write of summary.ownerWrites) addWriter(write.id, write);
    for (const change of summary.owned) {
      if (change.kind === "write" && change.id !== null) addWriter(change.id, change);
    }
  }
  return [...declared.values()].sort(comparePlace).map((declaration): StatedGuarantee => {
    const covered = [...(writers.get(declaration.id)?.values() ?? [])]
      .sort(comparePlace)
      .map((place): CoveredPlace => ({
        name: baseName(place.file),
        location: { file: place.file, start: place.start, end: place.end },
      }));
    return {
      guarantee: OWNED,
      marker: declaration.marker,
      name: declaration.name,
      location: { file: declaration.file, start: declaration.start, end: declaration.end },
      ruleId: STATE_WRITTEN_ID,
      promise: `only \`${ownerOf(declaration.id)}\` changes it`,
      covers: "writers",
      covered,
    };
  });
};
