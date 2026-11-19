import path from "node:path";
import { defineRule, matchesName, option } from "@stateward/core";
import type { Fix, ProjectContext, RelatedLocation } from "@stateward/core";
import { fitted, KEPT_FIX, matchesGlob, shorten } from "./text.js";
import { summarizeFile, type Write } from "./summary.js";
import { changedParams, keyOf, type Witness } from "./params.js";
import type { DeclareFix } from "./declare-owned.js";
import type { OwnedChange, OwnerFunction, Place } from "./owned.js";

const EXPLAIN = `# ownership/state-written-outside-owner

When several modules change the same module-level state, each change must be read to know its value; one owning module with functions keeps that in one place.

\`settings.ts\` declares the state:

\`\`\`ts example-bad file=settings.ts
export const settings = { theme: "light", fontSize: 14 };

export function setTheme(theme: "light" | "dark"): void {
  settings.theme = theme;
  localStorage.setItem("theme", theme);
}
\`\`\`

\`toolbar.ts\` changes it directly:

\`\`\`ts example-bad file=toolbar.ts
import { settings } from "./settings.js";

export function onDarkMode(): void {
  settings.theme = "dark";
}
\`\`\`

The plainest way to keep one writer needs no stateward: keep the mutable value private, and export a read-only view of it (\`readonly\` at every level) with the functions that change it. TypeScript then rejects \`settings.theme = "dark"\` in any other file:

\`\`\`ts
const state = { theme: "light", fontSize: 14 };

export const settings: { readonly theme: string; readonly fontSize: number } = state;

export function setTheme(theme: "light" | "dark"): void {
  state.theme = theme;
}
\`\`\`

A value can also state its owner in its type, for code that is not restructured this way, for changes \`readonly\` does not see (a cast, a method of a \`Map\`), or to have each change proven: \`Owned<T>\`, from \`guarantees.ts\`, the file the quick fix writes once in your project. stateward then stops guessing for that value and proves it: every change from another module is an error, also through an alias, a re-export, a cast, an array or object that holds it or a function it is handed to, and a place stateward cannot follow is "not checked", with why:

\`\`\`ts example-bad file=guarantees.ts
export type Owned<T = unknown> = T & { readonly "__guarantee:owned"?: true };
\`\`\`

\`\`\`ts example-bad file=session.ts
import type { Owned } from "./guarantees.js";

export const session: Owned<{ user: string | null }> = { user: null };

export function signOut(): void {
  session.user = null;
}
\`\`\`

\`\`\`ts example-bad file=header.ts
import { session } from "./session.js";

export function onExpired(): void {
  const current = session;
  current.user = null;
}
\`\`\`

In \`toolbar.ts\`, call the function the declaring file offers for the change:

\`\`\`ts example-good file=toolbar.ts
import { setTheme } from "./settings.js";

export function onDarkMode(): void {
  setTheme("dark");
}
\`\`\`

And in \`header.ts\`, the function \`session.ts\` offers:

\`\`\`ts example-good file=header.ts
import { signOut } from "./session.js";

export function onExpired(): void {
  signOut();
}
\`\`\`

When there is no such function yet, add one to the declaring file: what it should be is your design, so no quick fix writes it. For a stated value, the message names the owner's functions that already make the change (\`signOut\` in \`session.ts\`).

If only the declaring file should ever change the value, state it: the quick fix **Declare settings owned by settings.ts** writes \`Owned\` in \`guarantees.ts\` (the nearest \`src\` folder; the file is created the first time) and marks the declaration, \`export const settings: Owned<{ theme: string; fontSize: number; }> = …\`. It is offered only when it compiles, and \`check --fix\` never applies it: stating a guarantee is your call.

## Why it matters

When any file can change a shared object, no file can say what it holds. Here \`toolbar.ts\` sets the theme without saving it, so the next reload forgets the choice, and the screen and the saved settings disagree. With one writer, every change goes through code that keeps the object right.

## What it does not catch

It reports another file changing an exported object, array, \`Map\`, \`Set\`, class instance or \`let\`, through its import or a re-export: assigning to it or to a property (\`settings.theme = "dark"\`, \`counters.total += 1\`, \`delete cache.user\`), calling a method that changes it (\`items.push(x)\`, \`registry.set(key, value)\`, \`Object.assign(settings, …)\`), or passing it to one of your own functions, in another file, that changes its argument (a function that only reads it is fine). It stays quiet about:

- changes inside the declaring file, and changes to a copy (\`{ ...settings }\`) or a local;
- calls to methods of your own classes: the class decides what its methods may change;
- test files (\`*.test.*\`, \`*.spec.*\`, \`__tests__/\`) and state declared in them;
- changes through a value typed \`any\`, and state from a package in \`node_modules\`;
- a collection typed through an alias (\`type Items = string[]\`): its methods are not recognised;
- state passed to a function outside your code, which stateward cannot follow.

For a value stated \`Owned\` every use outside the owner is listed and read, and a place it cannot read is "not checked" (shown with \`--verbose\`; the guarantee reads "not checked", never "proven"). It reads a local alias (\`const s = settings\`), a destructured part, an element (\`for (const job of jobs)\`, \`jobs.forEach((job) => …)\`, \`all[0]\`), an array or object literal that holds it (\`[settings]\`, \`{ current: settings }\`, \`new Map([[key, settings]])\`), a static field of a class, a cast (\`as\`, also through \`unknown\`), \`Object.assign\`, \`Object.freeze\` and \`Reflect\`, a method of your own class that changes \`this\`, and the owner handing it to another module's function that changes it. A spread copy (\`{ ...settings }\`, \`[...list]\`) is new at its first level only: a change to a nested value of the copy (\`copy.tags.push("x")\`, \`copy.meta.n = 3\`) is a change to the owned value. \`structuredClone\` copies every level.

Every reference to the value is read, or listed as "not checked" at its place: stateward lists each one as the editor's "find all references" does (through imports, re-exports and destructured names) and follows the value from it. A reference whose value goes where the rule does not follow is not checked, with what it is: a class field or a default value that keeps it, a getter or a function that returns it (its callers are not followed), a generator that yields it, a call through \`call\`, \`apply\` or \`Reflect.apply\`, a \`Proxy\`, another name for it that other files can import, or a change the rule cannot trace back to it (\`(flag ? settings : other).theme = …\`). The guarantee reads "unused" only when nothing refers to the value.

Not checked, with the reason: the value assigned to a property or another variable, pushed into a collection, given to a class (\`new X(settings)\`) or a component, spread into an argument list, handed to a named callback (\`items.forEach(touch)\`), given to a parameter or value of function type, to a function of the project that returns or stores its argument, or to a package function (unless its parameter is \`Readonly\`); a value reached by a computed key; a callee it cannot tell (\`handlers.get(name)?.(settings)\`), a value typed \`any\`, and a value typed \`Owned\` whose declaration it cannot tell (a parameter). Test files are left out, as for other state.

The message names an owner's function only when it makes the same change: the same property and the same kind of value (\`null\`, an equal literal, a parameter of the right type); otherwise it says to add one.

## Turn it on or off

When a few files share one state on purpose (a store and its slices), list them under \`owners\` rather than turning the rule off (for a value stated \`Owned\` too: the files listed count as its owner): map the declaring file to the files allowed to write it (paths from the project folder; \`*\` matches within a folder, \`**\` across folders). The message writes that entry for the change it reports, with the two real paths.

\`\`\`ts
rules: { "ownership/state-written-outside-owner": ["error", { owners: { "src/store.ts": ["src/slices/**"] } }] }
rules: { "ownership/state-written-outside-owner": ["error", { ignore: ["pluginRegistry"] }] } // state any file may change
rules: { "ownership/state-written-outside-owner": "off" }
\`\`\`
`;

