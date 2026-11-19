import { compareFindings } from "./engine.js";
import { indexLedger } from "./ledger.js";
import { STATED_RULE_ID } from "./stated.js";
import type {
  CoveredNoun,
  Finding,
  IgnoredFinding,
  Ledger,
  Location,
  StatedGuarantee,
  UncheckedPlace,
} from "./types.js";

type Problem = Extract<Finding, { kind: "problem" }>;

/**
 * Where a stated guarantee stands after a check:
 * - `proven`: its rule ran everywhere the guarantee reaches and no finding stands against it,
 *   whatever the ignore comments and settings say;
 * - `unproven`: its rule reported these errors about it (each names the declaration), or an
 *   ignore comment hides these findings (`ignored`, each with the comment's reason): hidden from
 *   `check`, still not proven;
 * - `unchecked`: a place uses the value in a way the rule cannot follow (`places`);
 * - `unused`: no code refers to it (with a ledger, no reference to its declaration, or only
 *   imports, exports and types, `importsOnly`; without one, no place it covers), so there is
 *   nothing to prove (a dead marker);
 * - `off`: its rule is not on (the rollout has not reached it), or is off for these places the
 *   guarantee covers (`places`, empty when off everywhere), so nothing proves it.
 */
export type GuaranteeStatus =
  | { readonly kind: "proven" }
  | {
      readonly kind: "unproven";
      readonly errors: readonly Problem[];
      readonly ignored: readonly IgnoredProblem[];
    }
  | { readonly kind: "unchecked"; readonly places: readonly UncheckedPlace[] }
  | {
      readonly kind: "unused";
      /** Only imports, exports and types refer to it: nothing that runs uses it. */
      readonly importsOnly?: true;
    }
  | { readonly kind: "off"; readonly places: readonly Location[] };

/** A finding an ignore comment hides, and the reason the comment gives ("" when it gives none). */
export type IgnoredProblem = { readonly finding: Problem; readonly reason: string };

export type GuaranteeProof = { readonly stated: StatedGuarantee; readonly status: GuaranteeStatus };

function sameStart(a: Location, b: Location): boolean {
  return a.file === b.file && a.start === b.start;
}

function compareStated(a: StatedGuarantee, b: StatedGuarantee): number {
  if (a.location.file !== b.location.file) return a.location.file < b.location.file ? -1 : 1;
  return a.location.start - b.location.start || (a.guarantee < b.guarantee ? -1 : 1);
}

function comparePlace(a: Location, b: Location): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start - b.start || a.end - b.end;
}

function contains(place: Location, inner: Location): boolean {
  return place.file === inner.file && inner.start >= place.start && inner.end <= place.end;
}

/**
 * The guarantees a finding is about when no rule said (`Finding.guarantees` is absent): a problem
 * of the guarantee's rule with a related note at its declaration; or, when it has a note at no
 * declaration of that rule, one that lies in a place the guarantee covers (a file rule notes only
 * declarations in its own file, so a finding at a Provider in another file names the context by
 * where it is). A guarantee no plugin lists (`STATED_RULE_ID`) is the one a note of any rule is at.
 * This is the fallback for a rule that does not link its findings (`ReportProblem.against`).
 */
function aboutByPlace(
  finding: Problem,
  guarantee: StatedGuarantee,
  declarations: readonly StatedGuarantee[],
): boolean {
  if (guarantee.ruleId === STATED_RULE_ID) {
    return finding.related.some((note) => sameStart(note.location, guarantee.location));
  }
  if (finding.ruleId !== guarantee.ruleId) return false;
  if (finding.related.some((note) => sameStart(note.location, guarantee.location))) return true;
  const namesAnother = declarations.some(
    (other) =>
      other.ruleId === finding.ruleId &&
      finding.related.some((note) => sameStart(note.location, other.location)),
  );
  return (
    !namesAnother && guarantee.covered.some((place) => contains(place.location, finding.location))
  );
}

/**
 * Whether a finding is about a guarantee: it names its declaration (`Finding.guarantees`), or, when
 * no rule linked it, it lies where the guarantee is stated or covered (`aboutByPlace`).
 */
function isAbout(
  finding: Problem,
  guarantee: StatedGuarantee,
  declarations: readonly StatedGuarantee[],
): boolean {
  return finding.guarantees === undefined
    ? aboutByPlace(finding, guarantee, declarations)
    : names(finding, guarantee);
}

/**
 * Whether a finding names the guarantee: its declaration's id, and the rule that proves it (one
 * declaration may state several guarantees, each proven by its own rule); a guarantee no plugin
 * lists is named by a finding of any rule.
 */
