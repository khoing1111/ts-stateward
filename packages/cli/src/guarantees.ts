import { describeStatus, type GuaranteeProof } from "@stateward/core/internal";
import type { Location } from "@stateward/core/internal";
import { describeTraitSource, type TraitSource } from "@stateward/core";
import { plural } from "./format.js";

/** A guarantee whose plugin names no source is stated by the project's marker type. */
const MARKER: TraitSource = { kind: "marker" };

/**
 * `stateward guarantees`: every guarantee the code states, where, whether it is proven, and the
 * places it covers. A marker nothing uses is listed as unused, never left out.
 */

/** Where a place is, as the developer reads it: a path from their folder, and a 1-based line. */
export type Place = { readonly file: string; readonly line: number };

/** Turns a location into a place (core's offsets, the CLI's paths and lines). */
export type Locate = (location: Location) => Place;

/** At most this many covered places, and errors, are listed per guarantee; the rest are counted. */
const MAX_LISTED = 10;

type Counts = {
  proven: number;
  unproven: number;
  unchecked: number;
  unused: number;
  off: number;
};

function countsOf(proofs: readonly GuaranteeProof[]): Counts {
  const counts: Counts = { proven: 0, unproven: 0, unchecked: 0, unused: 0, off: 0 };
  for (const proof of proofs) counts[proof.status.kind] += 1;
  return counts;
}

function at(place: Place): string {
  return `${place.file}:${String(place.line)}`;
}

function listed<T>(items: readonly T[], line: (item: T) => string): string[] {
  const shown = items.slice(0, MAX_LISTED).map(line);
  const rest = items.length - shown.length;
  return rest > 0 ? [...shown, `    … and ${String(rest)} more`] : shown;
}

/**
 * Exit code, as `guarantees --help` says: 1 when a guarantee is stated but not proven (an error, or
 * a finding an ignore comment hides); 0 when every one is proven, unused or not checked (a place
 * the rules cannot follow, or a rule that is off).
 */
export function guaranteesExitCode(proofs: readonly GuaranteeProof[]): 0 | 1 {
  return proofs.some((proof) => proof.status.kind === "unproven") ? 1 : 0;
}

export function formatGuaranteesPretty(proofs: readonly GuaranteeProof[], locate: Locate): string {
  if (proofs.length === 0) {
    return [
      "No guarantee is stated in this project.",
      "A guarantee is a trait the code states, such as `RequiredContext` (the react-context pack), `Owned` or `Release` (the ownership pack): stateward then proves it everywhere. See docs/user/guarantees.md.",
      "",
    ].join("\n");
  }
  const blocks = proofs.map((proof) => {
    const { stated, status } = proof;
    const lines = [
      `${stated.name}: ${stated.marker}  ${at(locate(stated.location))}`,
      `  stated by ${describeTraitSource(stated.source ?? MARKER)}`,
      `  ${describeStatus(proof)}`,
    ];
    if (status.kind === "unproven") {
      lines.push(
        ...listed(status.errors, (error) => `    ${at(locate(error.location))}  ${error.message}`),
        ...listed(
          status.ignored,
          ({ finding, reason }) =>
            `    ${at(locate(finding.location))}  ${finding.message} (ignored${reason === "" ? "" : `: ${reason}`})`,
        ),
      );
    }
    if (status.kind === "unchecked") {
      lines.push(
        ...listed(
          status.places,
          (one) => `    ${at(locate(one.location))}  not checked: ${one.reason}`,
        ),
      );
    }
    if (stated.covered.length > 0 && status.kind !== "unused") {
      lines.push(`  ${stated.covers.many}:`);
      lines.push(
        ...listed(stated.covered, (place) => `    ${place.name}  ${at(locate(place.location))}`),
      );
    }
    return lines.join("\n");
  });
  const counts = countsOf(proofs);
  const parts = [
    `${String(counts.proven)} proven`,
    ...(counts.unproven > 0 ? [`${String(counts.unproven)} not proven`] : []),
    ...(counts.unused > 0 ? [`${String(counts.unused)} unused`] : []),
    ...(counts.off + counts.unchecked > 0
      ? [`${String(counts.off + counts.unchecked)} not checked`]
      : []),
  ];
  const next =
    counts.unproven > 0 ? " `stateward check` shows each error with the path to it." : "";
  return `${blocks.join("\n\n")}\n\n${plural(proofs.length, "guarantee")}: ${parts.join(", ")}.${next}\n`;
}

export function formatGuaranteesJson(proofs: readonly GuaranteeProof[], locate: Locate): string {
  const guarantees = proofs.map(({ stated, status }) => ({
    guarantee: stated.guarantee,
    source: stated.source ?? MARKER,
    marker: stated.marker,
    name: stated.name,
    declaration: stated.declaration,
    ...locate(stated.location),
    rule: stated.ruleId,
    status: status.kind,
    errors:
      status.kind === "unproven"
        ? status.errors.map((error) => ({ ...locate(error.location), message: error.message }))
        : [],
    ignored:
      status.kind === "unproven"
        ? status.ignored.map(({ finding, reason }) => ({
            ...locate(finding.location),
            message: finding.message,
            reason,
          }))
        : [],
    unchecked:
      status.kind === "unchecked"
        ? status.places.map((one) => ({ ...locate(one.location), reason: one.reason }))
        : [],
    covers: stated.covers.many,
    covered: stated.covered.map((place) => ({ name: place.name, ...locate(place.location) })),
  }));
  return JSON.stringify({ guarantees, summary: countsOf(proofs) }, null, 2);
}