function mayWrite(
  owners: Readonly<Record<string, readonly string[]>>,
  declaring: string,
  writer: string,
): boolean {
  return Object.entries(owners).some(
    ([glob, writers]) =>
      matchesGlob(glob, declaring) && writers.some((allowed) => matchesGlob(allowed, writer)),
  );
}

/** The project folder, found by taking the declaration's relative path off its absolute one. */
function relativeTo(declFile: string, relative: string, file: string): string {
  if (!declFile.endsWith(relative)) return file;
  const root = declFile.slice(0, declFile.length - relative.length);
  return file.startsWith(root) ? file.slice(root.length) : path.basename(file);
}

function headline(write: Write, owner: string): string {
  return fitted(
    (cut) => `\`${cut.name(write.name)}\` is changed outside its module, \`${cut.path(owner)}\``,
  );
}

/**
 * The reading for a change that is on purpose: the files named under the rule's `owners` option, as
 * the option is written: the declaring file, then the files allowed to write it.
 */
function sharedOnPurpose(owner: string, writer: string): string[] {
  const key = JSON.stringify(owner);
  const file = JSON.stringify(writer);
  const fits = (lines: readonly string[]): boolean =>
    lines.every((line) => line.length + 4 <= MAX_EXAMPLE);
  const way =
    "- or, if these files share it on purpose, list them under the rule's `owners` option";
  const forms = [
    [`{ owners: { ${key}: [${file}] } }`],
    ["owners: {", `  ${key}: [${file}],`, "}"],
    // The entry alone, over lines, when the paths are long: it goes inside `owners`.
    [`${key}: [`, `  ${file},`, "],"],
  ];
  const form = forms.find(fits);
  return form === undefined
    ? [`${way}: add ${key} with the file ${file}`]
    : [`${way}${form === forms[2] ? ", as an entry" : ""}:`, ...form.map((line) => `    ${line}`)];
}

