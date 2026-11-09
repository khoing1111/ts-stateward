import { defineRule, option } from "@stateward/core";
import { checkSummaries } from "./check.js";
import type { EntryPoint } from "./options.js";
import { sharedSummary } from "./extract.js";
import type { Summary } from "./summary.js";

/** The rule's id, as the editor's hover asks for its summaries. */
export const PROVIDER_MISSING_ID = "react-context/provider-missing";

const EXPLAIN = `# react-context/provider-missing

Reports a component that reads a required context and is rendered with no Provider of that context above it; the notes show the render path from the entry point.

\`\`\`tsx example-bad
import { createContext, useContext } from "react";
import { createRoot } from "react-dom/client";

type User = { name: string };
const AuthContext = createContext<User | undefined>(undefined);

function useAuth(): User {
  const user = useContext(AuthContext);
  if (user === undefined) throw new Error("useAuth needs an AuthContext Provider");
  return user;
}

function Profile() {
  return <h1>{useAuth().name}</h1>;
}

createRoot(document.body).render(<Profile />);
\`\`\`

Render the component under the Provider:

\`\`\`tsx example-good
import { createContext, useContext } from "react";
import { createRoot } from "react-dom/client";

type User = { name: string };
const AuthContext = createContext<User | undefined>(undefined);

function useAuth(): User {
  const user = useContext(AuthContext);
  if (user === undefined) throw new Error("useAuth needs an AuthContext Provider");
  return user;
}

function Profile() {
  return <h1>{useAuth().name}</h1>;
}

createRoot(document.body).render(
  <AuthContext.Provider value={{ name: "Ada" }}>
    <Profile />
  </AuthContext.Provider>,
);
\`\`\`

\`<AuthContext value={…}>\` (React 19) is a Provider too, and so is a component of the project that renders one around its \`children\`. No quick fix adds the Provider, because where it belongs depends on the app.

## Why it matters

\`useAuth()\` throws when no \`AuthContext\` Provider is above the component that calls it. The types do not show that \`<Dashboard>\`, rendered from \`<App>\`, renders \`<Profile>\` without one, so the error appears only when that page is opened. The rule follows the components from \`createRoot(…).render(…)\` down and reports the render where the Provider goes missing, once per path.

## When it says “not checked”

A render the rule cannot follow is listed as not checked (an info), with what would make it checkable. For a context stated required (\`RequiredContext\`, below) each of these is an error instead.

- A component picked at run time (\`const Panel = panels[tab]\`): turn on the \`react-context/dynamic-components\` add-on, or pick it from a \`const\` object by a key with a fixed set of values. A component picked from a \`let\`, a parameter or a key typed \`string\`, or one given \`children\`, props or a function, stays not checked.
- A class component of the project (\`<ErrorBoundary>\`): render the components that read contexts inside it as function components.
- JSX passed to a call (\`toast(<Profile/>)\`), stored, or returned from a function that is not a component.
- Nested React Router routes, when the \`react-context/react-router\` add-on is off: one finding per router.
- A context declared in a package outside the checked files.
- A component that reads a required context but that nothing renders, and an app with no \`createRoot\` call: list the entry point in \`entries\` (below).
- An \`entries\` item that matches no component, or a \`provides\` name that matches no required context.

## What it does not catch

- A context with a default value, real or a cast (\`react-context/fake-default-value\` reports casts), and one whose readers do not check the value: nothing in the code says a Provider must be there.
- Tests and Storybook stories (left out by default), server components, and code in \`node_modules\` or \`.d.ts\` files. A library's components are taken to render their \`children\` in place and to provide no context.
- Whether a Provider's value is right: TypeScript checks that.
- A need that depends on the value of a prop: the prop's type decides, not the value passed.

## Getting the best from it

### Which contexts are required

A context is required when its type says so (\`RequiredContext\`, below), or when it is created with no default (\`createContext<User | undefined>(undefined)\`, or \`null\`) and a reader checks the value: a hook that throws (or calls a function that never returns) when it is missing, or a component that returns early when it is \`undefined\` or \`null\`. A hook of the project that takes the context as a parameter and checks it (\`function useRequired<T>(context: Context<T | undefined>): T\`) counts too.

### Entry points

The walk starts at \`createRoot(el).render(<App/>)\`, \`hydrateRoot\`, and the \`entries\` option. It follows every render, including \`children\`, render props and components passed as props. For an entry point it cannot find (a framework's or a test's), list it with the contexts already provided above it, where the plugin is added: \`reactContext({ entries: [{ file: "src/App.tsx", export: "App", provides: ["ThemeContext"] }] })\`.

### Pages loaded with \`lazy\`

\`lazy(() => import("./Settings"))\` is followed into the module's default export, and \`lazy(() => import("./Settings").then((m) => ({ default: m.Settings })))\` into its export \`Settings\`. \`React.lazy\` works too, and so does a wrapper of \`lazy\` that passes its argument to \`lazy\`. Name a wrapper that does more in the \`lazyFunctions\` option.

### Add-ons

- \`react-context/dynamic-components\`: follows a \`const\` object of components picked by a key with a fixed set of values (every component the key can pick is checked, \`lazy\` pages too), and \`const Page = cond ? A : B\`. A finding then names the entry: \`panels["settings"]\` is \`<Settings>\`.
- \`react-context/react-router\`: a child route renders where its parent renders \`<Outlet/>\`, so a Provider around a layout's \`<Outlet/>\` covers its child routes. It reads \`<Route element>\` with child routes, route objects in \`createBrowserRouter([…])\` and \`useRoutes([…])\`, \`createRoutesFromElements\`, and \`<RouterProvider router={router}/>\`. With the add-on off, nested routes count as having every Provider.

### Stating a context required

A context created with \`undefined\` and a hook that throws say "always under a Provider" at run time, and the rule infers it from that pattern. \`RequiredContext\` says it in the type, and the rule then proves it for every reader:

\`\`\`ts
const ThemeContext = requiredContext<Theme>(); // a RequiredContext<Theme>, from guarantees.ts
\`\`\`

- Every component that reads it, with \`useContext\`, \`use\` or \`<ThemeContext.Consumer>\`, must be rendered under its Provider, whether or not it checks the value.
- A place the rule cannot follow is an error with the path to it, never "not checked".
- Each error names the declaration that states it.

The quick fix on a context the rule infers as required (also offered on its declaration in the editor) writes \`guarantees.ts\` the first time, imports it, and rewrites \`createContext<User | undefined>(undefined)\` to \`requiredContext<User>()\`. Once every reader is proven, a second quick fix removes the hook's run-time check, reported as an info. \`check --fix\` applies neither: stating a guarantee is a decision for the developer. Tests are left out of the proof, so a test that renders a reader must render it inside its Provider. The guarantees guide, \`docs/user/guarantees.md\`, has the full example.

## Turn it on or off

\`\`\`ts
addons: ["react-context/react-router", "react-context/dynamic-components"]
rules: { "react-context/provider-missing": ["error", { ignore: ["RouterContext"] }] } // provided where stateward cannot see
rules: { "react-context/provider-missing": ["error", { lazyFunctions: ["lazyComponent"] }] } // your own lazy wrapper
rules: { "react-context/provider-missing": "off" }
\`\`\`
`;

const OPTIONS = {
  ignore: option.strings({
    default: [],
    description:
      "Required contexts (names or globs) whose missing Provider is not reported, such as one a framework provides above every page.",
  }),
  lazyFunctions: option.strings({
    default: [],
    description:
      'Your own wrappers of React\'s `lazy`, by name (like ["lazyComponent"]), whose first argument is `() => import("./Page")`: the page they load is followed like `lazy`.',
  }),
};

export function createProviderMissing(entries: readonly EntryPoint[]) {
  return defineRule<Summary, typeof OPTIONS>({
    kind: "project",
    meta: {
      description:
        "Reports a component that reads a required context and is rendered with no Provider of that context above it; the notes show the render path from the entry point.",
      summary: "a component that reads a required context, rendered with no Provider above it",
      defaultSeverity: "error",
      tier: "core",
      group: "providers",
      needsTypes: { library: "React", modules: ["react"] },
      widenedBy: ["react-router", "dynamic-components"],
      options: OPTIONS,
      explain: EXPLAIN,
    },
    summarize: sharedSummary,
    check: (summaries, ctx) => {
      checkSummaries(summaries, entries, ctx, ctx.options.ignore);
    },
  });
}
