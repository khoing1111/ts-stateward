import { defineRule, option } from "@stateward/core";
import { sharedSummary } from "../provider-missing/extract.js";
import type { EntryPoint } from "../provider-missing/options.js";
import type { Summary } from "../provider-missing/summary.js";
import { checkNested } from "./check.js";

const EXPLAIN = `# react-context/provider-nested

Reports a Provider of a context stated \`SingleProvider\` that is rendered under another Provider of the same context; the outer one is a note.

\`\`\`ts example-bad file=guarantees.ts
export type SingleProvider<T = unknown> = T & { readonly "__guarantee:single-provider"?: true };
\`\`\`

\`\`\`tsx example-bad file=store.tsx
import { createContext, useContext, useState, type Context, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { SingleProvider } from "./guarantees";

type Store = { items: string[] };
const StoreContext: Context<Store | undefined> & SingleProvider = createContext<
  Store | undefined
>(undefined);

function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<Store>(() => ({ items: [] }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function CartCount() {
  return <p>{useContext(StoreContext)?.items.length}</p>;
}

function Cart() {
  return (
    <StoreProvider>
      <CartCount />
    </StoreProvider>
  );
}

createRoot(document.body).render(
  <StoreProvider>
    <Cart />
  </StoreProvider>,
);
\`\`\`

\`<Cart>\` creates a second store, so \`<CartCount>\` reads an empty cart while the rest of the app reads the real one. Render the store's Provider once, at the top:

\`\`\`tsx example-good file=store.tsx
import { createContext, useContext, useState, type Context, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { SingleProvider } from "./guarantees";

type Store = { items: string[] };
const StoreContext: Context<Store | undefined> & SingleProvider = createContext<
  Store | undefined
>(undefined);

function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<Store>(() => ({ items: [] }));
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function CartCount() {
  return <p>{useContext(StoreContext)?.items.length}</p>;
}

function Cart() {
  return <CartCount />;
}

createRoot(document.body).render(
  <StoreProvider>
    <Cart />
  </StoreProvider>,
);
\`\`\`

## Why it matters

A store, a cache or a session is meant to exist once. A second Provider under the first gives the components below it a separate copy: they read and change that copy, and the rest of the app does not see the changes. Nothing fails; the screen shows two different states.

## What it does not catch

- Providers of a context declared outside the checked files, and Providers in tests and stories.
- A Provider that a class component renders, or that JSX passed to a function renders: those places are not followed.

## Getting the best from it

Add \`SingleProvider\` to the context's type. Copy the type into \`guarantees.ts\` (the file \`RequiredContext\`'s quick fix writes) if it is not there yet:

\`\`\`ts
export type SingleProvider<T = unknown> = T & { readonly "__guarantee:single-provider"?: true };
\`\`\`

It combines with \`RequiredContext\`, side by side: \`const StoreContext: RequiredContext<Store> & SingleProvider = requiredContext<Store>();\`. The marker exists only in the type; it adds no code.

It follows the render tree from \`createRoot(…).render(…)\` and the \`entries\` option, as \`react-context/provider-missing\` does: \`children\`, render props, components passed as props, and the add-ons' dynamic components and routes. A Provider is reported when another Provider of the same context is around it in the same JSX, or above the component that renders it. The finding is at the render that brings in the second Provider; the notes show the outer one and the inner one. A Provider outside any component (in a plain function) cannot be followed, and is an error, since the context states the trait.

## Turn it on or off

\`\`\`ts
rules: { "react-context/provider-nested": "off" }
rules: { "react-context/provider-nested": ["error", { ignore: ["ThemeContext"] }] } // nested on purpose
\`\`\`
`;

const OPTIONS = {
  ignore: option.strings({
    default: [],
    description: "Contexts (names or globs) whose nested Providers are not reported.",
  }),
  lazyFunctions: option.strings({
    default: [],
    description:
      'Your own wrappers of React\'s `lazy`, by name (like ["lazyComponent"]), as in `provider-missing`.',
  }),
};

export function createProviderNested(entries: readonly EntryPoint[]) {
  return defineRule<Summary, typeof OPTIONS>({
    kind: "project",
    meta: {
      description:
        "Reports a Provider of a context stated `SingleProvider` that is rendered under another Provider of the same context; the outer one is a note.",
      summary: "a Provider of a context stated `SingleProvider`, rendered under another one",
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
      checkNested(summaries, entries, ctx, ctx.options.ignore);
    },
  });
}