/** An example line is at most this long, with its indent. */
const MAX_EXAMPLE = 100;

/**
 * The plain TypeScript pattern first (a function in the owner, and the value exported as a
 * read-only view, so TypeScript itself rejects other changes), the `Owned` marker second.
 */
function hintOf(write: Write, owner: string, writer: string): string {
  return fitted((cut) =>
    [
      "one of",
      `- add a function in \`${cut.path(owner)}\` that makes the change (e.g. \`${shorten(write.example, 50)}\`), call it, and export the value read-only (\`readonly\` at every level)`,
      `- or state it \`Owned\`, so stateward proves that only \`${cut.path(owner)}\` changes it`,
      ...sharedOnPurpose(owner, writer),
    ].join("\n"),
  );
}

/** The quick fix that states an unmarked value owned: the first form that compiles is offered. */
function declareFix(declare: DeclareFix | null): Fix[] {
  const [first, ...rest] = (declare?.forms ?? []).map((edits) => ({
    title: declare?.title ?? "",
    edits: edits.map((edit) => ({
      location: { file: edit.file, start: edit.start, end: edit.end },
      newText: edit.newText,
    })),
    changesType: true as const,
  }));
  return first === undefined ? [] : [{ ...first, alternatives: rest }];
}

/**
 * Whether a value the owner's function writes is the kind of value a change writes: the same
 * literal, `null` or `undefined` matched, or a parameter whose type is the change's. A shape the
 * rule cannot compare never matches.
 */
