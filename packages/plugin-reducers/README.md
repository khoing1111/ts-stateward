# @stateward/plugin-reducers

The `reducers` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a reducer state no event reaches, and one the reducer never leaves.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-reducers
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { reducers } from "@stateward/plugin-reducers";

export default defineConfig({
  plugins: [reducers()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "reducers/state-unreachable": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "reducers/state-cannot-leave": ["warning", { finalStates: [] }],
},
```

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [state-cannot-leave](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/reducers/state-cannot-leave.md) | a reducer state that nothing leaves and that is not marked final | A reducer state with no way out keeps the user there for good, such as a failed payment with no retry; marking it final records that this is intended. | Core | warning | warning |
| [state-unreachable](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/reducers/state-unreachable.md) | a state of a reducer's union that no event can lead to | A reducer state that no event leads to is code that can never run, often a step that was planned and not written. | Core | error | error |
| [reducer-not-readable](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/reducers/reducer-not-readable.md) | a reducer, or a `return` in one, whose states cannot be read, so the reducer checks skip it | The reducer checks skip a place whose states cannot be read; a type that names its states brings it back under those checks. | Coverage | info | error |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/reducers.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/reducers.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
