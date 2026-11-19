import { sha1, summaryOf, summaryValue } from "./cache.js";
import type { RuleMark, RuleResult } from "./cache.js";
import { noRuleChecks, STATED_RULE_ID } from "./stated.js";
import type {
  FlowVia,
  Json,
  Location,
  LedgerMark,
  LedgerRef,
  ReadOutcome,
  ReferenceForm,
  RuleProves,
  StatedGuarantee,
  TypeQueries,
  UncheckedPlace,
} from "./types.js";
import type ts from "typescript";

/**
 * The reference ledger: every reference in a file to a declaration that states a trait an active
 * rule proves, kept in the file's entry of the cache under the same fingerprint as its findings,
 * keyed also by the traits it lists (`ledgerKey`). A rule marks the references it reads
 * (`FileContext.read`); a proof reads every other one as not checked.
 */

const LEDGER_PREFIX = "stateward/ledger:";

/** The traits the active rules prove, joined and sorted: what the ledger lists references for. */
export type JoinedProves = {
  readonly traits: readonly string[];
  readonly returns: readonly string[];
  readonly made: readonly string[];
  readonly holders: readonly string[];
  readonly flows: {
    readonly produced: readonly string[];
    readonly decided: readonly string[];
    readonly escaped: readonly string[];
  };
  /** JSDoc tag names, without `@` (`RuleProves.tags`). */
  readonly tags: readonly string[];
};

/** The trait a JSDoc tag states in the ledger: `@neverRejects`. */
export function tagTrait(tag: string): string {
  return `@${tag}`;
}

/** The traits the active rules prove, joined and sorted: what the ledger lists references for. */
export function provesOf(all: readonly (RuleProves | undefined)[]): JoinedProves {
  const joined = (pick: (proves: RuleProves) => readonly string[] | undefined): string[] =>
    [
      ...new Set(all.flatMap((proves) => (proves === undefined ? [] : (pick(proves) ?? [])))),
    ].sort();
  return {
    traits: joined((proves) => proves.traits),
    returns: joined((proves) => proves.returns),
    made: joined((proves) => proves.made),
    holders: joined((proves) => proves.holders),
    flows: {
      produced: joined((proves) => proves.flows?.produced),
      decided: joined((proves) => proves.flows?.decided),
      escaped: joined((proves) => proves.flows?.escaped),
    },
    tags: joined((proves) => proves.tags),
  };
}

/**
 * The rule that proves each tag trait: the first of `rules` (sorted by id) whose `proves.tags`
 * lists the tag.
 */
export function tagRulesOf(
  rules: readonly { readonly id: string; readonly proves: RuleProves | undefined }[],
): Readonly<Record<string, string>> | undefined {
  const found = new Map<string, string>();
  for (const rule of [...rules].sort((a, b) => compareText(a.id, b.id))) {
    for (const tag of rule.proves?.tags ?? []) {
      if (!found.has(tagTrait(tag))) found.set(tagTrait(tag), rule.id);
    }
  }
  return found.size === 0
    ? undefined
    : Object.fromEntries([...found].sort(([a], [b]) => compareText(a, b)));
}

/** Every trait of `proves`, sorted and each once. */
export function ledgerTraits(proves: JoinedProves): readonly string[] {
  return [
    ...new Set([
      ...proves.traits,
      ...proves.returns,
      ...proves.made,
      ...proves.holders,
      ...proves.flows.produced,
      ...proves.flows.decided,
      ...proves.flows.escaped,
      ...proves.tags.map(tagTrait),
    ]),
  ].sort();
}

/** The key of a file's ledger in its cache entry: it changes with the traits it lists. */
export function ledgerKey(proves: JoinedProves): string {
  const { flows } = proves;
  const lists = [proves.traits, proves.returns, proves.made, proves.holders];
  // The key of a ledger without flows stays what it was before flows were listed.
  const flowLists = [flows.produced, flows.decided, flows.escaped];
  const flowed = flowLists.some((list) => list.length > 0) ? [...lists, ...flowLists] : lists;
  // Nor does the key of a ledger without tags.
  const keyed = proves.tags.length > 0 ? [...lists, ...flowLists, proves.tags] : flowed;
  return `${LEDGER_PREFIX}${sha1(JSON.stringify(keyed))}`;
}

const FORMS: ReadonlySet<string> = new Set<ReferenceForm>([
  "call",
  "read",
  "write",
  "alias",
  "import",
  "export",
  "argument",
  "stored",
  "returned",
  "jsx-tag",
  "jsx-attribute",
  "type",
  "computed",
  "other",
  "tag",
  "produced",
  "decided",
  "escaped",
]);