function sameValue(change: string, owner: string): boolean {
  if (change === owner) return !change.startsWith("=value:") && change !== "other";
  if (!owner.startsWith("=param:")) return false;
  const wanted = owner.slice("=param:".length);
  if (change.startsWith("=param:") || change.startsWith("=value:")) {
    return change.slice(change.indexOf(":") + 1) === wanted;
  }
  if (change.startsWith("=lit:")) {
    const text = change.slice("=lit:".length);
    const widened = /^["'`]/.test(text)
      ? "string"
      : text === "true" || text === "false"
        ? "boolean"
        : "number";
    return widened === wanted;
  }
  return false;
}

/**
 * The owner's functions that change the same property of a value in the same way as the change
 * does: the same property path, and the same kind of value (`=null` for `null`, a literal equal,
 * a parameter of the right type; `++` for `++`). A change with no single property (`Object.assign`)
 * or a path that is not known names none: calling another property's function, or setting another
 * value, would do something else.
 */
function ownerCalls(fns: readonly OwnerFunction[], change: OwnedChange): string[] {
  if (change.path === null) return [];
  const { path, shape } = change;
  const picked = fns.filter((entry) =>
    entry.writes.some((write) => write.path === path && sameValue(shape, write.shape)),
  );
  return [...new Set(picked.map((entry) => entry.fn))].slice(0, 3);
}

function ownedHint(
  change: OwnedChange,
  owner: string,
  writer: string,
  fns: readonly OwnerFunction[],
): string {
  const calls = ownerCalls(fns, change);
  const named = calls.map((fn) => `\`${fn}\``).join(", ");
  const sets = change.sets.map((name) => `\`${name}\``).join(", ");
  const add = fitted((cut) =>
    sets === ""
      ? `add a function in \`${cut.path(owner)}\` that makes the change (e.g. \`${shorten(change.example, 50)}\`), and call it instead`
      : `add a function in \`${cut.path(owner)}\` that sets ${sets}, and call it instead`,
  );
  const first =
    calls.length === 1
      ? fitted((cut) => `call ${named} from \`${cut.path(owner)}\` instead: it owns the value`)
      : calls.length > 1
        ? fitted((cut) => `call one of \`${cut.path(owner)}\`'s functions instead: ${named}`)
        : add;
  return ["one of", `- ${first}`, ...sharedOnPurpose(owner, writer)].join("\n");
}

function hopNotes(change: OwnedChange): RelatedLocation[] {
  return change.hops.map((hop) => ({
    location: { file: hop.file, start: hop.start, end: hop.end },
    message: hop.message,
  }));
}

/** One finding on a value stated owned, or nothing when the change is its owner's. */
function reportOwned(
  file: string,
  change: OwnedChange,
  witnesses: ReadonlyMap<string, Witness>,
  keeps: ReadonlyMap<string, string>,
  fnsById: ReadonlyMap<string, OwnerFunction[]>,
  ctx: ProjectContext<{ owners: Readonly<Record<string, readonly string[]>> }>,
  /** Every value the project states owned: the ones a value whose declaration is not found may be. */
  everyOwned: readonly (Place & { type: string })[],
): void {
  const location = { file, start: change.start, end: change.end };
  if (change.id === null || change.decl === null) {
    const writer = change.writer ?? path.basename(file);
    // It may be any declaration of its type, so none of them reads proven while this stands; a
    // value whose type is not known may be any.
    const maybe = everyOwned.filter(
      (one) => change.valueType === undefined || one.type === change.valueType,
    );
    ctx.report({
      ...(maybe.length === 0 ? {} : { against: maybe }),
      message:
        change.what !== ""
          ? fitted((cut) => `not checked: \`${cut.name(change.place)}\` ${change.what}`)
          : fitted(
              (cut) =>
                `not checked: whose \`${cut.name(change.name)}\` is, in \`${cut.path(writer)}\`: it is typed \`Owned\`, but its declaration is not found`,
            ),
      hint:
        change.what !== ""
          ? change.reason
          : "import the value itself, or make the change in its owner: no import, alias, return or element leads to its declaration",
      location,
      related: hopNotes(change),
    });
    return;
  }
  const owner = change.id.slice(0, Math.max(0, change.id.indexOf("#")));
  const decl = change.decl;
  const relative = (absolute: string): string => relativeTo(decl.file, owner, absolute);
  const allowed = (writer: string): boolean =>
    writer === owner || mayWrite(ctx.options.owners, owner, writer);
  const stated: RelatedLocation = {
    location: decl,
    message: `\`${shorten(change.name)}\` is declared owned: only \`${shorten(owner, 50)}\` may change it`,
  };
  const fns = fnsById.get(change.id) ?? [];
  let writer = relative(file);
  const notes = hopNotes(change);
  if (change.kind === "pass") {
    const witness =
      change.callee === null ? undefined : witnesses.get(keyOf(change.callee, change.index));
    const kept = change.callee === null ? undefined : keeps.get(keyOf(change.callee, change.index));
    if (witness === undefined && kept !== undefined && change.callee !== null) {
      const calleeFile = change.callee.slice(0, Math.max(0, change.callee.indexOf("#")));
      if (calleeFile === owner || allowed(relative(calleeFile))) return;
      ctx.unknown({
        message: fitted(
          (cut) =>
            `not checked: \`${cut.name(kept)}(…)\` may change \`${cut.name(change.name)}\`, owned by \`${cut.path(owner)}\``,
        ),
        hint: `pass a copy, or make the change in its owner: \`${shorten(kept, 30)}\` keeps the value where stateward does not follow it (returned, stored, or passed on)`,
        location,
      });
      return;
    }
    if (witness === undefined || change.callee === null) return;
    const calleeFile = change.callee.slice(0, Math.max(0, change.callee.indexOf("#")));
    if (calleeFile === owner) return;
    writer = relative(witness.file);
    notes.push({
      location: { file: witness.file, start: witness.start, end: witness.end },
      message: `\`${shorten(witness.fn)}\` changes its argument`,
    });
  }
  if (allowed(writer)) return;
  if (change.kind === "unknown") {
    // Not an error: the guarantee reads "not checked" (the proof lists the place from the summary).
    ctx.unknown({
      message: fitted((cut) =>
        change.what !== ""
          ? `not checked: \`${cut.name(change.place)}\` ${change.what}, owned by \`${cut.path(owner)}\``
          : `not checked: \`${cut.name(change.place)}\` may change \`${cut.name(change.name)}\`, owned by \`${cut.path(owner)}\``,
      ),
      hint: change.reason,
      location,
    });
    return;
  }
  ctx.report({
    message: fitted(
      (cut) => `\`${cut.name(change.name)}\` is changed outside its owner, \`${cut.path(owner)}\``,
    ),
    hint: ownedHint(change, owner, writer, fns),
    against: true,
    location,
    related: [...notes, stated],
  });
}

export const stateWrittenOutsideOwner = defineRule({
  kind: "project",
  meta: {
    description:
      "When several modules change the same module-level state, each change must be read to know its value; one owning module with functions keeps that in one place.",
    summary: "shared module state changed by a file other than the one that declares it",
    defaultSeverity: "error",
    tier: "core",
    group: "owners",
    proves: { traits: ["owned"] },
    options: {
      owners: option.record({
        default: {},
        description:
          "Files that may also change the state a file declares: a declaring file glob and the globs of the files allowed to write it (paths relative to the project).",
      }),
      ignore: option.strings({
        default: [],
        description:
          "Names of shared state (globs like *Registry) that any file may change, such as a registry built up by plugins. A value stated `Owned` is never left out.",
      }),
      severities: option.severities({
        kinds: {
          direct:
            "the other file changes it itself: an assignment, `delete` or a changing method call.",
          "through-call":
            "the other file passes it to a function of yours, declared elsewhere, that changes its argument.",
        },
        description:
          "A severity per way the state is changed. A value stated `Owned` is reported at the rule's severity, whatever these say.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: summarizeFile,
  check(summaries, ctx) {
    const { owners } = ctx.options;
    const { witnesses, keeps } = changedParams(summaries);
    // A value handed to a function of the project is read here, where what the function does with
    // its parameter is known: a function that keeps it where it is not followed leaves it unchecked.
    for (const summary of summaries.values()) {
      for (const one of summary.handed ?? []) {
        const key = keyOf(one.callee, one.index);
        const kept = keeps.get(key);
        ctx.read(
          { id: one.ref, trait: one.trait },
          kept !== undefined && !witnesses.has(key)
            ? {
                kind: "unchecked",
                reason: `\`${kept}(…)\` may change \`${one.name}\`: ${KEPT_FIX}`,
              }
            : { kind: "decided" },
        );
      }
    }
    const fnsById = new Map<string, OwnerFunction[]>();
    for (const summary of summaries.values()) {
      for (const entry of summary.ownerFns) {
        fnsById.set(entry.id, [...(fnsById.get(entry.id) ?? []), entry]);
      }
    }
    const everyOwned = [...summaries.values()].flatMap((summary) =>
      summary.ownedDeclared.map(({ file, start, end, type }) => ({ file, start, end, type })),
    );
    for (const [file, summary] of summaries) {
      const changes = [
        ...summary.writes.map((write) => ({ write, witness: undefined })),
        ...summary.passes.flatMap((pass) => {
          const witness = witnesses.get(keyOf(pass.callee, pass.index));
          const declaredIn = pass.callee.slice(0, Math.max(0, pass.callee.indexOf("#")));
          const ownerOf = pass.id.slice(0, Math.max(0, pass.id.indexOf("#")));
          return witness === undefined || declaredIn === ownerOf ? [] : [{ write: pass, witness }];
        }),
      ].sort((a, b) => a.write.start - b.write.start);
      const owned = summary.owned.map((change) => ({ start: change.start, change }));
      const unmarked = changes.map((entry) => ({ start: entry.write.start, entry }));
      // Every change in file order: an owned value's and an unmarked one's never share a place.
      for (const item of [...owned, ...unmarked].sort((a, b) => a.start - b.start)) {
        if ("change" in item) {
          reportOwned(file, item.change, witnesses, keeps, fnsById, ctx, everyOwned);
          continue;
        }
        const { write, witness } = item.entry;
        const ownerFile = write.id.slice(0, Math.max(0, write.id.indexOf("#")));
        const writerFile = relativeTo(write.declFile, ownerFile, file);
        if (writerFile === ownerFile || mayWrite(owners, ownerFile, writerFile)) continue;
        if (matchesName(write.name, ctx.options.ignore)) continue;
        ctx.report({
          findingKind: witness === undefined ? "direct" : "through-call",
          message: headline(write, ownerFile),
          hint: hintOf(write, ownerFile, writerFile),
          location: { file, start: write.start, end: write.end },
          related: [
            ...(witness === undefined
              ? []
              : [
                  {
                    location: { file: witness.file, start: witness.start, end: witness.end },
                    message: `\`${shorten(witness.fn)}\` changes its argument`,
                  },
                ]),
            {
              location: { file: write.declFile, start: write.declStart, end: write.declEnd },
              message: `\`${shorten(write.name)}\` is declared in \`${shorten(ownerFile, 50)}\`, which owns it`,
            },
          ],
          fixes: declareFix(write.declare),
        });
      }
    }
  },
});
