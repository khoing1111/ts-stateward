import type { CoveredPlace, EditorContributions, Json, StatedGuarantee } from "@stateward/core";
// Types only: the rule's modules (and TypeScript) load when the rule runs, not with the plugin.
import type { OwnedDeclaration, Place } from "./owned.js";
import type { OpaqueSummary } from "./brand-built-outside-owner.js";
import type { ReleaseSummary } from "./resource-not-released.js";

/** The guarantee `Owned<T>` states (owned.ts `OWNED`). */
const OWNED = "owned";

type Guarantees = NonNullable<EditorContributions["guarantees"]>;

export const STATE_WRITTEN_ID = "ownership/state-written-outside-owner";
export const BRAND_BUILT_ID = "ownership/brand-built-outside-owner";
export const RESOURCE_ID = "ownership/resource-not-released";

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
export const guarantees: Guarantees = (input) =>
  [...ownedGuarantees(input), ...opaqueGuarantees(input), ...releaseGuarantees(input)].sort(
    (a, b) =>
      comparePlace(
        { file: a.location.file, start: a.location.start, end: a.location.end },
        { file: b.location.file, start: b.location.start, end: b.location.end },
      ),
  );

function isOpaqueSummary(value: Json): value is OpaqueSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, Json>(Object.entries(value));
  return Array.isArray(fields.get("opaque")) && Array.isArray(fields.get("builds"));
}

/**
 * The brands stated opaque (`Opaque<T, Name>`), each with the places in its module that build a
 * value of it. Proven when no other module builds one: the rule's errors say which do.
 */
const opaqueGuarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(BRAND_BUILT_ID);
  if (summaries === undefined) return [];
  const declared = new Map<string, Place & { name: string }>();
  const builds = new Map<string, Place[]>();
  for (const summary of summaries.values()) {
    if (!isOpaqueSummary(summary)) continue;
    for (const one of summary.opaque) declared.set(`${one.file}#${String(one.start)}`, one);
    for (const one of summary.builds) builds.set(one.id, [...(builds.get(one.id) ?? []), one]);
  }
  return [...declared.entries()].map(([id, declaration]): StatedGuarantee => {
    const covered = (builds.get(id) ?? []).sort(comparePlace).map((place): CoveredPlace => ({
      name: baseName(place.file),
      location: { file: place.file, start: place.start, end: place.end },
    }));
    return {
      guarantee: "opaque",
      source: { kind: "marker" },
      marker: "Opaque",
      name: declaration.name,
      location: { file: declaration.file, start: declaration.start, end: declaration.end },
      ruleId: BRAND_BUILT_ID,
      promise: `only \`${baseName(declaration.file)}\` builds a value of it`,
      covers: { one: "builder", many: "builders" },
      covered,
    };
  });
};

function isReleaseSummary(value: Json): value is ReleaseSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, Json>(Object.entries(value));
  return Array.isArray(fields.get("markers")) && Array.isArray(fields.get("calls"));
}

/**
 * Every source of the release trait in use: each function of the project stated `Release`, with
 * its calls; and each call whose trait comes from a type (`Disposable`), the config's facts or
 * stateward's facts, as its own entry, so a hover on the call says where the trait comes from.
 */
const releaseGuarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(RESOURCE_ID);
  if (summaries === undefined) return [];
  const markers = new Map<string, Place & { name: string }>();
  const callers = new Map<string, Place[]>();
  const stated: StatedGuarantee[] = [];
  for (const summary of summaries.values()) {
    if (!isReleaseSummary(summary)) continue;
    for (const one of summary.markers) markers.set(`${one.file}#${String(one.start)}`, one);
    for (const call of summary.calls) {
      const place = { file: call.file, start: call.start, end: call.end };
      if (call.declaration !== null) {
        const id = `${call.declaration.file}#${String(call.declaration.start)}`;
        callers.set(id, [...(callers.get(id) ?? []), place]);
        continue;
      }
      stated.push({
        guarantee: "release",
        source: call.source,
        marker: call.source.kind === "type" ? call.source.name : call.callee,
        name: `${call.callee}(…)`,
        location: place,
        ruleId: RESOURCE_ID,
        promise: "what it returns is released",
        covers: { one: "call", many: "calls" },
        covered: [{ name: baseName(call.file), location: place }],
      });
    }
  }
  for (const [id, declaration] of markers) {
    const covered = (callers.get(id) ?? []).sort(comparePlace).map((place): CoveredPlace => ({
      name: baseName(place.file),
      location: place,
    }));
    stated.push({
      guarantee: "release",
      source: { kind: "marker" },
      marker: "Release",
      name: declaration.name,
      location: { file: declaration.file, start: declaration.start, end: declaration.end },
      ruleId: RESOURCE_ID,
      promise: "every caller releases what it returns",
      covers: { one: "caller", many: "callers" },
      covered,
    });
  }
  return stated;
};

const ownedGuarantees: Guarantees = (input) => {
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
      source: { kind: "marker" },
      marker: declaration.marker,
      name: declaration.name,
      location: { file: declaration.file, start: declaration.start, end: declaration.end },
      ruleId: STATE_WRITTEN_ID,
      promise: `only \`${ownerOf(declaration.id)}\` changes it`,
      covers: { one: "writer", many: "writers" },
      covered,
    };
  });
};
