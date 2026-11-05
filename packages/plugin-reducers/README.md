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

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [state-cannot-leave](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/reducers/state-cannot-leave.md) | A state a reducer reaches but never leaves is marked final, so a missing way out does not go unnoticed. | Core | warning | warning |
| [state-unreachable](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/reducers/state-unreachable.md) | A state of a reducer that no event can lead to. | Core | error | error |
| [reducer-not-readable](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/reducers/reducer-not-readable.md) | A place in or around a reducer that stateward cannot read, so its other reducer checks cannot cover it. | Coverage | info | error |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/reducers.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/reducers.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
