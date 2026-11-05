# @stateward/plugin-react

The `react` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds effects and `memo` components that rerun on every render because a hook returns a new function or object; effects that loop, leak or race; state copied from a prop; and flags that allow impossible combinations.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-react
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { react } from "@stateward/plugin-react";

export default defineConfig({
  plugins: [react()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "react/effect-copies-derived-value": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "react/effect-missing-cleanup": ["warning", { observers: ["ResizeObserver", "IntersectionObserver", "MutationObserver"] }],
},
```

Add-on rules stay off until you list their add-on:

```ts
addons: ["react/effect-race", "react/flag-combos"],
```

- `react/effect-race`: `effect-response-race`
- `react/flag-combos`: `flags-allow-impossible-combos`

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [effect-copies-derived-value](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-copies-derived-value.md) | A value computed from props or state is computed while rendering, not copied into state by an effect. | Core | warning | warning |
| [effect-loops](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-loops.md) | An effect does not set, every time it runs, a state it depends on to a new value: that is a render loop. | Core | error | error |
| [effect-missing-cleanup](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-missing-cleanup.md) | An effect that starts a listener, timer, subscription, observer or connection returns a cleanup that stops it. | Core | warning | warning |
| [timer-runs-after-unmount](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/timer-runs-after-unmount.md) | A timer a component keeps in a ref is cleared when the component unmounts, so it cannot run after the component is gone. | Core | warning | warning |
| [effect-response-race](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-response-race.md) | An effect that loads data ignores a response that arrives after its inputs have changed. (heuristic) | Add-on `effect-race` | warning | warning |
| [dependency-changes-every-render](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/dependency-changes-every-render.md) | A dependency of an effect, `useMemo` or `useCallback`, or a prop of a `memo` component, is not a new value that a custom hook creates on every render. | Core | warning | warning |
| [index-key-on-reordered-list](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/index-key-on-reordered-list.md) | A list that is filtered, sorted, reversed, spliced or added to at the front is not keyed by the position of its rows. (heuristic) | Core | warning | warning |
| [provider-value-changes-every-render](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/provider-value-changes-every-render.md) | A context Provider is not given a value created anew on every render. | Core | warning | warning |
| [closure-reads-stale-state](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/closure-reads-stale-state.md) | A state setter called from a timer, a listener or a callback that outlives its render passes an updater function, not a value computed from the state. | Core | warning | warning |
| [state-copies-prop](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/state-copies-prop.md) | A state is not a copy of a prop that an effect keeps in step: one value, one owner. | Core | warning | warning |
| [flags-allow-impossible-combos](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/flags-allow-impossible-combos.md) | Boolean or nullable useState values that are read or set together become one state, so combinations that make no sense cannot happen. (heuristic) | Add-on `flag-combos` | warning | warning |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/react.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
