# @stateward/plugin-unions

The `unions` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a `switch` or `if` chain that misses a case of a union, today or after someone adds one, and a tag that cannot tell the cases apart.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-unions
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { unions } from "@stateward/plugin-unions";

export default defineConfig({
  plugins: [unions()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "unions/if-chain-misses-case": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "unions/default-hides-cases": ["error", { maxHidden: 5 }],
},
```

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [default-hides-cases](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/unions/default-hides-cases.md) | A switch over a union handles every case, so a value added later fails to compile instead of falling into the default. | Core | error | error |
| [if-chain-misses-case](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/unions/if-chain-misses-case.md) | An if / else if chain over a union handles every case, so a value added later fails to compile. | Core | error | error |
| [tag-does-not-discriminate](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/unions/tag-does-not-discriminate.md) | A property like kind that tells a union's members apart is a literal in every member, not string or number in one. | Coverage | info | error |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/unions.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/unions.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
