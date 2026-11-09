import { pathToFileURL } from "node:url";
import {
  CodeActionKind,
  type CodeAction,
  type CodeLens,
  type Range,
} from "vscode-languageserver/node";
import { describeTraitSource } from "@stateward/core";
import { counted, describeStatus, displayPath } from "@stateward/core/internal";
import type { Finding, GuaranteeProof, Location } from "@stateward/core/internal";
import { buildLineIndex, toRange, type LineIndex } from "./mapping.js";

/**
 * The editor's view of the stated guarantees: a hover and a code lens on each marked
 * declaration, and "Show proof path" on each error about one. Everything here answers from the
 * last full pass (its proofs and the texts it read), so nothing is type checked on a request.
 */

/** Opens the places a guarantee covers (its errors first, then its readers) in a list to jump through. */
export const SHOW_COVERS_COMMAND = "stateward.showGuaranteeCovers";
/** Walks an error about a guarantee: where it fails, then each step of its path, then the declaration. */
export const SHOW_PROOF_PATH_COMMAND = "stateward.showProofPath";

/** One place to jump to, as the client's commands take it. */
export type Place = { uri: string; range: Range; label: string };
/** The argument of both commands: a title and the places, in order. */
export type PlaceList = { title: string; places: Place[] };

/** At most this many steps of a path are shown in a hover; the command shows them all. */
const HOVER_STEPS = 4;

/**
 * The proofs of the last full pass, with the text of every file they point into as that pass read
 * it: offsets are turned into lines with that text, and a file whose text has changed since gets
 * no hover or lens until the next pass.
 */
export type ProofView = {
  readonly proofs: readonly GuaranteeProof[];
  /** By TypeScript path. */
  readonly texts: ReadonlyMap<string, string>;
  /** The project folder, for paths in a hover. */
  readonly cwd: string;
};

export const NO_PROOFS: ProofView = { proofs: [], texts: new Map(), cwd: "" };

type Problem = Extract<Finding, { kind: "problem" }>;

/** Every file a proof points into. */
function filesOf(proofs: readonly GuaranteeProof[]): Set<string> {
  const files = new Set<string>();
  for (const { stated, status } of proofs) {
    files.add(stated.location.file);
    for (const place of stated.covered) files.add(place.location.file);
    if (status.kind !== "unproven") continue;
    for (const error of status.errors) {
      files.add(error.location.file);
      for (const note of error.related) files.add(note.location.file);
    }
  }
  return files;
}

export function proofView(
  proofs: readonly GuaranteeProof[],
  textOf: (file: string) => string | undefined,
  cwd: string,
): ProofView {
  const texts = new Map<string, string>();
  for (const file of filesOf(proofs)) {
    const text = textOf(file);
    if (text !== undefined) texts.set(file, text);
  }
  return { proofs, texts, cwd };
}

function indexer(view: ProofView): (file: string) => LineIndex {
  const indexes = new Map<string, LineIndex>();
  return (file) => {
    const known = indexes.get(file);
    if (known !== undefined) return known;
    const index = buildLineIndex(view.texts.get(file) ?? "");
    indexes.set(file, index);
    return index;
  };
}

/** The proofs declared in `file`, when the editor's text is still the one the pass read. */
function declaredIn(view: ProofView, file: string, text: string): GuaranteeProof[] {
  if (view.texts.get(file) !== text) return [];
  return view.proofs.filter((proof) => proof.stated.location.file === file);
}

function place(index: (file: string) => LineIndex, location: Location, label: string): Place {
  return {
    uri: pathToFileURL(location.file).href,
    range: toRange(index(location.file), location),
    label,
  };
}

function lineOf(view: ProofView, index: (file: string) => LineIndex, location: Location): string {
  const line = toRange(index(location.file), location).start.line + 1;
  return `${displayPath(view.cwd, location.file)}:${String(line)}`;
}

/** An error's path as places: where it fails, each note (the declaration's last). */
function pathOf(view: ProofView, index: (file: string) => LineIndex, error: Problem): Place[] {
  return [
    place(index, error.location, error.message),
    ...error.related.map((note) => place(index, note.location, note.message)),
  ];
}

function errorsOf(proof: GuaranteeProof): readonly Problem[] {
  return proof.status.kind === "unproven" ? proof.status.errors : [];
}

/**
 * The hover on a marked declaration: "Guaranteed: <what>; proven for N readers", or the first
 * error and its path when it is not proven; one part per trait the declaration states
 * (`SingleProvider` and `Stable` on one context). Undefined when `offset` is on no declaration.
 */
