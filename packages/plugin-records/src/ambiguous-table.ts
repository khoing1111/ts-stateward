import {
  defineRule,
  type RelatedLocation,
  matchesName,
  option,
  type Fix,
  type FixForm,
  type Location,
  type TextEdit,
} from "@stateward/core";
import { fitted, keysNote, MAX_HINT, shorten } from "./text.js";
import {
  summarizeFile,
  type Candidate,
  type FileSummary,
  type KeyType,
  type UseSummary,
} from "./summary.js";

const EXPLAIN = `# records/ambiguous-table

A table typed \`Record<string, V>\` does not say whether its keys are fixed or come from outside, so a misspelt or missing key compiles and the read gives \`undefined\`.

\`\`\`ts example-bad
const labels: Record<string, string> = { idle: "Idle", done: "Done" };

export function label(status: string): string {
  return labels[status];
}
\`\`\`

Say which table it is. A fixed table read with a key type declared apart from it:

\`\`\`ts example-good
type Status = "idle" | "done";

const labels = { idle: "Idle", done: "Done" } as const satisfies Record<Status, string>;

export function label(status: Status): string {
  return labels[status];
}
\`\`\`

Or an open dictionary, whose type says a lookup can find nothing: \`const labels: Partial<Record<string, string>> = { … }\`, read as \`labels[key] ?? key\`.

## Why it matters

If the table is fixed, the type still accepts any string, so \`labels[status]\` compiles with a misspelt or missing key and the page shows "undefined". If its keys come from outside, the type must say that a lookup can find nothing, so each read handles it. TypeScript has a spelling for each, and checks the reads once one is chosen.

## What it does not catch

It reports only a variable built from an object literal typed \`Record<string, V>\` (or \`{ [key: string]: V }\`), or a \`new Map\` of literal pairs, that the code reads and never changes or hands on. It does not report:

- a table whose type states its intent (the spellings above);
- a table that is changed, may be changed, spread or copied (\`{ ...views, extra }\`, \`Object.assign\`), or handed on where stateward cannot follow it;
- a table where every read with a wider key handles a missing entry (\`labels[key] ?? key\`, \`if (key in labels)\`, \`Object.hasOwn(labels, key)\`): an open dictionary used correctly;
- a table exported to code outside the checked files, a table never read, tables from packages, and names listed in \`ignore\`.

## Getting the best from it

The suggestion follows what the code shows:

| The code | The fix line suggests |
| --- | --- |
| reads use a key type declared apart from the table (\`status: Status\`) | \`as const satisfies Record<Status, V>\`, with a note where \`Status\` is declared |
| every read with that type has a fallback (\`labels[status] ?? "Other"\`) | \`as const satisfies Partial<Record<Status, V>>\` |
| no declared key type: the object defines the keys | \`as const\` alone |
| some read uses a wider key (a \`string\`) and does not handle a miss | \`Partial<Record<string, V>>\`, a \`Map\`, \`Object.create(null)\` (no inherited keys such as \`"toString"\`), or \`isKeyOf\` before reading |
| reads look keys up again from \`Object.keys(labels)\` | \`Object.entries(labels)\` |

A type derived from the object (\`keyof typeof labels\`) never gets the \`satisfies\` suggestion: there is no separate union to check against. The editor offers a quick fix for the fixed table ("Use satisfies: the keys are fixed", or "Use as const: the object defines the keys") when every read uses a key the table has, and "Use Partial<Record<string, …>>: keys come from outside" for a table no other file reads. Each is offered only when the code still compiles after it.

## Turn it on or off

\`\`\`ts
rules: { "records/ambiguous-table": "off" } // or "warning"
rules: { "records/ambiguous-table": ["error", { ignore: ["*_MESSAGES"] }] } // keep some names open
\`\`\`

This rule was called \`records/table-type-too-loose\` before 1.2; the old id still works, with a warning.
`;

/** A use with nothing in the project that adds, changes, removes or passes on a key. */
function keepsKeysFixed(use: UseSummary | undefined): boolean {
  return use === undefined || (!use.writes && !use.escapes);
}

/** The files whose whole namespace is passed on somewhere, and the files they re-export from. */
function exposedFiles(summaries: ReadonlyMap<string, FileSummary>): Set<string> {
  const exposed = new Set<string>();
  const pending = [...summaries.values()].flatMap((summary) => summary.moduleEscapes);
  for (const file of pending) {
    if (exposed.has(file)) continue;
    exposed.add(file);
    pending.push(...(summaries.get(file)?.reexports ?? []));
  }
  return exposed;
}

