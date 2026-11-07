import { defineRule, matchesName, option } from "@stateward/core";
import { freshDependency, unknownDependency } from "./messages.js";
import { analyse, locationOf, usesOf } from "./resolve.js";
import { summarizeFile } from "./summary.js";

const EXPLAIN = `# react/dependency-changes-every-render

A dependency that a hook in the project creates on every render makes the effect or \`useMemo\` run on every render, and a \`memo\` child render every time.

The hook in \`cart.ts\` creates a function inline:

\`\`\`ts example-bad file=cart.ts
import { useState } from "react";

declare function saveCart(items: string[]): void;

export function useCart() {
  const [items, setItems] = useState<string[]>([]);
  const onSave = () => saveCart(items);
  return { items, setItems, onSave };
}
\`\`\`

\`CartPage.tsx\` depends on it in an effect:

\`\`\`tsx example-bad file=CartPage.tsx
import { useEffect } from "react";
import { useCart } from "./cart.js";

export function CartPage() {
  const { items, onSave } = useCart();
  useEffect(() => {
    const timer = setInterval(onSave, 5000);
    return () => clearInterval(timer);
  }, [onSave]);
  return <p>{items.length} items</p>;
}
\`\`\`

Make the value stable where the hook creates it, in \`cart.ts\`, which fixes every caller at once:

\`\`\`ts example-good file=cart.ts
import { useCallback, useState } from "react";

declare function saveCart(items: string[]): void;

export function useCart() {
  const [items, setItems] = useState<string[]>([]);
  const onSave = useCallback(() => saveCart(items), [items]);
  return { items, setItems, onSave };
}
\`\`\`

The finding is at the dependency, where the cost shows; a note points at the place in the hook that creates the value, and the fix line says how to make it stable there, depending on why it is new:

- a function that uses nothing from its hook or component: move it to module scope, where it never changes (a quick fix, when it is a \`const\` or \`function\` in the body that calls no hook);
- a fresh result of a plain function of yours (\`const columns = getColumns(prefix)\`): wrap the call in \`useMemo\` on its inputs (\`useMemo(() => getColumns(prefix), [prefix])\`); when an argument is itself new every render, the message says to make that argument stable first;
- a function that uses only parameters of its hook, and that your code calls where it uses it: make those parameters of the function, and pass them at the call;
- a function passed as an \`on…\` prop to a \`memo\` component: keep the latest handler in a ref (React's \`useEffectEvent\`, or your own hook, named when \`stableHooks\` lists it);
- any other function, object or array: wrap it in \`useCallback\` or \`useMemo\` where it is created.

## Why it matters

An effect runs again whenever a dependency is a different value from the last render. A function or object that a custom hook creates inline is a new value on every render, so the effect above clears and restarts its timer after every render, and a request sent from one would be sent again and again, or a \`setState\` would loop. Nothing in the component shows it: the cause is inside the hook, often in another file.

## When it says “not checked”

When the value comes from a hook in the project that stateward cannot read (built by a factory, \`const useCart = createStore(…)\`, or returning another object's method result), it lists the place as not checked, with how to make it checkable. \`stateward check\` counts these places in its summary and lists them with \`--verbose\` (or \`stateward coverage\`). When you know such a hook returns the same values on each render, name it in \`stableHooks\`.

## What it does not catch

It looks at the dependencies of \`useEffect\`, \`useLayoutEffect\`, \`useInsertionEffect\`, \`useMemo\` and \`useCallback\`, and the props of a \`memo\` component, whose value one of your functions creates on every render: an inline function, an object or array literal, \`new X()\`, or a new array from \`map\`, \`filter\`, \`Object.keys\` and the like. It follows the value through destructuring, property access and hooks calling hooks, across files. It is silent on:

- a value declared next to the effect, in the same component or hook: \`exhaustive-deps\` from \`eslint-plugin-react-hooks\` covers those, but it does not see through a custom hook's return, which is why this rule exists;
- a value from a package's hook (a data-fetching or form library), including hooks a package builds for you (\`create<State>()(…)\`, \`useSelector.withTypes<State>()\`, RTK Query's \`export const { useGetItemsQuery } = api\`) and your own names for them: package code is not read. Some are known to return the same value each render, by the package they come from: react-redux's \`useDispatch()\` and \`useStore()\`, react-router's \`useNavigate()\`, React's state setters and \`dispatch\`, and from RTK Query hooks the trigger of \`use…Mutation()\` and \`useLazy…Query()\`, \`refetch\` and \`data\`;
- a prop of a component with its own comparison, \`memo(Row, compare)\`;
- a value from a parameter or a prop: it comes from the caller's code;
- a \`let\` assigned in a branch the rule cannot see, and a destructuring default (\`const { items = [] } = useCart()\`);
- apps built with the React Compiler (\`babel-plugin-react-compiler\` or \`react-compiler-runtime\` in the nearest \`package.json\`): the compiler keeps these values stable.

A data value built only from the state whose change causes the render (\`swatch\` built from \`hsva\`) really changes with that state, so making it stable gains nothing: it is reported as info only (the \`derived\` kind of \`severities\`).

## Getting the best from it

A plain function of yours that memoizes its result (a \`WeakMap\` or \`Map\` per argument, \`memoize-one\`) returns the same value for the same arguments, which stateward cannot see. Name it in \`stableFunctions\`: its value then counts as stable when none of its arguments is new every render (\`bindRunHandlers(run)\` is, \`bindRunHandlers({ ...run })\` is not).

## Turn it on or off

\`\`\`ts
rules: { "react/dependency-changes-every-render": ["warning", { stableHooks: ["useStableCardHandlers", "use*Store"] }] } // your hooks whose values never change
rules: { "react/dependency-changes-every-render": ["warning", { stableFunctions: ["bindRunHandlers"] }] } // your memoized functions
rules: { "react/dependency-changes-every-render": ["warning", { ignore: ["useLegacyForm"] }] } // accept one hook's new values
rules: { "react/dependency-changes-every-render": "off" }
\`\`\`
`;

