import { defineRule, highestUncovered, option, shortestPath } from "@stateward/core";
import type { RelatedLocation } from "@stateward/core";
import { className } from "./inference/format.js";
import { modelOf, summarizeReact } from "./react/boundaries.js";
import type { Model, Site } from "./react/boundaries.js";
import { LIBRARY_BOUNDARIES } from "./react/tree.js";
import { codeList, fitted, withExample } from "./text.js";

/** The group the rule belongs to in the docs and in `stateward status`. */
export const GROUP = "render";

const EXPLAIN = `# errors/render-throw-without-boundary

An error thrown while rendering, with no error boundary above the component, unmounts the whole React tree and leaves a blank page.

\`\`\`tsx example-bad
import { createRoot } from "react-dom/client";

class NotFoundError extends Error {}

function UserPage({ id }: { id: string }) {
  if (id === "") throw new NotFoundError("no such user");
  return <h1>User {id}</h1>;
}

function App() {
  return (
    <main>
      <nav>Menu</nav>
      <UserPage id={location.hash.slice(1)} />
    </main>
  );
}

createRoot(document.body).render(<App />);
\`\`\`

Put an error boundary around the part that can fail, so the rest of the app stays:

\`\`\`tsx example-good
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";

class NotFoundError extends Error {}

function UserPage({ id }: { id: string }) {
  if (id === "") throw new NotFoundError("no such user");
  return <h1>User {id}</h1>;
}

function App() {
  return (
    <main>
      <nav>Menu</nav>
      <ErrorBoundary fallback={<p>This user does not exist.</p>}>
        <UserPage id={location.hash.slice(1)} />
      </ErrorBoundary>
    </main>
  );
}

createRoot(document.body).render(<App />);
\`\`\`

There is no quick fix: where the boundary goes, and what it shows, is your call.

## Why it matters

When a component throws while React renders it, or in one of its effects, React unmounts everything up to the nearest error boundary. With no boundary above, the whole app goes blank: a \`<UserPage>\` that throws \`NotFoundError\` for a wrong id takes the menu and every other route down with it, where a boundary could have shown "this user does not exist".

## What it does not catch

It starts from your entry point (\`createRoot(…).render(…)\` or \`hydrateRoot\`) and reports, once, the highest place that renders a component which can throw a known error while rendering, with no boundary above; the related places show the path down to the throw. A component counts what its body and its hooks throw, what its \`useEffect\` and \`useLayoutEffect\` callbacks throw, and what the components it renders outside a boundary throw. A boundary is react-error-boundary's \`<ErrorBoundary>\` (the \`boundaries\` option adds other packages'), or a class of yours with \`getDerivedStateFromError\` or \`componentDidCatch\`. It is silent on:

- errors in event handlers, timers and async code: a boundary never catches them (\`async/handler-rejection-lost\` checks async handlers);
- errors stateward cannot see (a package it cannot read, a callback, a dynamic call): the hover on a boundary lists them;
- an app with no \`createRoot(…).render(…)\` or \`hydrateRoot\` it can find: nothing is checked;
- routes in \`createBrowserRouter([...])\` route objects (React Router catches their errors itself with \`errorElement\`); \`memo\`, \`forwardRef\` and \`lazy\` components; boundaries from packages not listed in \`boundaries\`;
- an element passed to a function or stored in an object or array (\`showToast(<UserPage />)\`). An element held in a local \`const\` or \`let\` is checked where it is rendered;
- a class that a \`try\` in the component may catch (with a test other than \`instanceof\`);
- a throw that is not of a known error class (\`throw "no cart"\`), and a thrown promise (Suspense);
- two kinds of throw that name a caller's programming mistake rather than a failure to show: the usual check in a context hook (\`if (!ctx) throw new Error("useAuth must be used within AuthProvider")\` on a value from \`useContext\`, or a comparison with a "missing" constant declared at the top of the file), and a check on a value the caller's type already rules out (\`props.title === undefined\` with \`title: string\`). A check on an optional prop or a parameter that can be \`undefined\` still counts, as does a throw on a truthy value (\`if (error) throw error\`) or a comparison (\`id === ""\`). Set \`skipContextGuards\` or \`skipInputGuards\` to \`false\` to count those too.

## Getting the best from it

A boundary around the whole app (the one that wraps the tree at \`createRoot(…).render(…)\`) does not count: it catches the error, but the whole app is replaced by its fallback, which is rarely what you want for one page. The finding is then at the highest place below it. If an app-wide fallback is what you want, set \`rootBoundaryCounts: true\`; \`stateward plan\` then says the rule is silent because your app's root has an error boundary.

## Turn it on or off

Whether a page should handle an error itself or let a boundary do it is your call, so it is a warning. If every throw in render is a bug that should crash in development, turn it off.

\`\`\`ts
rules: { "errors/render-throw-without-boundary": "off" } // or "error"
rules: { "errors/render-throw-without-boundary": ["warning", { boundaries: { "react-error-boundary": ["ErrorBoundary"], "@sentry/react": ["ErrorBoundary"] } }] }
rules: { "errors/render-throw-without-boundary": ["warning", { rootBoundaryCounts: true }] } // a boundary around the whole app is enough
\`\`\`
`;