/** What the whole project does with each fixed-key variable, summed over every file. */
type Project = {
  uses: ReadonlyMap<string, UseSummary>;
  exposed: ReadonlySet<string>;
  /** `file` -> names written as `{ name }`, which stateward cannot resolve to a variable. */
  shorthand: ReadonlyMap<string, ReadonlySet<string>>;
  aliases: ReadonlyMap<string, readonly { file: string; name: string }[]>;
  foreign: ReadonlySet<string>;
};

function projectOf(summaries: ReadonlyMap<string, FileSummary>): Project {
  const uses = new Map<string, UseSummary>();
  const shorthand = new Map<string, ReadonlySet<string>>();
  const aliases = new Map<string, { file: string; name: string }[]>();
  const foreign = new Set<string>();
  for (const [file, summary] of summaries) {
    shorthand.set(file, new Set(summary.shorthand));
    for (const name of summary.foreign) foreign.add(name);
    for (const alias of summary.aliases) {
      aliases.set(alias.id, [...(aliases.get(alias.id) ?? []), { file, name: alias.name }]);
    }
    for (const use of summary.uses) {
      const sum = uses.get(use.id);
      uses.set(use.id, {
        id: use.id,
        writes: (sum?.writes ?? false) || use.writes,
        escapes: (sum?.escapes ?? false) || use.escapes,
        unknownKey: (sum?.unknownKey ?? false) || use.unknownKey,
        selfKeyed: (sum?.selfKeyed ?? false) || use.selfKeyed,
        keys: [...new Set([...(sum?.keys ?? []), ...use.keys])],
        handledWide: (sum?.handledWide ?? false) || use.handledWide,
        unhandledWide: (sum?.unhandledWide ?? false) || use.unhandledWide,
        keyTypes: mergedKeyTypes(sum?.keyTypes ?? [], use.keyTypes),
      });
    }
  }
  return { uses, exposed: exposedFiles(summaries), shorthand, aliases, foreign };
}

/** Whether `{ name }` appears where the variable is visible under `name`, so it may escape there. */
function isShorthandEscape(candidate: Candidate, file: string, project: Project): boolean {
  if (project.shorthand.get(file)?.has(candidate.name) === true) return true;
  return (project.aliases.get(candidate.id) ?? []).some(
    (alias) => project.shorthand.get(alias.file)?.has(alias.name) === true,
  );
}

function isFixedEverywhere(candidate: Candidate, file: string, project: Project): boolean {
  return (
    keepsKeysFixed(project.uses.get(candidate.id)) &&
    !project.exposed.has(file) &&
    !project.foreign.has(candidate.name) &&
    !isShorthandEscape(candidate, file, project)
  );
}

/**
 * A record or Map looked up with a key wider than its own (a `string` from an event, a URL, a router)
 * where every such lookup handles a missing entry: an open dictionary used correctly. Typing its
 * keys would turn those lookups into type errors, so the advice would be wrong (a decision of 2026-11-02, after a false-positive sweep).
 */
function isHandledDictionary(candidate: Candidate, use: UseSummary | undefined): boolean {
  return use !== undefined && use.handledWide && !use.unhandledWide;
}

/** The fix keeps the code compiling only when every read uses a key the object has. */
function canFix(candidate: Candidate, use: UseSummary | undefined): boolean {
  if (candidate.fix === null) return false;
  if (use === undefined) return true;
  // A key from `Object.keys` is a `string`: with `satisfies`, `record[key]` would stop compiling.
  return !use.unknownKey && !use.selfKeyed && use.keys.every((key) => candidate.keys.includes(key));
}

/** Each named key type once: a fallback only when every read has one, a declaration when one read names it. */
function mergedKeyTypes(known: readonly KeyType[], added: readonly KeyType[]): KeyType[] {
  const merged = known.map((type) => ({ ...type }));
  for (const type of added) {
    const same = merged.find((one) => one.name === type.name && one.file === type.file);
    if (same === undefined) merged.push({ ...type });
    else {
      same.fallback &&= type.fallback;
      same.declaredAt ??= type.declaredAt;
    }
  }
  return merged.sort(byNameAndFile);
}

