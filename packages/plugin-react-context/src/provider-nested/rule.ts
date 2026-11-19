import { defineRule, option } from "@stateward/core";
import { singleSummary } from "../provider-missing/extract.js";
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

## Getting the best from it

Add \`SingleProvider\` to the context's type. Copy the type into \`guarantees.ts\` (the file \`RequiredContext\`'s quick fix writes) if it is not there yet:

\`\`\`ts
export type SingleProvider<T = unknown> = T & { readonly "__guarantee:single-provider"?: true };
\`\`\`

It combines with \`RequiredContext\`, side by side: \`const StoreContext: RequiredContext<Store> & SingleProvider = requiredContext<Store>();\`. The marker exists only in the type; it adds no code.

It follows the render tree from \`createRoot(…).render(…)\` and the \`entries\` option, as \`react-context/provider-missing\` does: \`children\`, render props, components passed as props, and the add-ons' dynamic components and routes. A Provider is reported when another Provider of the same context is around it in the same JSX, or above the component that renders it. The finding is at the render that brings in the second Provider; the notes show the outer one and the inner one. A Provider outside any component (in a plain function) cannot be followed, and is an error, since the context states the trait.

The proof reads every place a Provider can be rendered. It follows a component's \`children\` and the props that hold JSX through the components that render them in JSX; those are the forms it reads, and everything else is "not checked". It does not follow a slot its component hands to a call or stores (\`wrap(children)\`, \`{ child: children }\`), or an element passed to a function or returned by a function that is not a component (\`toast(<Inner/>)\`, \`const wrapInner = (c) => <Inner>{c}</Inner>\`). A second Provider may be there, so each such place is listed as "not checked: \`wrap(children)\` in \`<Wrap>\` cannot be followed" (an info with \`--verbose\`), and the guarantee reads "not checked", not an error: the developer keeps the say. The same for a Provider given to such a slot, written in a callback of its component (\`useMemo(() => <StoreContext.Provider>…)\`), or kept in a variable (\`const inner = <StoreContext.Provider>…</StoreContext.Provider>\`). A slot that is only looked at (\`children ? … : …\`, \`children.length\`) is not a place. A Provider the proof does see under another one is an error.

Every reference to the context is read, or listed as "not checked" at its place in \`stateward guarantees\`: a Provider the walk lists is read, and a reader is not about Providers. Another name for the context (\`const C = StoreContext; <C value={…}>\`), and the context or its Provider passed to a call or kept in a literal, are not checked.

## Turn it on or off

\`\`\`ts
rules: { "react-context/provider-nested": "off" }
\`\`\`

The rule only reads a context stated \`SingleProvider\`, so a second Provider that is meant is stated by removing \`SingleProvider\` from that context's type, not by silencing the rule: the type then says two Providers are fine. The \`ignore\` option no longer leaves a context out: a guarantee the code states is always checked, whatever the options say.
`;

const OPTIONS = {
  ignore: option.strings({
    default: [],
    description:
      "Has no effect: a context stated `SingleProvider` is always checked, and the rule reads no other. Remove `SingleProvider` from its type to allow more than one Provider.",
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
      proves: { traits: ["single-provider"], made: ["single-provider"] },
      needsTypes: { library: "React", modules: ["react"] },
      widenedBy: ["react-router", "dynamic-components"],
      options: OPTIONS,
      explain: EXPLAIN,
    },
    summarize: singleSummary,
    check: (summaries, ctx) => {
      checkNested(summaries, entries, ctx);
    },
  });
}