/** At most this many notes; a longer path keeps its first steps and its last. */
const MAX_NOTES = 5;

function headline(component: string, names: readonly string[]): string {
  return fitted(
    (cut) =>
      `\`<${cut(component)}>\` can throw ${codeList(names, cut)} while rendering, with no error boundary above it`,
  );
}

/** A throw that only the boundary around the whole app catches (`rootBoundaryCounts` is off). */
function rootHeadline(component: string, names: readonly string[]): string {
  return fitted(
    (cut) =>
      `\`<${cut(component)}>\` can throw ${codeList(names, cut)} while rendering; only the app-wide boundary catches it`,
  );
}

function rootHint(component: string): string {
  return withExample(
    "add a boundary around it, or set `rootBoundaryCounts` if replacing the whole app is intended:",
    ["<ErrorBoundary FallbackComponent={ErrorPage}>", `  <${component} />`, "</ErrorBoundary>"],
  );
}

/** The reason `plan` gives when a root boundary makes the rule silent. */
export const ROOT_BOUNDARY_SILENT = "your app's root has an error boundary";

function hint(component: string): string {
  return withExample(
    "wrap it in an error boundary, at this render or nearer to what throws; for example with react-error-boundary:",
    ["<ErrorBoundary FallbackComponent={ErrorPage}>", `  <${component} />`, "</ErrorBoundary>"],
  );
}

/** The renders down from the site to the component that throws `cls`, then the call that throws it. */
function pathNotes(model: Model, site: Site, cls: string): RelatedLocation[] {
  const classes = model.analysis.classes;
  const path = shortestPath<Site>(
    site.to,
    (id) => model.edges(id),
    (edge) => model.nearest(edge) === undefined && model.needs(edge.to).has(cls),
    (id) => model.own(id).classes.get(cls)?.certain === true && !model.own(id).guarded.has(cls),
  );
  if (path === undefined) return [];
  const notes: RelatedLocation[] = path.map((edge) => ({
    location: { file: edge.file, start: edge.render.at[0], end: edge.render.at[1] },
    message: `\`<${edge.render.name}>\` is rendered`,
  }));
  const thrower = path.at(-1)?.to ?? site.to;
  const brought = model.own(thrower).classes.get(cls);
  if (brought !== undefined) {
    notes.push({
      location: brought.location,
      message: `${brought.what} \`${className(cls, classes)}\``,
    });
  }
  if (notes.length <= MAX_NOTES) return notes;
  const skipped = notes.length - (MAX_NOTES - 1);
  const last = notes.at(-1);
  const head = notes.slice(0, MAX_NOTES - 2);
  const first = notes[MAX_NOTES - 2];
  return first === undefined || last === undefined
    ? head
    : [...head, { location: first.location, message: `… ${String(skipped)} more steps …` }, last];
}

/** Whether an error boundary of the project wraps the entry render: the app-wide boundary. */
function rootBoundaryOf(model: Model, entry: Site): boolean {
  const key = model.nearest(entry);
  return key !== undefined && model.boundaries.has(key);
}