const VIAS: ReadonlySet<string> = new Set<FlowVia>([
  "value",
  "cast",
  "any",
  "overload",
  "override",
  "function-type",
  "generic-call",
  "indirect-call",
  "spread",
  "reflect",
  "literal",
  "for-of",
  "derived",
  "call",
  "stopped",
]);

function isVia(value: Json | undefined): value is FlowVia {
  return typeof value === "string" && VIAS.has(value);
}

function isForm(value: Json | undefined): value is ReferenceForm {
  return typeof value === "string" && FORMS.has(value);
}

function isRecord(value: Json | undefined): value is Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRef(value: Json): LedgerRef | undefined {
  if (!isRecord(value)) return undefined;
  const { id, declaration, name, marker, trait, form, via, location, text } = value;
  if (
    typeof id !== "string" ||
    typeof declaration !== "string" ||
    typeof name !== "string" ||
    typeof marker !== "string" ||
    typeof trait !== "string" ||
    !isForm(form) ||
    typeof text !== "string" ||
    (via !== undefined && !isVia(via)) ||
    !isRecord(location)
  ) {
    return undefined;
  }
  const { file, start, end } = location;
  if (typeof file !== "string" || typeof start !== "number" || typeof end !== "number") {
    return undefined;
  }
  return {
    id,
    declaration,
    name,
    marker,
    trait,
    form,
    ...(isVia(via) ? { via } : {}),
    location: { file, start, end },
    text,
  };
}

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

function parseRefs(value: Json): readonly LedgerRef[] | undefined {
  if (!isList(value)) return undefined;
  const found: LedgerRef[] = [];
  for (const item of value) {
    const one = parseRef(item);
    if (one === undefined) return undefined;
    found.push(one);
  }
  return found;
}

/**
 * The ledger of one file, read from its cache entry when it has it, else from the program (`read`
 * gives the file's queries and source, and is only called then). A reference to a declaration of
 * another file asks for that declaration (`declarationOf`), so the entry holds only while the
 * declaring file is as it was: its offsets are in the ledger. `stored` is true when this call added
 * it to `results`; a ledger of other traits is dropped then.
 */