export const dependencyChangesEveryRender = defineRule({
  kind: "project",
  meta: {
    description:
      "A dependency that a hook in the project creates on every render makes the effect or `useMemo` run on every render, and a `memo` child render every time.",
    summary: "an effect or memo dependency that a hook in the project creates anew on every render",
    defaultSeverity: "warning",
    tier: "core",
    group: "render",
    needsTypes: { library: "React", modules: ["react"] },
    options: {
      memoProps: option.boolean({
        default: true,
        description:
          "Also check the props passed to `memo` components, not only hook dependencies.",
      }),
      ignore: option.strings({
        default: [],
        description:
          "Your hooks and functions (names or globs like use*Form) whose new values you accept.",
      }),
      stableHooks: option.strings({
        default: [],
        description:
          "Your hooks (names or globs like use*Store) whose every returned value is the same each render. `react/effect-response-race` reads this list too; a name here is also the hook the advice for a handler on a `memo` child suggests.",
      }),
      stableFunctions: option.strings({
        default: [],
        description:
          "Your memoized functions (names or globs like bind*Handlers) that return the same value for the same arguments.",
      }),
      severities: option.severities({
        kinds: {
          "from-hook": "the value is created inside a hook in the project: wrap it there.",
          "from-function":
            "the value comes from a plain function of yours (`getColumns(prefix)`), called here or in a hook: wrap the call.",
          derived:
            "the value is built from the state whose change causes the render, so stabilising it gains nothing (reported as info).",
        },
        description: "A severity per place the new value comes from.",
      }),
    },
    explain: EXPLAIN,
  },
  summarize: (ctx) => summarizeFile(ctx, ctx.options.stableHooks, ctx.options.stableFunctions),
  check(summaries, ctx) {
    const { memoProps, ignore, stableHooks } = ctx.options;
    const analysis = analyse(summaries);
    for (const { file, dependency, value } of usesOf(analysis)) {
      const source = dependency.via.source;
      if (!memoProps && dependency.target.kind === "memo-prop") continue;
      if (value.kind === "fresh") {
        if (matchesName(value.owner.name, ignore)) continue;
        const { derived, ...found } = freshDependency(dependency, source, value, stableHooks);
        ctx.report({
          ...found,
          location: locationOf(file, dependency.at),
          findingKind: derived ? "derived" : value.ownerHook ? "from-hook" : "from-function",
          ...(derived ? { severity: "info" as const } : {}),
        });
      } else {
        ctx.unknown({
          ...unknownDependency(dependency, source, value),
          location: locationOf(file, dependency.at),
        });
      }
    }
    for (const [file, summary] of analysis.summaries) {
      if (summary.compiled) continue;
      for (const dependency of summary.dependencies) {
        if (dependency.via.kind !== "unknown") continue;
        ctx.unknown({
          ...unknownDependency(dependency, dependency.via.source, undefined),
          location: locationOf(file, dependency.at),
        });
      }
    }
  },
});