/**
 * Where the walk starts below an entry with a root boundary: the renders in its component, or the
 * entry itself when the component throws on its own (nothing nearer can be named then).
 */
function belowRoot(model: Model, entry: Site): readonly Site[] {
  const own = model.own(entry.to);
  const throwsItself = [...own.classes].some(
    ([cls, brought]) => brought.certain && !own.guarded.has(cls),
  );
  return throwsItself ? [entry] : model.edges(entry.to);
}

export const renderThrowWithoutBoundary = defineRule({
  kind: "project",
  meta: {
    description:
      "An error thrown while rendering, with no error boundary above the component, unmounts the whole React tree and leaves a blank page.",
    summary:
      "a component that can throw a known error while rendering, with no error boundary above it",
    defaultSeverity: "warning",
    tier: "core",
    group: GROUP,
    needsJsDoc: true,
    needsTypes: { library: "React", modules: ["react"] },
    options: {
      skipContextGuards: option.boolean({
        default: true,
        description:
          'Leave out the usual check in a context hook: `if (!ctx) throw new Error("useAuth must be used within AuthProvider")`.',
      }),
      skipInputGuards: option.boolean({
        default: true,
        description:
          "Leave out a throw when a prop or a parameter whose type rules it out, or a context hook's value, is missing (a mistake of the caller).",
      }),
      rootBoundaryCounts: option.boolean({
        default: false,
        description:
          "Count the error boundary around the whole app as handling the error. Off by default: the whole app is then replaced by its fallback, so the rule asks for a boundary nearer the page.",
      }),
      boundaries: option.record({
        default: LIBRARY_BOUNDARIES,
        description:
          'Error boundary components from packages, by package: add Sentry\'s with `{ "@sentry/react": ["ErrorBoundary"] }` (keep react-error-boundary\'s to keep it).',
      }),
    },
    explain: EXPLAIN,
  },
  summarize: (ctx) =>
    summarizeReact(ctx, ctx.options.boundaries, {
      contextGuards: ctx.options.skipContextGuards,
      inputGuards: ctx.options.skipInputGuards,
    }),
  silentReason(summaries, ctx) {
    if (!ctx.options.rootBoundaryCounts) return undefined;
    const model = modelOf(summaries);
    return model.entries.length > 0 && model.entries.every((entry) => rootBoundaryOf(model, entry))
      ? ROOT_BOUNDARY_SILENT
      : undefined;
  },
  check(summaries, ctx) {
    const model = modelOf(summaries);
    const classes = model.analysis.classes;
    const walk = (
      roots: readonly Site[],
      open: readonly Site[] = [],
    ): ReturnType<typeof highestUncovered<Site>> =>
      highestUncovered<Site>({
        roots,
        edges: (id) => model.edges(id),
        covered: (edge) => !open.includes(edge) && model.nearest(edge) !== undefined,
        needs: (id) => model.needs(id),
        key: (edge) => `${edge.file}:${String(edge.render.at[0])}`,
      });
    // An entry with a boundary around it yields nothing in the plain walk. Unless the root
    // boundary counts, the walk starts again below it, and what it finds is for the root message.
    const rooted = ctx.options.rootBoundaryCounts
      ? []
      : model.entries.filter((entry) => rootBoundaryOf(model, entry));
    const reported = new Set<string>();
    const places = [
      ...walk(model.entries).map((found) => ({ ...found, root: false })),
      ...walk(
        rooted.flatMap((entry) => belowRoot(model, entry)),
        rooted,
      ).map((found) => ({
        ...found,
        root: true,
      })),
    ];
    for (const { edge, needs, root } of places) {
      const key = `${edge.file}:${String(edge.render.at[0])}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const named = needs
        .map((id) => ({ id, name: className(id, classes) }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const [first] = named;
      if (first === undefined) continue;
      const component = model.functions.get(edge.to)?.fn.name ?? edge.render.name;
      const names = named.map((one) => one.name);
      ctx.report({
        message: root ? rootHeadline(component, names) : headline(component, names),
        hint: root ? rootHint(edge.render.name) : hint(edge.render.name),
        location: { file: edge.file, start: edge.render.at[0], end: edge.render.at[1] },
        related: pathNotes(model, edge, first.id),
      });
    }
  },
});