function byNameAndFile(a: KeyType, b: KeyType): number {
  return a.name < b.name
    ? -1
    : a.name > b.name
      ? 1
      : a.file < b.file
        ? -1
        : a.file > b.file
          ? 1
          : 0;
}

/**
 * The type the fixed table is checked against: the named union its reads look it up with (the
 * domain type, `TouchpointStatus`), with its import when the table's file has none; else a union
 * in scope with exactly its keys; else none.
 */
type KeysName = { text: string; imports: string | undefined };

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

/** The named union the table is read with, whose members are exactly its keys. */
function domainOf(candidate: Candidate, use: UseSummary | undefined): KeyType | undefined {
  return (use?.keyTypes ?? []).find((type) => sameKeys(type.keys, candidate.keys));
}

/**
 * A named union the table is read with, that has every key of the table and more, where every
 * read with it has a fallback: a table partial on purpose.
 */
function partialDomainOf(candidate: Candidate, use: UseSummary | undefined): KeyType | undefined {
  return (use?.keyTypes ?? []).find(
    (type) =>
      type.fallback &&
      !sameKeys(type.keys, candidate.keys) &&
      candidate.keys.every((key) => type.keys.includes(key)),
  );
}

function keysName(candidate: Candidate, use: UseSummary | undefined): KeysName | undefined {
  const domain = domainOf(candidate, use);
  if (domain !== undefined) {
    const local = candidate.keyTypes.find(
      (type) => type.declared === domain.name && type.file === domain.file,
    );
    if (local !== undefined) return { text: local.name, imports: undefined };
    return {
      text: domain.name,
      imports:
        domain.specifier === null
          ? undefined
          : `import type { ${domain.name} } from "${domain.specifier}";`,
    };
  }
  return undefined;
}

/** The edit that adds the import of the keys' type, on its own line where imports go. */
function importEdit(candidate: Candidate, file: string, imports: string): TextEdit {
  const at = candidate.importAt;
  return {
    location: { file, start: at, end: at },
    newText: at === 0 ? `${imports}\n` : `\n${imports}`,
  };
}

/** `Partial<Record<string, V>>` for the open-dictionary spelling. */
function openType(candidate: Candidate): string {
  return `Partial<Record<${candidate.keyKind}, ${candidate.valueText}>>`;
}