function names(
  finding: { readonly ruleId: string; readonly guarantees?: readonly string[] },
  guarantee: StatedGuarantee,
): boolean {
  return (
    finding.guarantees?.includes(guarantee.declaration) === true &&
    (guarantee.ruleId === STATED_RULE_ID || finding.ruleId === guarantee.ruleId)
  );
}

/** What a proof reads besides the check's findings. */
export type ProofInputs = {
  /**
   * The findings ignore comments hide (`CheckResult.ignored`): they still stand against the
   * guarantee. Empty when the check applied no ignores.
   */
  readonly ignored?: readonly IgnoredFinding[];
  /**
   * Whether the config turns a rule off for a file (an `overrides` entry, or the rule off): the
   * rule never looked at the places the guarantee covers there. Absent: nowhere.
   */
  readonly ruleOffAt?: (ruleId: string, file: string) => boolean;
  /**
   * The findings of a rule the config turned off for the file they lie in, which the check left
   * out (`CheckResult.silenced`): a guarantee one is linked to reads "not checked" there, never
   * proven. Absent: none.
   */
  readonly silenced?: readonly Finding[];
  /**
   * The check's reference ledger (`CheckResult.ledger`): for a guarantee stated by a marker of a
   * trait it lists, every reference its rule did not mark, marked not checked or only handed on is
   * a place not checked, and the guarantee is unused only when it has no reference. Absent (a
   * caller with no ledger): unused when the guarantee covers no place.
   */
  readonly ledger?: Ledger;
};

/**
 * Whether a finding counts against a guarantee: any severity, if the rule says it is against one
 * or names one (`Finding.guarantees`).
 */
function counts(finding: Problem): boolean {
  return (
    finding.against === true || (finding.guarantees?.length ?? 0) > 0 || finding.severity !== "info"
  );
}

/**
 * The text of a place not checked from an `unknown` finding: its message without "not checked: ",
 * then what to write instead, from its hint (the first way, when it lists several), so the line
 * `stateward guarantees` prints says both.
 */
function reasonOf(message: string, hint: string): string {
  const what = message.startsWith(NOT_CHECKED) ? message.slice(NOT_CHECKED.length) : message;
  const lines = hint.split("\n");
  const way = lines.find((line) => line.startsWith("- "))?.slice(2) ?? lines[0] ?? "";
  return way === "" ? what : `${what}: ${way}`;
}

const NOT_CHECKED = "not checked: ";

/** The `unknown` findings that name a guarantee, with the places they leave unchecked. */
function unknownPlaces(finding: Finding, guarantee: StatedGuarantee): readonly UncheckedPlace[] {
  if (finding.kind !== "unknown" || !names(finding, guarantee)) return [];
  return [{ location: finding.location, reason: reasonOf(finding.message, finding.hint) }];
}

/**
 * Each stated guarantee with its status, in file and offset order. `findings` are a check's
 * (after ignore comments, before a baseline: an accepted error still leaves it unproven), and
 * `inputs.ignored` the ones ignore comments hid: a guarantee is proven only when no finding
 * stands against it before ignores and settings. `active` the rules that check
 * ran. A finding is about a guarantee when it names its declaration (`Finding.guarantees`), or,
 * for a finding no rule linked, lies where the guarantee is stated or covered (`aboutByPlace`); it
 * counts at any severity once linked, and unless it is a weaker signal the rule judged an info.
 * An `unknown` finding that names a guarantee leaves it "not checked" at its place, whatever the
 * config's `unknowns` setting shows of it. With the check's reference ledger (`inputs.ledger`), so
 * does every reference to a marked declaration its rule did not read (unmarked, marked unchecked,
 * or only handed on), and it is unused only when it has no reference.
 */
