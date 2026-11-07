/**
 * The two commands the language server's guarantee lens and "Show proof path" action run (named in
 * packages/language-server/src/guarantees.ts), and their argument, read at the boundary.
 */
export const SHOW_COVERS_COMMAND = "stateward.showGuaranteeCovers";
export const SHOW_PROOF_PATH_COMMAND = "stateward.showProofPath";

export type Position = { line: number; character: number };
export type Place = { uri: string; range: { start: Position; end: Position }; label: string };
/** A title and the places to jump through, in order. */
export type PlaceList = { title: string; places: Place[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positionOf(value: unknown): Position | undefined {
  if (!isRecord(value)) return undefined;
  const { line, character } = value;
  if (typeof line !== "number" || typeof character !== "number") return undefined;
  return { line, character };
}

function placeOf(value: unknown): Place | undefined {
  if (!isRecord(value) || !isRecord(value.range)) return undefined;
  const { uri, label } = value;
  const start = positionOf(value.range.start);
  const end = positionOf(value.range.end);
  if (typeof uri !== "string" || typeof label !== "string") return undefined;
  if (start === undefined || end === undefined) return undefined;
  return { uri, range: { start, end }, label };
}

/** The list a command was called with; undefined when the argument is anything else. */
export function placeListFrom(argument: unknown): PlaceList | undefined {
  if (!isRecord(argument) || typeof argument.title !== "string") return undefined;
  if (!Array.isArray(argument.places)) return undefined;
  const places: Place[] = [];
  for (const value of argument.places) {
    const place = placeOf(value);
    if (place === undefined) return undefined;
    places.push(place);
  }
  return { title: argument.title, places };
}

/** "src/Readers.tsx:12": where a place is, from the folder that holds it. */
export function whereOf(place: Place, folderUri: string | undefined): string {
  const prefix = folderUri === undefined ? "" : `${folderUri.replace(/\/$/, "")}/`;
  const shown = place.uri.startsWith(prefix) ? place.uri.slice(prefix.length) : place.uri;
  return `${decodeURIComponent(shown.replace(/^file:\/\//, ""))}:${String(place.range.start.line + 1)}`;
}
