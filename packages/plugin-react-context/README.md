# @stateward/plugin-react-context

The `react-context` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a context with a fake default (`createContext({} as Theme)`), and a component rendered outside its Provider.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-react-context
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { reactContext } from "@stateward/plugin-react-context";

export default defineConfig({
  plugins: [reactContext()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "react-context/provider-missing": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "react-context/fake-default-value": ["info", { ignore: [] }],
},
```

Add-on rules stay off until you list their add-on:

```ts
addons: ["react-context/dynamic-components", "react-context/react-router"],
```

- `react-context/dynamic-components`: `provider-missing` (checks more with it)
- `react-context/react-router`: `provider-missing` (checks more with it)

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [fake-default-value](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react-context/fake-default-value.md) | A React context gets its value from a Provider, not from a fake default like {} as Theme. | Coverage | info | error |
| [provider-missing](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/react-context/provider-missing.md) | A component that reads a required context is rendered under that context's Provider. | Core | error | error |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/react-context.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react-context.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
