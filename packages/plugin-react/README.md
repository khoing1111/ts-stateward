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
addons: ["react/effect-race"],
```

- `react/effect-race`: `effect-response-race` (checks more with it)

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [effect-copies-derived-value](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-copies-derived-value.md) | an effect that only copies a value computed from props or state into state | Copying a computed value into state in an effect adds a render that shows the old value first; computing it while rendering shows the new value at once. | Core | warning | warning |
| [effect-loops](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-loops.md) | an effect that sets, every time it runs, a state it depends on: a render loop | An effect that sets one of its own dependencies to a new value each time it runs triggers itself again, so the component renders without end. | Core | error | error |
| [effect-missing-cleanup](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-missing-cleanup.md) | an effect that starts a listener, timer, subscription or connection and never stops it | A listener, timer or subscription that an effect starts and never stops keeps running after unmount, and each run of the effect adds another one. | Core | warning | warning |
| [effect-response-race](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/effect-response-race.md) | an effect that calls a loader taking an `AbortSignal` and does not abort it in its cleanup | Without an abort in the cleanup, the response to an old request can arrive after a newer one and replace the newer data on screen. | Core | error | error |
| [timer-runs-after-unmount](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/timer-runs-after-unmount.md) | a timer kept in a ref, never cleared on unmount, that navigates or calls out later | A timer kept in a ref and not cleared on unmount still runs after the component is gone, and can navigate or call out from a page the user left. | Core | warning | warning |
| [dependency-changes-every-render](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/dependency-changes-every-render.md) | an effect or memo dependency that a hook in the project creates anew on every render | A dependency that a hook in the project creates on every render makes the effect or `useMemo` run on every render, and a `memo` child render every time. | Core | warning | warning |
| [index-key-on-reordered-list](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/index-key-on-reordered-list.md) | `key={index}` on a list that is filtered, sorted or added to at the front (guess) | With `key={index}` on a list that is filtered or reordered, React keeps each row's state by position, so the state moves to a different item. | Core | warning | warning |
| [closure-reads-stale-state](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/closure-reads-stale-state.md) | a timer, listener or callback that sets state from a value captured in an old render | A timer or listener created in an earlier render reads the state of that render; setting state from it overwrites newer values, which an updater avoids. | Core | warning | warning |
| [state-copies-prop](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react/state-copies-prop.md) | a state copied from a prop and kept in sync by an effect | A state that copies a prop, kept in sync by an effect, differs from the prop for one render after each change and can overwrite what the user typed. | Core | warning | warning |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/react.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
