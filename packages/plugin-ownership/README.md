# @stateward/plugin-ownership

The `ownership` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds module-level state that several files change instead of the one that owns it, and a brand (`OrderId`) built outside its owner.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-ownership
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { ownership } from "@stateward/plugin-ownership";

export default defineConfig({
  plugins: [ownership()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "ownership/state-written-outside-owner": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "ownership/brand-built-outside-owner": ["error", { predicates: true }],
},
```

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [brand-built-outside-owner](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/ownership/brand-built-outside-owner.md) | A branded value that has a check is built only by that check, in the file that declares the brand. | Core | error | error |
| [state-written-outside-owner](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/ownership/state-written-outside-owner.md) | Shared module-level state is changed only by the module that declares it; others call its functions. | Core | error | error |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/ownership.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/ownership.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
