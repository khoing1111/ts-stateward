import { compareFindings } from "./engine.js";
import type { Finding, Location, StatedGuarantee } from "./types.js";

type Problem = Extract<Finding, { kind: "problem" }>;

/**
 * Where a stated guarantee stands after a check:
 * - `proven`: its rule ran and reported nothing about it;
 * - `unproven`: its rule reported these errors about it (each names the declaration);
 * - `unused`: nothing uses it, so there is nothing to prove (a dead marker);
 * - `off`: its rule is not on (the rollout has not reached it), so nothing proves it.
 */
export type GuaranteeStatus =
  | { readonly kind: "proven" }
  | { readonly kind: "unproven"; readonly errors: readonly Problem[] }
  | { readonly kind: "unused" }
  | { readonly kind: "off" };

export type GuaranteeProof = { readonly stated: StatedGuarantee; readonly status: GuaranteeStatus };

function sameStart(a: Location, b: Location): boolean {
  return a.file === b.file && a.start === b.start;
}

function compareStated(a: StatedGuarantee, b: StatedGuarantee): number {
  if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
  return a.location.start - b.location.start || (a.guarantee < b.guarantee ? -1 : 1);
}

/**
 * Each stated guarantee with its status, in file and offset order. `findings` are a check's
 * (after ignore comments, before a baseline: an accepted error still leaves it unproven);
 * `active` the rules that check ran. A finding is about a guarantee when it is a problem of the
 * guarantee's rule, not an info, with a related note at the declaration.
 */
export function proveGuarantees(
  stated: readonly StatedGuarantee[],
  findings: readonly Finding[],
  active: ReadonlySet<string>,
): GuaranteeProof[] {
  const problems = findings
    .filter((finding): finding is Problem => finding.kind === "problem")
    .filter((finding) => finding.severity !== "info");
  return [...stated].sort(compareStated).map((guarantee): GuaranteeProof => {
    if (!active.has(guarantee.ruleId)) return { stated: guarantee, status: { kind: "off" } };
    const errors = problems
      .filter(
        (finding) =>
          finding.ruleId === guarantee.ruleId &&
          finding.related.some((note) => sameStart(note.location, guarantee.location)),
      )
      .sort(compareFindings);
    if (errors.length > 0) return { stated: guarantee, status: { kind: "unproven", errors } };
    if (guarantee.covered.length === 0) return { stated: guarantee, status: { kind: "unused" } };
    return { stated: guarantee, status: { kind: "proven" } };
  });
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** "reader" for "readers": the noun of one covered place. */
function singular(covers: string): string {
  return covers.endsWith("s") ? covers.slice(0, -1) : covers;
}

/**
 * The status in a few words, the same in `stateward guarantees` and the editor: "proven for 3
 * readers", "not proven: 2 errors", "unused: nothing reads it", "not checked: … is not on".
 */
export function describeStatus(proof: GuaranteeProof): string {
  const { stated, status } = proof;
  switch (status.kind) {
    case "proven":
      return `proven for ${plural(stated.covered.length, singular(stated.covers))}`;
    case "unproven":
      return `not proven: ${plural(status.errors.length, "error")}`;
    case "unused":
      return `unused: no ${singular(stated.covers)}, so nothing to prove; use it or drop the marker`;
    case "off":
      return `not checked: ${stated.ruleId} is not on`;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** The guarantee whose declaration covers `offset` of `file` (a TypeScript path), if any. */
export function guaranteeAt(
  proofs: readonly GuaranteeProof[],
  file: string,
  offset: number,
): GuaranteeProof | undefined {
  return proofs.find(
    ({ stated }) =>
      stated.location.file === file &&
      offset >= stated.location.start &&
      offset <= stated.location.end,
  );
}