/** The annotation is written as `Record<…, V>` or `{ [key: …]: V }`, so its `V` is known. */
function isPlainForm(candidate: Candidate): boolean {
  return /^(?:Record<|\{ ?\[)/.test(candidate.typeText);
}

const FIXED_TITLE = "Use satisfies: the keys are fixed";
/** With no type naming the keys, the object defines them: `as const` says the keys are fixed. */
const AS_CONST_TITLE = "Use as const: the object defines the keys";
/** `as const` does not compile there: the keys as written, checked by `satisfies`. */
const AS_WRITTEN_TITLE = "Use satisfies with the keys as written: the keys are fixed";

/**
 * The two fixes, one per intent. Each changes the table's type, so core offers it only when
 * the file still compiles after it; the open dictionary only for a table no other file can read.
 */
function fixesOf(
  candidate: Candidate,
  file: string,
  use: UseSummary | undefined,
  satisfiable: boolean,
): Fix[] {
  const { fix } = candidate;
  if (fix === null) return [];
  const at = (start: number, end: number): Location => ({ file, start, end });
  const fixes: Fix[] = [];
  if (satisfiable) {
    const named = keysName(candidate, use);
    const form = (title: string, spelling: string): FixForm => ({
      title,
      changesType: true,
      edits: [
        ...(named?.imports === undefined ? [] : [importEdit(candidate, file, named.imports)]),
        { location: at(fix.removeStart, fix.removeEnd), newText: "" },
        { location: at(fix.insertAt, fix.insertAt), newText: spelling },
      ],
    });
    // `as const` makes the values readonly (`readonly ["a"]`): where the code needs them
    // writable, the form without it is the one that compiles.
    fixes.push(
      named === undefined
        ? {
            ...form(AS_CONST_TITLE, " as const"),
            alternatives: [
              form(
                AS_WRITTEN_TITLE,
                ` satisfies Record<${candidate.labels.join(" | ")}, ${candidate.valueText}>`,
              ),
            ],
          }
        : {
            ...form(
              FIXED_TITLE,
              ` as const satisfies Record<${named.text}, ${candidate.valueText}>`,
            ),
            alternatives: [
              form(FIXED_TITLE, ` satisfies Record<${named.text}, ${candidate.valueText}>`),
            ],
          },
    );
  }
  // Core checks the files a fix edits; an exported table is read in files it does not check.
  if (candidate.declares.startsWith("export ")) return fixes;
  fixes.push({
    title: `Use Partial<Record<${candidate.keyKind}, …>>: keys come from outside`,
    changesType: true,
    edits: [
      {
        location: at(fix.typeStart, fix.removeEnd),
        newText: isPlainForm(candidate) ? openType(candidate) : `Partial<${candidate.typeText}>`,
      },
    ],
  });
  return fixes;
}

/**
 * Some read uses a key whose type is not within the record's literal keys (a \`string\`, a union
 * with a member the record lacks, a literal it does not have). \`satisfies\` would make that read
 * fail to compile (TS7053), so the fixed-table fix is not offered and the hint starts with the
 * open dictionary.
 */
function readsWithWiderKey(candidate: Candidate, use: UseSummary | undefined): boolean {
  return (
    use !== undefined && (use.unknownKey || use.keys.some((key) => !candidate.keys.includes(key)))
  );
}

/**
 * What the developer should do first for a fixed table: \`satisfies\` (the quick fix); type the
 * keys they look up, when some read uses a wider key; or read the record with \`Object.entries\`,
 * when the only reads that block \`satisfies\` look a key up again that came from \`Object.keys\`.
 */
type Advice = "satisfies" | "type-the-keys" | "use-entries";

function adviceFor(candidate: Candidate, use: UseSummary | undefined): Advice {
  if (readsWithWiderKey(candidate, use)) return "type-the-keys";
  return use?.selfKeyed === true ? "use-entries" : "satisfies";
}

/**
 * The headline says the same everywhere: the type takes any key, so a misspelt or missing key
 * still compiles. Names are never cut, so a long name makes the line longer.
 */
function headlineOf(candidate: Candidate): string {
  return fitted(
    (cut) =>
      `\`${cut(candidate.name)}\` accepts any ${candidate.keyKind} key, so a misspelt or missing key still compiles`,
  );
}

/**
 * The spelling the hint gives a fixed table: `satisfies` only for a table read with a separately
 * declared key type (`Status`), whose members are its keys or, for reads that all have a fallback,
 * more than its keys (`Partial<Record<Status, V>>`); otherwise the object defines its keys, and
 * `as const` alone says so.
 */
type Fixed =
  { kind: "satisfies"; type: KeyType } | { kind: "partial"; type: KeyType } | { kind: "as-const" };

function fixedOf(candidate: Candidate, use: UseSummary | undefined): Fixed {
  const domain = domainOf(candidate, use);
  if (domain !== undefined) return { kind: "satisfies", type: domain };
  const partial = partialDomainOf(candidate, use);
  return partial === undefined ? { kind: "as-const" } : { kind: "partial", type: partial };
}

/**
 * The hint as M22 lists it: `one of`, then a line per way to fix. Its parts are cut in turn while
 * a line is longer than a fix line may be: the key type, the value (never the name).
 */
function hintOf(candidate: Candidate, advice: Advice, fixed: Fixed): string {
  const keysText = fixed.kind === "as-const" ? "" : keyTypeName(candidate, fixed.type);
  const build = (keys: string, name: string, value: string): string => {
    const open = `\`Partial<Record<${candidate.keyKind}, ${value}>>\``;
    const fixedShort =
      fixed.kind === "satisfies"
        ? `declare \`${name}\` with \`as const satisfies Record<${keys}, ${value}>\``
        : fixed.kind === "partial"
          ? `declare \`${name}\` with \`as const satisfies Partial<Record<${keys}, ${value}>>\``
          : "remove the type and add `as const`";
    const fixedWay =
      fixed.kind === "satisfies"
        ? `${fixedShort}, so a missing key fails to compile`
        : fixed.kind === "partial"
          ? `${fixedShort}: its reads with \`${keys}\` have a fallback`
          : `${fixedShort}: the object then defines its keys`;
    // Reads with the declared type all have a fallback: the partial table is the fix, whatever
    // else the reads do.
    const effective = fixed.kind === "partial" ? "satisfies" : advice;
    const lines = ((): string[] => {
      switch (effective) {
        case "satisfies":
          return [fixedWay, `or type it ${open} for keys from outside`];
        case "type-the-keys":
          return [
            `type it ${open}, so each read handles a missing key`,
            "or use a `Map`, whose `get` returns `undefined` for a missing key",
            "or build it with `Object.create(null)`, so it has no inherited keys such as `toString`",
            `or check the key with \`isKeyOf(${name}, key)\` before reading`,
            `or, for fixed keys, look keys up as \`${fixed.kind === "as-const" ? `keyof typeof ${name}` : keys}\`, then ${fixedShort}`,
          ];
        case "use-entries":
          return [
            `read \`Object.entries(${name})\` instead of looking keys up again, then ${fixedShort}`,
            `or type it ${open} for keys from outside`,
          ];
        default: {
          const unreachable: never = effective;
          return unreachable;
        }
      }
    })();
    return ["one of", ...lines.map((line) => `- ${line}`)].join("\n");
  };
  const cuts = { keys: keysText, name: candidate.name, value: candidate.valueText };
  const text = (): string => build(cuts.keys, cuts.name, cuts.value);
  const longest = (): number =>
    Math.max(
      ...text()
        .split("\n")
        .map((line) => line.length),
    );
  for (const part of ["keys", "value"] as const) {
    const whole = cuts[part];
    for (let limit = whole.length - 1; longest() > MAX_HINT && limit >= MIN_PART; limit -= 1) {
      cuts[part] = shorten(whole, limit);
    }
  }
  return text();
}

/** The key type by the name the table's file can use: its local name, else the declared name. */
function keyTypeName(candidate: Candidate, type: KeyType): string {
  const local = candidate.keyTypes.find(
    (known) => known.declared === type.name && known.file === type.file,
  );
  return local?.name ?? type.name;
}

/** The note at the declared key type the hint names. */
function keyTypeNote(candidate: Candidate, fixed: Fixed): RelatedLocation[] {
  if (fixed.kind === "as-const" || fixed.type.declaredAt === null) return [];
  return [
    {
      location: fixed.type.declaredAt,
      message: `\`${candidate.name}\` is read with \`${fixed.type.name}\` keys, declared here`,
    },
  ];
}

/** A part of a hint is never cut below this. */
const MIN_PART = 8;

function recordMessage(
  candidate: Candidate,
  advice: Advice,
  fixed: Fixed,
): { message: string; hint: string } {
  return { message: headlineOf(candidate), hint: hintOf(candidate, advice, fixed) };
}

function mapMessage(candidate: Candidate): { message: string; hint: string } {
  return {
    message: `\`${shorten(candidate.name)}\` is a Map whose keys are fixed and never change`,
    hint: "use an object `{ … } satisfies Record<…>`, so a missing key fails to compile",
  };
}

export const ambiguousTable = defineRule({
  kind: "project",
  meta: {
    description:
      "A table typed `Record<string, V>` does not say whether its keys are fixed or come from outside, so a misspelt or missing key compiles and the read gives `undefined`.",
    summary:
      'a lookup table typed `Record<string, V>` that says neither "all keys" nor "keys from outside"',
    defaultSeverity: "error",
    tier: "core",
    group: "keys",
    fixNeedsStrictNulls: true,
    options: {
      ignore: option.strings({
        default: [],
        description:
          "Variable names (globs like *_MESSAGES) that may stay typed as open-ended records.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: summarizeFile,
  check(summaries, ctx) {
    const project = projectOf(summaries);
    for (const [file, summary] of summaries) {
      for (const candidate of summary.candidates) {
        if (matchesName(candidate.name, ctx.options.ignore)) continue;
        if (!isFixedEverywhere(candidate, file, project)) continue;
        const use = project.uses.get(candidate.id);
        if (isHandledDictionary(candidate, use)) continue;
        const fixes =
          candidate.kind === "record" ? fixesOf(candidate, file, use, canFix(candidate, use)) : [];
        const fixed = fixedOf(candidate, use);
        const { message, hint } =
          candidate.kind === "record"
            ? recordMessage(candidate, adviceFor(candidate, use), fixed)
            : mapMessage(candidate);
        ctx.report({
          message,
          hint,
          location: { file, start: candidate.start, end: candidate.end },
          related: [
            {
              location: { file, start: candidate.literal.start, end: candidate.literal.end },
              message: keysNote(candidate.labels),
            },
            ...(candidate.kind === "record" ? keyTypeNote(candidate, fixed) : []),
          ],
          fixes,
        });
      }
    }
  },
});