export function guaranteeHover(
  view: ProofView,
  file: string,
  text: string,
  offset: number,
): string | undefined {
  const proofs = declaredIn(view, file, text).filter(
    ({ stated }) => offset >= stated.location.start && offset <= stated.location.end,
  );
  if (proofs.length === 0) return undefined;
  return proofs.map((proof) => hoverOf(view, proof)).join("\n\n---\n\n");
}

function hoverOf(view: ProofView, proof: GuaranteeProof): string {
  const { stated } = proof;
  const source =
    stated.source === undefined || stated.source.kind === "marker"
      ? ""
      : `, stated by ${describeTraitSource(stated.source)}`;
  const head = `**Guaranteed:** ${stated.promise} (\`${stated.marker}\`${source}); ${describeStatus(proof)}`;
  const first = errorsOf(proof)[0];
  if (first === undefined) return head;
  const index = indexer(view);
  // The declaration's own note says what the hover already says.
  const steps = first.related.filter(
    (note) =>
      note.location.file !== stated.location.file || note.location.start !== stated.location.start,
  );
  const shown = steps
    .slice(0, HOVER_STEPS)
    .map((note) => `- ${lineOf(view, index, note.location)}: ${note.message}`);
  const more =
    steps.length > shown.length
      ? [`- … ${String(steps.length - shown.length)} more: "Show proof path" on the error`]
      : [];
  return [
    head,
    `First: ${first.message} (${lineOf(view, index, first.location)})`,
    [...shown, ...more].join("\n"),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

function lensTitle(proof: GuaranteeProof): string {
  const { stated, status } = proof;
  const count = stated.covered.length;
  switch (status.kind) {
    case "proven":
      return `${counted(count, stated.covers)} proven · show`;
    case "unproven":
      return `${String(status.errors.length)} not proven · ${counted(count, stated.covers)} · show`;
    case "unused":
    case "off":
      return describeStatus(proof);
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * A code lens above each marked declaration of `file`: what it covers, and a command that lists
 * it. A declaration that states several traits has a lens for each, headed by its marker.
 */
export function guaranteeLenses(view: ProofView, file: string, text: string): CodeLens[] {
  const index = indexer(view);
  const declared = declaredIn(view, file, text);
  const shared = (proof: GuaranteeProof): boolean =>
    declared.some(
      (other) =>
        other !== proof &&
        other.stated.location.start === proof.stated.location.start &&
        other.stated.location.file === proof.stated.location.file,
    );
  return declared.map((proof) => {
    const { stated } = proof;
    const places = [
      ...errorsOf(proof).map((error) =>
        place(index, error.location, `not proven: ${error.message}`),
      ),
      ...stated.covered.map((covered) => place(index, covered.location, covered.name)),
    ];
    const argument: PlaceList = { title: `${stated.name}: ${describeStatus(proof)}`, places };
    const range = toRange(index(file), stated.location);
    return {
      range: { start: range.start, end: range.start },
      command: {
        title: shared(proof) ? `${stated.marker}: ${lensTitle(proof)}` : lensTitle(proof),
        // A lens with nothing to list is a label: no command runs when it is clicked.
        command: places.length === 0 ? "" : SHOW_COVERS_COMMAND,
        arguments: places.length === 0 ? [] : [argument],
      },
    };
  });
}

/** "Show proof path" for each error about a guarantee whose place in `file` meets `range`. */
export function proofPathActions(
  view: ProofView,
  file: string,
  text: string,
  range: Range,
): CodeAction[] {
  if (view.texts.get(file) !== text) return [];
  const index = indexer(view);
  return view.proofs.flatMap((proof) =>
    errorsOf(proof).flatMap((error): CodeAction[] => {
      if (error.location.file !== file) return [];
      const at = toRange(index(file), error.location);
      const meets = !(isBefore(at.end, range.start) || isBefore(range.end, at.start));
      if (!meets) return [];
      const argument: PlaceList = {
        title: `Proof path: ${error.message}`,
        places: pathOf(view, index, error),
      };
      const title = `Show the proof path of ${proof.stated.name}`;
      return [
        {
          title,
          kind: CodeActionKind.QuickFix,
          command: { title, command: SHOW_PROOF_PATH_COMMAND, arguments: [argument] },
        },
      ];
    }),
  );
}

function isBefore(a: Range["start"], b: Range["start"]): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}
