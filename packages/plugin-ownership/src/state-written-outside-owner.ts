import path from "node:path";
import { defineRule, matchesName, option } from "@stateward/core";
import { fitted, matchesGlob, shorten } from "./text.js";
import { summarizeFile, type FileSummary, type Write } from "./summary.js";

const EXPLAIN = `# ownership/state-written-outside-owner

Shared module-level state is changed only by the module that declares it; others call its functions.

## Why

When any file can change a shared object, no file can say what it holds. If \`src/theme.ts\` sets \`settings.theme = "dark"\` directly, the function in \`src/settings.ts\` that saves the choice and tells the UI never runs, and the screen and the saved settings disagree. With one writer, every change goes through code that keeps the object right.

## When to use it

Use it in any app with module-level stores, registries or config objects. It is on as an error in every preset. When a few files share one state on purpose (a store and its slices), list them under \`owners\` (below) rather than turning the rule off.

## What it catches

Another file changing an exported object, array, \`Map\`, \`Set\`, class instance or \`let\`, through its import or a re-export:

- assigning to it or to a property (\`settings.theme = "dark"\`, \`counters.total += 1\`, \`delete cache.user\`);
- calling a method that changes it (\`items.push(x)\`, \`registry.set(key, value)\`, \`Object.assign(settings, …)\`);
- passing it to one of your own functions, declared in another file, that changes its argument. A function that only reads it is fine.

### Bad

\`\`\`ts
// src/settings.ts
export const settings = { theme: "light", fontSize: 14 };

// src/theme.ts
import { settings } from "./settings.js";
settings.theme = "dark"; // \`settings\` belongs to src/settings.ts
\`\`\`

### Good

\`\`\`ts
// src/settings.ts
export const settings = { theme: "light", fontSize: 14 };
export function setTheme(theme: "light" | "dark"): void {
  settings.theme = theme;
}

// src/theme.ts
import { setTheme } from "./settings.js";
setTheme("dark");
\`\`\`

### Fix

Add a function to the declaring file that makes the change, and call it instead. There is no quick fix: what that function should be is your design.

## What it does not catch

It stays quiet about:

- changes inside the declaring file, and changes to a copy (\`{ ...settings }\`) or a local;
- calls to methods of your own classes: the class decides what its methods may change;
- test files (\`*.test.*\`, \`*.spec.*\`, \`__tests__/\`) and state declared in them;
- changes through a value typed \`any\`;
- state from a package in \`node_modules\`;
- a collection typed through an alias (\`type Items = string[]\`): its methods are not recognised;
- state passed to a function outside your code, which stateward cannot follow.

## Turn it on or off

In \`stateward.config.ts\`:

\`\`\`ts
rules: { "ownership/state-written-outside-owner": "off" } // or "warning"
groups: { "boundaries/ownership": "off" } // the whole group
rules: { "ownership/state-written-outside-owner": ["error", { ignore: ["pluginRegistry"] }] } // state any file may change
\`\`\`

To let other files change a file's state, map the declaring file to the files allowed to write it (paths from the project folder; \`*\` matches within a folder, \`**\` across folders):

\`\`\`ts
rules: { "ownership/state-written-outside-owner": ["error", { owners: { "src/store.ts": ["src/slices/**"] } }] }
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

function headline(write: Write, owner: string, writer: string): string {
  return fitted(
    (cut) =>
      `\`${cut.name(write.name)}\` belongs to \`${cut.path(owner)}\`; \`${cut.path(writer)}\` changes it`,
  );
}

function hintOf(write: Write, owner: string): string {
  return fitted(
    (cut) =>
      `add a function in \`${cut.path(owner)}\` that makes this change (e.g. \`${shorten(write.example, 50)}\`), and call it here`,
  );
}

export const stateWrittenOutsideOwner = defineRule({
  kind: "project",
  meta: {
    description:
      "Shared module-level state is changed only by the module that declares it; others call its functions.",
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
          "Names of shared state (globs like *Registry) that any file may change, such as a registry built up by plugins.",
      }),
      severities: option.severities({
        kinds: {
          direct:
            "the other file changes it itself: an assignment, `delete` or a changing method call.",
          "through-call":
            "the other file passes it to a function of yours, declared elsewhere, that changes its argument.",
        },
        description: "A severity per way the state is changed.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: summarizeFile,
  check(summaries, ctx) {
    const { owners } = ctx.options;
    const witnesses = changedParams(summaries);
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
      for (const { write, witness } of changes) {
        const ownerFile = write.id.slice(0, Math.max(0, write.id.indexOf("#")));
        const writerFile = relativeTo(write.declFile, ownerFile, file);
        if (writerFile === ownerFile || mayWrite(owners, ownerFile, writerFile)) continue;
        if (matchesName(write.name, ctx.options.ignore)) continue;
        ctx.report({
          findingKind: witness === undefined ? "direct" : "through-call",
          message: headline(write, ownerFile, writerFile),
          hint: hintOf(write, ownerFile),
          location: { file, start: write.start, end: write.end },
          related: [
            ...(witness === undefined
              ? []
              : [
                  {
                    location: { file: witness.file, start: witness.start, end: witness.end },
                    message: `\`${shorten(witness.fn)}\` changes its argument here`,
                  },
                ]),
            {
              location: { file: write.declFile, start: write.declStart, end: write.declEnd },
              message: `\`${shorten(write.name)}\` is declared here, and \`${shorten(ownerFile, 50)}\` owns it`,
            },
          ],
        });
      }
    }
  },
});
