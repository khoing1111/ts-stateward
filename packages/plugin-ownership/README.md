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

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [brand-built-outside-owner](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/ownership/brand-built-outside-owner.md) | a cast to a checked brand like `as Positive` outside the file that owns its check | A cast to a checked brand like `Positive` outside its check skips the validation the brand stands for, so the type promises more than the value holds. | Core | error | error |
| [state-written-outside-owner](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/ownership/state-written-outside-owner.md) | shared module state changed by a file other than the one that declares it | When several modules change the same module-level state, each change must be read to know its value; one owning module with functions keeps that in one place. | Core | error | error |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/ownership.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/ownership.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
