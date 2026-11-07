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

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [default-hides-cases](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/unions/default-hides-cases.md) | a `default` that handles cases the switch does not list, or that has no `never` check | A case added to the union later goes to the `default` with no compile error; listing the cases makes each switch fail to compile until it handles the new case. | Core | error | error |
| [if-chain-misses-case](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/unions/if-chain-misses-case.md) | an `if` / `else if` chain over a union that misses a case or has no `never` check | A case added to the union later goes to the last `else` with no compile error; testing every case and checking the rest with `never` makes the chain fail to compile. | Core | error | error |
| [tag-does-not-discriminate](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/unions/tag-does-not-discriminate.md) | a tag like `kind` that is `string` in one member, so a test on it does not pick a member | When `kind` is `string` in one member, testing `kind` does not narrow the union, so TypeScript cannot check which properties each branch reads. | Coverage | info | error |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/unions.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/unions.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