export function fileLedger(
  results: Map<string, RuleResult>,
  key: string,
  read: () => { types: TypeQueries; sourceFile: ts.SourceFile } | undefined,
  proves: JoinedProves,
): { refs: readonly LedgerRef[]; stored: boolean } {
  const kept = results.get(key);
  if (kept !== undefined) {
    if (kept.summary === undefined) return { refs: [], stored: false };
    const parsed = parseRefs(summaryValue(kept.summary));
    if (parsed !== undefined) return { refs: parsed, stored: false };
  }
  const opened = read();
  const refs: LedgerRef[] = [];
  if (opened !== undefined && ledgerTraits(proves).length > 0) {
    const { types, sourceFile } = opened;
    const file = sourceFile.fileName;
    const asked = new Set<string>();
    const flows = proves.flows;
    const listsFlows =
      flows.produced.length > 0 || flows.decided.length > 0 || flows.escaped.length > 0;
    const found = [
      ...types.statedReferencesIn(sourceFile, proves),
      ...(listsFlows ? types.typedFlowsIn(sourceFile, proves) : []),
    ];
    for (const one of found) {
      const start = one.node.getStart(sourceFile);
      if (!one.declaration.startsWith(`${file}#`) && !asked.has(one.symbol.id)) {
        asked.add(one.symbol.id);
        types.declarationOf(one.symbol);
      }
      // A flow is named by its whole expression: one may start where a reference or another flow does.
      const flow = one.via !== undefined;
      refs.push({
        id: flow ? `${file}#${String(start)}-${String(one.node.end)}` : `${file}#${String(start)}`,
        declaration: one.declaration,
        name: one.name,
        marker: one.marker,
        trait: one.trait,
        form: one.form,
        ...(one.via === undefined ? {} : { via: one.via }),
        location: { file, start, end: one.node.end },
        text: one.text,
      });
    }
    refs.sort(
      (a, b) =>
        a.location.start - b.location.start ||
        a.location.end - b.location.end ||
        compareText(a.declaration, b.declaration) ||
        compareText(a.trait, b.trait) ||
        compareText(a.id, b.id),
    );
  }
  for (const other of results.keys()) {
    if (other.startsWith(LEDGER_PREFIX) && other !== key) results.delete(other);
  }
  results.set(
    key,
    refs.length === 0
      ? { findings: [] }
      : {
          findings: [],
          summary: summaryOf(
            refs.map((ref) => ({
              id: ref.id,
              declaration: ref.declaration,
              name: ref.name,
              marker: ref.marker,
              trait: ref.trait,
              form: ref.form,
              ...(ref.via === undefined ? {} : { via: ref.via }),
              location: { ...ref.location },
              text: ref.text,
            })),
          ),
        },
  );
  return { refs, stored: true };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whether a cache entry's key is a ledger's, not a rule's result. */
export function isLedgerKey(key: string): boolean {
  return key.startsWith(LEDGER_PREFIX);
}

/** A rule's marks with its id, for the run's ledger. */
export function withRule(ruleId: string, marks: readonly RuleMark[]): LedgerMark[] {
  return marks.map((mark) => ({ ruleId, ...mark }));
}

/** What a reference does, after its code: "(another name for it)". */
const FORM_WORDS: Readonly<Record<ReferenceForm, string>> = {
  call: "a call",
  read: "a read",
  write: "a write",
  alias: "another name for it",
  import: "an import",
  export: "an export",
  argument: "given as an argument",
  stored: "stored in an object or array literal",
  returned: "returned",
  "jsx-tag": "a JSX tag",
  "jsx-attribute": "a JSX attribute",
  type: "a type",
  computed: "a computed key",
  other: "a use",
  tag: "the tag on its declaration",
  produced: "a value of the type made here",
  decided: "a decision by a value of the type",
  escaped: "a write to an object that holds it",
};

/** Where the reader finds the ways a guarantee's rule reads: its page, when a rule proves it. */
function shownBy(ruleId: string): string {
  return ruleId === STATED_RULE_ID
    ? "write it the way its pack's page shows"
    : `write it the way \`stateward explain ${ruleId}\` shows`;
}

/** Why a place past where the file's scan stopped is not checked: the uses after it are not read. */
export function stoppedReason(ref: LedgerRef): string {
  return `the file is too large to read past \`${ref.text}\`, so the uses of \`${ref.name}\` after it are not checked: split the file`;
}

/**
 * "`w = watchPrices` (another name for it) is a use of `watchPrices` that stateward does not read
 * for `Release`: write it the way `stateward explain ownership/resource-not-released` shows".
 */
export function unreadReason(ref: LedgerRef, ruleId: string): string {
  return `\`${ref.text}\` (${FORM_WORDS[ref.form]}) is a use of \`${ref.name}\` that stateward does not read for \`${ref.marker}\`: ${shownBy(ruleId)}`;
}

const RANK: Readonly<Record<ReadOutcome["kind"], number>> = {
  irrelevant: 0,
  decided: 1,
  "handed-on": 2,
  unchecked: 3,
};

/**
 * One rule's word on a reference from all its marks: a place it cannot follow wins; a reference
 * its project side settled is read, whatever the file side handed on.
 */
function settled(marks: readonly LedgerMark[]): ReadOutcome | undefined {
  const unchecked = marks
    .map((mark) => mark.outcome)
    .filter((outcome) => outcome.kind === "unchecked")
    .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  if (unchecked[0] !== undefined) return unchecked[0];
  const read = marks.find(
    (mark) => mark.outcome.kind === "decided" || mark.outcome.kind === "irrelevant",
  );
  if (read !== undefined) return read.outcome;
  return [...marks].sort((a, b) => RANK[b.outcome.kind] - RANK[a.outcome.kind])[0]?.outcome;
}

/** The ledger as a proof reads it: the references of each declaration, and the marks on each. */
export type LedgerIndex = {
  readonly traits: ReadonlySet<string>;
  refsOf(declaration: string, trait: string): readonly LedgerRef[];
  /** The places of a guarantee's references that its rule did not read. */
  uncheckedOf(guarantee: StatedGuarantee, refs: readonly LedgerRef[]): readonly UncheckedPlace[];
};

export function indexLedger(ledger: {
  readonly traits: readonly string[];
  readonly refs: readonly LedgerRef[];
  readonly marks: readonly LedgerMark[];
}): LedgerIndex {
  const byDeclaration = new Map<string, LedgerRef[]>();
  for (const ref of ledger.refs) {
    const key = `${ref.declaration}\u0000${ref.trait}`;
    const list = byDeclaration.get(key) ?? [];
    list.push(ref);
    byDeclaration.set(key, list);
  }
  const marksOf = new Map<string, LedgerMark[]>();
  for (const mark of ledger.marks) {
    const key = `${mark.ruleId}\u0000${mark.ref}\u0000${mark.trait}`;
    const list = marksOf.get(key) ?? [];
    list.push(mark);
    marksOf.set(key, list);
  }
  return {
    traits: new Set(ledger.traits),
    refsOf: (declaration, trait) => byDeclaration.get(`${declaration}\u0000${trait}`) ?? [],
    uncheckedOf(guarantee, refs) {
      const places: UncheckedPlace[] = [];
      for (const ref of refs) {
        const outcome = settled(
          marksOf.get(`${guarantee.ruleId}\u0000${ref.id}\u0000${ref.trait}`) ?? [],
        );
        // Past the flow scan's budget nothing after this place is listed: no mark makes it read.
        const reason =
          ref.via === "stopped"
            ? stoppedReason(ref)
            : outcome === undefined
              ? unreadReason(ref, guarantee.ruleId)
              : outcome.kind === "unchecked"
                ? outcome.reason
                : outcome.kind === "handed-on"
                  ? `\`${ref.text}\` is passed to ${outcome.to}, which stateward does not check for \`${ref.marker}\`: ${shownBy(guarantee.ruleId)}`
                  : undefined;
        if (reason !== undefined) places.push({ location: ref.location, reason });
      }
      return places;
    },
  };
}

/** The forms that run nothing: a declaration only they name is unused. */
function runsNothing(ref: LedgerRef): boolean {
  return ref.form === "import" || ref.form === "export" || ref.form === "type";
}

/**
 * The guarantee a JSDoc tag states (`RuleProves.tags`), proven by `ruleId`: its places are the
 * tag itself (the declaration's body) and every reference that runs something.
 */
function tagGuarantee(
  first: LedgerRef,
  refs: readonly LedgerRef[],
  location: Location,
  ruleId: string,
): StatedGuarantee {
  const tag = first.trait.slice(1);
  return {
    guarantee: first.trait,
    source: { kind: "tag", tag },
    marker: first.marker,
    name: first.name,
    declaration: first.declaration,
    location,
    ruleId,
    promise: `\`${first.name}\` keeps what \`@${tag}\` states, in its own code and at every use`,
    covers: { one: "place", many: "places" },
    covered: refs
      .filter(
        (ref) =>
          ref.declaration === first.declaration && ref.trait === first.trait && !runsNothing(ref),
      )
      .map((ref) => ({ name: `\`${ref.text}\``, location: ref.location })),
  };
}

/**
 * A guarantee for each declaration the ledger has references to and no plugin or core scan lists
 * (by its id and trait): it reads "not checked" (never "unused", never "proven") until a rule lists
 * it. A tag trait's declaration is listed for the rule that proves the tag (`tagRules`).
 */
export function ledgerGuarantees(
  refs: readonly LedgerRef[],
  listed: readonly StatedGuarantee[],
  tagRules: Readonly<Record<string, string>> = {},
): StatedGuarantee[] {
  const known = new Set(listed.map((one) => `${one.declaration}\u0000${one.guarantee}`));
  const found: StatedGuarantee[] = [];
  for (const ref of refs) {
    const key = `${ref.declaration}\u0000${ref.trait}`;
    if (known.has(key)) continue;
    known.add(key);
    const at = ref.declaration.lastIndexOf("#");
    const start = Number(ref.declaration.slice(at + 1));
    const location = { file: ref.declaration.slice(0, at), start, end: start };
    // Core lists a declaration it found by its written type from where it starts: a property
    // with a modifier (`static x: Owned<…>`) is listed there, and the ledger names it at its name.
    const scanned = listed.some(
      (one) =>
        one.ruleId === STATED_RULE_ID &&
        one.guarantee === ref.trait &&
        one.location.file === location.file &&
        one.location.start <= start &&
        start <= one.location.end,
    );
    if (scanned) continue;
    const prover = tagRules[ref.trait];
    if (prover !== undefined) {
      found.push(tagGuarantee(ref, refs, location, prover));
      continue;
    }
    found.push({
      guarantee: ref.trait,
      source: { kind: "marker" },
      marker: ref.marker,
      name: ref.name,
      declaration: ref.declaration,
      location,
      ruleId: STATED_RULE_ID,
      promise: "nothing yet: no rule proves it",
      covers: { one: "place", many: "places" },
      covered: [],
      unchecked: [{ location, reason: noRuleChecks(ref.marker) }],
    });
  }
  return found;
}
