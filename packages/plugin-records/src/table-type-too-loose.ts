import {
  defineRule,
  matchesName,
  option,
  type Fix,
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

const EXPLAIN = `# records/table-type-too-loose

A lookup table typed \`Record<string, V>\` says neither "these are all the keys" nor "keys come from outside"; say which in its type.

## Why

\`const labels: Record<string, string> = { idle: "Idle", done: "Done" }\` could mean two things. If it is a fixed table, every key is known, but the type accepts any string: \`labels[status]\` compiles with a misspelt or missing key and the page shows "undefined". If it is an open dictionary whose keys come from outside, the type should say that a lookup can find nothing, so each read handles it. TypeScript has a spelling for each; the rule asks you to pick one and then trusts it.

## When to use it

Write the table's intent in its type. Each of these is silent:

| You mean | Write |
| --- | --- |
| a fixed table, every key present | \`const labels = { … } satisfies Record<Status, string>\` |
| a fixed set of keys, some left out on purpose | \`const labels: Partial<Record<Status, string>> = { … }\` |
| an open dictionary, keys from outside | \`const labels: Partial<Record<string, string>> = { … }\` (or \`{ [key: string]: string \\| undefined }\`) |
| a fixed table read with a key from outside | \`satisfies Record<Status, string>\`, and test the key first: \`key in labels\`, \`Object.hasOwn(labels, key)\` or a guard \`isStatus(key)\` |

It is on as an error in every preset. It reports a table only when it can see that nothing in your code changes it or hands it on.

## What it catches

A variable built from an object literal typed \`Record<string, V>\` (or \`{ [key: string]: V }\`), or a \`new Map\` of literal pairs, that your code reads and never adds to, changes, deletes from or hands on.

### Bad

\`\`\`ts
const labels: Record<string, string> = { idle: "Idle", done: "Done", failed: "Failed" };
const text = labels[status]; // a fixed table or an open dictionary? Any string is accepted.
\`\`\`

### Good

\`\`\`ts
type Status = "idle" | "done" | "failed";
const labels = { idle: "Idle", done: "Done", failed: "Failed" } satisfies Record<Status, string>;
const text = labels[status]; // \`status\` must be a Status; a missing label fails to compile
\`\`\`

or, when the keys come from outside:

\`\`\`ts
const labels: Partial<Record<string, string>> = { idle: "Idle", done: "Done" };
const text = labels[key] ?? key; // the type says a lookup can find nothing
\`\`\`

### Fix

Two quick fixes, one per intent: "It is a fixed table: use satisfies" moves the type behind the table as \`satisfies Record<Status, string>\`, where \`Status\` is the type the reads look the table up with (\`labels[touchpointStatus()]\` gives \`TouchpointStatus\`, imported when the file does not import it yet), or a union type in scope with exactly the table's keys. With no such type the keys are written out (\`Record<"idle" | "done", string>\`), and the fix says so: it checks only the keys written there, not the ones your code needs. "It is an open dictionary" types it \`Partial<Record<string, string>>\`. Each is offered only when the code still compiles after it; an import a fix leaves unused is removed with it.

When some read uses a wider key (\`pageTitles[pathname]\` with a \`string\` from the router) and does not handle a missing entry, the message leads with the open dictionary; a fixed table needs the key typed first (\`keyof typeof pageTitles\`). When the keys come from \`Object.keys(labels)\`, read key and value together with \`Object.entries(labels)\`. For a \`Map\`, use an object with \`satisfies\` instead; there is no quick fix.

## What it does not catch

- A table that states its intent in its type (the four spellings above).
- A table that is changed, or may be: written from another file, passed to a function that could change it, spread or copied into another object (\`{ ...views, extra }\`, \`Object.assign\`), or handed on somewhere stateward cannot follow.
- A table where every read with a wider key handles a missing entry (\`roleLabels[role] ?? role\`, \`labels[key]?.trim()\`, \`if (key in labels)\`, \`Object.hasOwn(labels, key)\`, or \`if (!label)\` after the read): an open dictionary used correctly. The same holds for a \`Map\` (\`reasons.get(reason) ?? reason\`, \`if (shortcuts.has(key))\`).
- A table exported to code outside the checked files, a table never read, tables from packages, and names listed in \`ignore\`.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "records/table-type-too-loose": "off" } // or "warning"
groups: { "states/records": "off" } // the whole group
rules: { "records/table-type-too-loose": ["error", { ignore: ["*_MESSAGES"] }] } // keep some names open
\`\`\`
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
        keyTypes: [
          ...(sum?.keyTypes ?? []),
          ...use.keyTypes.filter(
            (type) =>
              !(sum?.keyTypes ?? []).some(
                (known) => known.name === type.name && known.file === type.file,
              ),
          ),
        ].sort(byNameAndFile),
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

function keysName(candidate: Candidate, use: UseSummary | undefined): KeysName | undefined {
  const domain = (use?.keyTypes ?? []).find((type) => sameKeys(type.keys, candidate.keys));
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
  return candidate.keysType === null ? undefined : { text: candidate.keysType, imports: undefined };
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

const FIXED_TITLE = "It is a fixed table: use satisfies";
/** With no type naming the keys, `satisfies` checks the keys as written, not the ones the code needs. */
const FIXED_AS_WRITTEN_TITLE =
  "It is a fixed table: use satisfies (fixes only the keys written here)";

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
    const keys = named?.text ?? candidate.labels.join(" | ");
    fixes.push({
      title: named === undefined ? FIXED_AS_WRITTEN_TITLE : FIXED_TITLE,
      changesType: true,
      edits: [
        ...(named?.imports === undefined ? [] : [importEdit(candidate, file, named.imports)]),
        { location: at(fix.removeStart, fix.removeEnd), newText: "" },
        {
          location: at(fix.insertAt, fix.insertAt),
          newText: ` satisfies Record<${keys}, ${candidate.valueText}>`,
        },
      ],
    });
  }
  // Core checks the files a fix edits; an exported table is read in files it does not check.
  if (candidate.declares.startsWith("export ")) return fixes;
  fixes.push({
    title: `It is an open dictionary: Partial<Record<${candidate.keyKind}, …>>`,
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
 * The headline asks one way everywhere: is the annotation a fixed table or an open
 * dictionary? Names are never cut, so a long name makes the line longer.
 */
function headlineOf(candidate: Candidate): string {
  return fitted(
    (cut) =>
      `\`${cut(candidate.name)}\` is typed \`${cut(candidate.typeText)}\`: a fixed table or an open dictionary?`,
  );
}

