import path from "node:path";
import { defineRule, matchesName, option } from "@stateward/core";
import type { Fix, ProjectContext, RelatedLocation } from "@stateward/core";
import { fitted, matchesGlob, shorten } from "./text.js";
import { summarizeFile, type FileSummary, type Write } from "./summary.js";
import type { DeclareFix } from "./declare-owned.js";
import type { OwnedChange, OwnerFunction } from "./owned.js";

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

A value can also state its owner in its type, for code that is not restructured this way, for changes \`readonly\` does not see (a cast, a method of a \`Map\`), or to have each change proven: \`Owned<T>\`, from \`guarantees.ts\`, the file the quick fix writes once in your project. stateward then stops guessing for that value and proves it: every change from another module is an error, also through an alias, a re-export, a cast or a function it is handed to, and a place stateward cannot follow is an error too, with why:

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

For a value stated \`Owned\` it follows more, and what it cannot follow is reported as an error: a local alias (\`const s = settings\`), a destructured part, an element (\`for (const job of jobs)\`, \`jobs.forEach((job) => …)\`), a function that returns it, a static field of a class, a cast (\`as\`, also through \`unknown\`), \`Object.assign\`, \`Object.freeze\` and \`Reflect\`, a method of your own class that changes \`this\`, and the owner handing it to another module's function that changes it. It reports, with the reason, a method or function from a package that is given the value (unless its parameter is \`Readonly\`), a callee it cannot tell (\`handlers.get(name)?.(settings)\`), a value typed \`any\`, and a value typed \`Owned\` whose declaration it cannot tell (a parameter). It does not follow a value stored into another object or array whose type drops \`Owned\`, nor \`new X(settings)\`; copies (\`{ ...settings }\`, \`structuredClone\`) are new values. Test files are left out, as for other state.

## Turn it on or off

When a few files share one state on purpose (a store and its slices), list them under \`owners\` rather than turning the rule off (for a value stated \`Owned\` too: the files listed count as its owner): map the declaring file to the files allowed to write it (paths from the project folder; \`*\` matches within a folder, \`**\` across folders).

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

/** Where a function changes a parameter: in which file, and the function that does it. */
type Witness = { file: string; start: number; end: number; fn: string };

const keyOf = (id: string, index: number): string => `${id}\u0000${String(index)}`;

/**
 * For each function parameter that the project's functions change, where the change is: its own
 * write, or that of a function it passes the parameter on to, however long the chain (and a
 * cycle ends where it began: a parameter nothing changes has no witness).
 */
function changedParams(summaries: ReadonlyMap<string, FileSummary>): Map<string, Witness> {
  const witnesses = new Map<string, Witness>();
  const pending: { key: string; forwards: readonly { id: string; index: number }[] }[] = [];
  for (const [file, summary] of [...summaries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const param of summary.params) {
      const key = keyOf(param.id, param.index);
      if (param.write !== null) witnesses.set(key, { file, fn: param.fn, ...param.write });
      else pending.push({ key, forwards: param.forwards });
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const { key, forwards } of pending) {
      if (witnesses.has(key)) continue;
      const found = forwards
        .map((next) => witnesses.get(keyOf(next.id, next.index)))
        .find((witness) => witness !== undefined);
      if (found !== undefined) {
        witnesses.set(key, found);
        changed = true;
      }
    }
  }
  return witnesses;
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
 * The plain TypeScript pattern first (a function in the owner, and the value exported as a
 * read-only view, so TypeScript itself rejects other changes), the `Owned` marker second.
 */
function hintOf(write: Write, owner: string): string {
  return fitted((cut) =>
    [
      "one of",
      `- add a function in \`${cut.path(owner)}\` that makes the change (e.g. \`${shorten(write.example, 50)}\`), call it, and export the value read-only (\`readonly\` at every level)`,
      `- or state it \`Owned\`, so stateward proves that only \`${cut.path(owner)}\` changes it`,
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

/** The owner's functions that change a value, those that change the same property first. */
function ownerCalls(fns: readonly OwnerFunction[], prop: string | null): string[] {
  const names = (list: readonly OwnerFunction[]) => list.map((entry) => entry.fn);
  const same = prop === null ? [] : fns.filter((entry) => entry.props.includes(prop));
  const picked = same.length > 0 ? same : fns;
  return [...new Set(names(picked))].slice(0, 3);
}

function ownedHint(change: OwnedChange, owner: string, fns: readonly OwnerFunction[]): string {
  const calls = ownerCalls(fns, change.prop);
  const named = calls.map((fn) => `\`${fn}\``).join(", ");
  if (calls.length === 1) {
    return fitted((cut) => `call ${named} from \`${cut.path(owner)}\` instead: it owns the value`);
  }
  if (calls.length > 1) {
    return fitted((cut) => `call one of \`${cut.path(owner)}\`'s functions instead: ${named}`);
  }
  return fitted(
    (cut) =>
      `add a function in \`${cut.path(owner)}\` that makes the change (e.g. \`${shorten(change.example, 50)}\`), and call it instead`,
  );
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
  fnsById: ReadonlyMap<string, OwnerFunction[]>,
  ctx: ProjectContext<{ owners: Readonly<Record<string, readonly string[]>> }>,
): void {
  const location = { file, start: change.start, end: change.end };
  if (change.id === null || change.decl === null) {
    const writer = change.writer ?? path.basename(file);
    ctx.report({
      message: fitted(
        (cut) =>
          `not checked: whose \`${cut.name(change.name)}\` is, in \`${cut.path(writer)}\`: it is typed \`Owned\`, but its declaration is not found`,
      ),
      hint: "import the value itself, or make the change in its owner: no import, alias, return or element leads to its declaration",
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
    ctx.report({
      message: fitted(
        (cut) =>
          `not checked: whether \`${cut.name(change.place)}\` changes \`${cut.name(change.name)}\`, owned by \`${cut.path(owner)}\``,
      ),
      hint: change.reason,
      location,
      related: [...notes, stated],
    });
    return;
  }
  ctx.report({
    message: fitted(
      (cut) => `\`${cut.name(change.name)}\` is changed outside its owner, \`${cut.path(owner)}\``,
    ),
    hint: ownedHint(change, owner, fns),
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
    const witnesses = changedParams(summaries);
    const fnsById = new Map<string, OwnerFunction[]>();
    for (const summary of summaries.values()) {
      for (const entry of summary.ownerFns) {
        fnsById.set(entry.id, [...(fnsById.get(entry.id) ?? []), entry]);
      }
    }
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
          reportOwned(file, item.change, witnesses, fnsById, ctx);
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
          hint: hintOf(write, ownerFile),
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