export function proveGuarantees(
  stated: readonly StatedGuarantee[],
  findings: readonly Finding[],
  active: ReadonlySet<string>,
  inputs: ProofInputs = {},
): GuaranteeProof[] {
  const problems = findings
    .filter((finding): finding is Problem => finding.kind === "problem")
    .filter(counts);
  const hidden = (inputs.ignored ?? []).flatMap(({ finding, reason }) =>
    finding.kind === "problem" && counts(finding) ? [{ finding, reason }] : [],
  );
  const unknowns = [...findings, ...(inputs.ignored ?? []).map(({ finding }) => finding)].filter(
    (finding) => finding.kind === "unknown",
  );
  const ledger = inputs.ledger === undefined ? undefined : indexLedger(inputs.ledger);
  return [...stated].sort(compareStated).map((guarantee): GuaranteeProof => {
    if (guarantee.ruleId !== STATED_RULE_ID && !active.has(guarantee.ruleId)) {
      return { stated: guarantee, status: { kind: "off", places: [] } };
    }
    const errors = problems
      .filter((finding) => isAbout(finding, guarantee, stated))
      .sort(compareFindings);
    const ignored = hidden
      .filter(({ finding }) => isAbout(finding, guarantee, stated))
      .sort((a, b) => compareFindings(a.finding, b.finding));
    if (errors.length > 0 || ignored.length > 0) {
      return { stated: guarantee, status: { kind: "unproven", errors, ignored } };
    }
    const off = [
      ...guarantee.covered
        .filter((place) => inputs.ruleOffAt?.(guarantee.ruleId, place.location.file) === true)
        .map((place) => place.location),
      ...(inputs.silenced ?? []).flatMap((finding) =>
        finding.kind !== "failure" && names(finding, guarantee) ? [finding.location] : [],
      ),
    ];
    if (off.length > 0) return { stated: guarantee, status: { kind: "off", places: off } };
    const own = guarantee.unchecked ?? [];
    // A guarantee a marker states, of a trait the ledger lists: its references are all known.
    const listed =
      ledger !== undefined &&
      (guarantee.source === undefined ||
        guarantee.source.kind === "marker" ||
        guarantee.source.kind === "tag") &&
      ledger.traits.has(guarantee.guarantee);
    const refs = listed ? ledger.refsOf(guarantee.declaration, guarantee.guarantee) : [];
    // Imports, exports and types run nothing: a declaration only they name is unused.
    const importsOnly =
      refs.length > 0 &&
      refs.every((ref) => ref.form === "import" || ref.form === "export" || ref.form === "type");
    const known: UncheckedPlace[] = [...own];
    const more: UncheckedPlace[] = [];
    for (const place of [
      ...unknowns.flatMap((finding) => unknownPlaces(finding, guarantee)),
      ...(listed && !importsOnly ? ledger.uncheckedOf(guarantee, refs) : []),
    ]) {
      if (known.some((one) => sameStart(one.location, place.location))) continue;
      known.push(place);
      more.push(place);
    }
    const unchecked =
      more.length === 0
        ? own
        : [...own, ...more].sort((a, b) => comparePlace(a.location, b.location));
    if (unchecked.length > 0) {
      return { stated: guarantee, status: { kind: "unchecked", places: unchecked } };
    }
    if (importsOnly) return { stated: guarantee, status: { kind: "unused", importsOnly: true } };
    const unused = listed ? refs.length === 0 : guarantee.covered.length === 0;
    if (unused) return { stated: guarantee, status: { kind: "unused" } };
    return { stated: guarantee, status: { kind: "proven" } };
  });
}

/** "1 switch", "2 switches": the count and the noun in its form for it, as the noun gives both. */
export function counted(count: number, noun: CoveredNoun): string {
  return `${String(count)} ${count === 1 ? noun.one : noun.many}`;
}

const ERROR: CoveredNoun = { one: "error", many: "errors" };

/** The reasons of the comments that hide findings, each once, in order: "lives as long as the app". */
function reasonsOf(ignored: readonly IgnoredProblem[]): string {
  const reasons = [
    ...new Set(ignored.map(({ reason }) => reason).filter((reason) => reason !== "")),
  ];
  return reasons.length === 0 ? "" : ` — ${reasons.join("; ")}`;
}

/**
 * The status in a few words, the same in `stateward guarantees` and the editor: "proven for 3
 * readers", "not proven: 2 errors", "not proven: 1 ignored — lives as long as the app", "unused:
 * nothing reads it", "not checked: … is not on".
 */
export function describeStatus(proof: GuaranteeProof): string {
  const { stated, status } = proof;
  switch (status.kind) {
    case "proven":
      return `proven for ${counted(stated.covered.length, stated.covers)}`;
    case "unproven": {
      const parts = [
        ...(status.errors.length > 0 ? [counted(status.errors.length, ERROR)] : []),
        ...(status.ignored.length > 0 ? [`${String(status.ignored.length)} ignored`] : []),
      ];
      return `not proven: ${parts.join(", ")}${reasonsOf(status.ignored)}`;
    }
    case "unchecked": {
      const [first] = status.places;
      const more = status.places.length - 1;
      return `not checked: ${first?.reason ?? "a place it cannot follow"}${more > 0 ? ` (and ${String(more)} more)` : ""}`;
    }
    case "unused":
      return status.importsOnly === true
        ? "unused: referenced only by imports or types"
        : `unused: no ${stated.covers.one}, so nothing to prove; use it or drop the marker`;
    case "off":
      return status.places.length === 0
        ? `not checked: ${stated.ruleId} is not on: turn it on in the config, or with \`stateward next\``
        : `not checked: ${stated.ruleId} is off for ${counted(status.places.length, stated.covers)}: turn it on for them in the config`;
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