/** The hint, its parts cut in turn while it is longer than a hint may be: the keys, the value (never the name). */
function hintOf(candidate: Candidate, advice: Advice): string {
  const keysText = candidate.keysType ?? candidate.labels.join(" | ");
  const build = (keys: string, name: string, value: string): string => {
    const fixed = `\`satisfies Record<${keys}, ${value}>\``;
    const open = `keys from outside: \`Partial<Record<${candidate.keyKind}, ${value}>>\``;
    switch (advice) {
      case "satisfies":
        return `every key known: ${fixed}; ${open}`;
      case "type-the-keys":
        return `${open}; every key known: look keys up as \`${candidate.keysType ?? `keyof typeof ${name}`}\`, then use \`satisfies\``;
      case "use-entries":
        return `every key known: read \`Object.entries(${name})\`, then use \`satisfies\`; ${open}`;
      default: {
        const unreachable: never = advice;
        return unreachable;
      }
    }
  };
  const cuts = { keys: keysText, name: candidate.name, value: candidate.valueText };
  const text = (): string => build(cuts.keys, cuts.name, cuts.value);
  for (const part of ["keys", "value"] as const) {
    const whole = cuts[part];
    for (let limit = whole.length - 1; text().length > MAX_HINT && limit >= MIN_PART; limit -= 1) {
      cuts[part] = shorten(whole, limit);
    }
  }
  return text();
}

/** A part of a hint is never cut below this. */
const MIN_PART = 8;

function recordMessage(candidate: Candidate, advice: Advice): { message: string; hint: string } {
  return { message: headlineOf(candidate), hint: hintOf(candidate, advice) };
}

function mapMessage(candidate: Candidate): { message: string; hint: string } {
  return {
    message: `\`${shorten(candidate.name)}\` is a Map with a fixed set of keys that is never changed`,
    hint: "use an object `{ … } satisfies Record<…>`, so a missing key fails to compile",
  };
}

export const tableTypeTooLoose = defineRule({
  kind: "project",
  meta: {
    description:
      'A lookup table typed `Record<string, V>` says neither "these are all the keys" nor "keys come from outside"; say which in its type.',
    defaultSeverity: "error",
    tier: "core",
    group: "keys",
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
        const { message, hint } =
          candidate.kind === "record"
            ? recordMessage(candidate, adviceFor(candidate, use))
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
          ],
          fixes,
        });
      }
    }
  },
});
