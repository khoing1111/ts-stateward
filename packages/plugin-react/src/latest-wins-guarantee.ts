import { declarationId } from "@stateward/core";
import type {
  CoveredPlace,
  EditorContributions,
  Json,
  Location,
  StatedGuarantee,
} from "@stateward/core";

/** The rule that proves "the latest answer wins" for a loader that takes an `AbortSignal`. */
export const EFFECT_RESPONSE_RACE_ID = "react/effect-response-race";

/** The guarantee's name, as `stateward guarantees --format json` lists it. */
export const LATEST_WINS = "latest-wins";

/**
 * What `react/effect-response-race` keeps of a file for the guarantees list: each call in an effect
 * to a loader of the project that takes an `AbortSignal` (the type states that a late answer can
 * be dropped), with the loader's declaration.
 */
export type LatestWinsSummary = {
  calls: { name: string; declaration: Location; call: Location }[];
};

function isLocation(value: unknown): value is Location {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, unknown>(Object.entries(value));
  return (
    typeof fields.get("file") === "string" &&
    typeof fields.get("start") === "number" &&
    typeof fields.get("end") === "number"
  );
}

type Call = LatestWinsSummary["calls"][number];

function isCall(value: unknown): value is Call {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = new Map<string, unknown>(Object.entries(value));
  return (
    typeof fields.get("name") === "string" &&
    isLocation(fields.get("declaration")) &&
    isLocation(fields.get("call"))
  );
}

/** The calls of a summary the engine hands over as JSON, each checked field by field. */
function callsOf(value: Json): readonly Call[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const list: unknown = new Map<string, Json>(Object.entries(value)).get("calls");
  return Array.isArray(list) ? list.filter(isCall) : [];
}

function compareLocation(a: Location, b: Location): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start || a.end - b.end;
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

type Guarantees = NonNullable<EditorContributions["guarantees"]>;

/**
 * Each loader of the project that takes an `AbortSignal` and that an effect calls: proven when
 * every such effect aborts it in its cleanup (or checks a flag the cleanup sets). Its findings are
 * linked to the loader's declaration. From the last full check's summaries; nothing when the rule
 * did not run.
 */
export const guarantees: Guarantees = (input) => {
  const summaries = input.projectSummaries(EFFECT_RESPONSE_RACE_ID);
  if (summaries === undefined) return [];
  const loaders = new Map<string, { name: string; declaration: Location; calls: Location[] }>();
  for (const summary of summaries.values()) {
    for (const one of callsOf(summary)) {
      const id = declarationId(one.declaration);
      const known = loaders.get(id) ?? {
        name: one.name,
        declaration: one.declaration,
        calls: [],
      };
      known.calls.push(one.call);
      loaders.set(id, known);
    }
  }
  return [...loaders.entries()]
    .sort(([, a], [, b]) => compareLocation(a.declaration, b.declaration))
    .map(([id, loader]): StatedGuarantee => {
      const covered = loader.calls
        .sort(compareLocation)
        .map((call): CoveredPlace => ({ name: baseName(call.file), location: call }));
      return {
        guarantee: LATEST_WINS,
        source: { kind: "type", name: "AbortSignal" },
        marker: "AbortSignal",
        name: loader.name,
        declaration: id,
        location: loader.declaration,
        ruleId: EFFECT_RESPONSE_RACE_ID,
        promise: "every effect that calls it with inputs that change aborts it in its cleanup",
        covers: { one: "effect call", many: "effect calls" },
        covered,
      };
    });
};
