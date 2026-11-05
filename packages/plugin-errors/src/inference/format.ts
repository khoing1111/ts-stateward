import { builtinCatchName, builtinName, isBuiltin } from "./builtins.js";
import type { Result, Source, Thrown } from "./solve.js";
import type { ClassFact } from "./summary.js";

/** At most this many unknown sources are listed; the rest are counted. */
const MAX_LISTED_SOURCES = 5;

const PACKAGE_CLASS = /^package:.+#(?<name>[^#]+)$/;

/** A class's name from its id when no facts are known about it (`package:zod#ZodError`). */
function nameOfId(id: string): string {
  return PACKAGE_CLASS.exec(id)?.groups?.name ?? id;
}

/** How a class is shown: its name, `AbortError (DOMException)` for a named DOMException. */
export function className(id: string, classes: ReadonlyMap<string, ClassFact>): string {
  return isBuiltin(id) ? builtinName(id) : (classes.get(id)?.name ?? nameOfId(id));
}

/** The name an `instanceof` test or a `@throws` tag uses for the class. */
export function catchName(id: string, classes: ReadonlyMap<string, ClassFact>): string {
  return isBuiltin(id) ? builtinCatchName(id) : (classes.get(id)?.name ?? nameOfId(id));
}

function sourceKey(source: Source): string {
  return `${source.file}:${String(source.start)}:${source.reason}`;
}

/** `api.get: no declaration`. */
function sourceText(source: Source): string {
  return `${source.text}: ${source.reason}`;
}

/** `others stateward cannot see (from a: why; b: why; and 3 more)`. */
export function unknownText(sources: readonly Source[], more: boolean): string {
  const listed = sources.slice(0, MAX_LISTED_SOURCES).map(sourceText);
  const rest = sources.length - listed.length;
  const tail = rest > 0 || more ? [`and ${String(rest)}${more ? "+" : ""} more`] : [];
  return `others stateward cannot see (from ${[...listed, ...tail].join("; ")})`;
}

/**
 * `ParseError | ZodError (zod 3.23.8: declared) | others stateward cannot see (from …)`, or "" for an empty set: a class
 * known from a package's facts names where they come from.
 */
export function thrownText(thrown: Thrown, classes: ReadonlyMap<string, ClassFact>): string {
  const shown = (id: string): string => {
    const origin = thrown.origins.get(id);
    const name = className(id, classes);
    return origin === undefined ? name : `${name} (${origin})`;
  };
  const names = [...new Set([...thrown.classes.keys()].map(shown))].sort();
  const parts =
    thrown.unknowns.length > 0 || thrown.more
      ? [...names, unknownText(thrown.unknowns, thrown.more)]
      : names;
  return parts.join(" | ");
}

/**
 * What a call's promise rejects with, without the unknown parts already listed as thrown: an
 * unknown call is both thrown and returned when stateward cannot tell whether it gives a promise,
 * and is shown once, where it is thrown.
 */
export function rejectsShown(result: Result): Thrown {
  const shown = new Set(result.throws.unknowns.map(sourceKey));
  return {
    ...result.rejects,
    unknowns: result.rejects.unknowns.filter((s) => !shown.has(sourceKey(s))),
  };
}

/**
 * The hover's lines: `throws: …` for what a call throws, `rejects: …` for what its promise
 * rejects with, `throws nothing stateward can see` when both are empty.
 */
export function resultLines(result: Result, classes: ReadonlyMap<string, ClassFact>): string[] {
  const throws = thrownText(result.throws, classes);
  const rejects = thrownText(rejectsShown(result), classes);
  const lines = [
    ...(throws === "" ? [] : [`throws: ${throws}`]),
    ...(rejects === "" ? [] : [`rejects: ${rejects}`]),
  ];
  return lines.length === 0 ? ["throws nothing stateward can see"] : lines;
}
