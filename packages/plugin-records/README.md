# @stateward/plugin-records

The `records` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a lookup like `labels[status]` that misses a key, a table typed too loosely to be checked, a key written twice, and maps keyed alike that drift apart.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-records
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { records } from "@stateward/plugin-records";

export default defineConfig({
  plugins: [records()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "records/duplicate-key": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "records/ambiguous-table": ["error", { ignore: [] }],
},
```

Add-on rules stay off until you list their add-on:

```ts
addons: ["records/unchecked-key"],
```

- `records/unchecked-key`: `unchecked-key`

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [ambiguous-table](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/ambiguous-table.md) | a lookup table typed `Record<string, V>` that says neither "all keys" nor "keys from outside" | A table typed `Record<string, V>` does not say whether its keys are fixed or come from outside, so a misspelt or missing key compiles and the read gives `undefined`. | Core | error | error |
| [duplicate-key](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/duplicate-key.md) | the same key twice in a `new Map([...])` or `new Set([...])` written out in code | The same key twice in a `new Map([...])` or `new Set([...])` keeps only the last entry, so the first one has no effect. | Core | error | error |
| [lookup-misses-key](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/lookup-misses-key.md) | a lookup like `labels[status]` with no entry for some value of the key | A lookup like `labels[status]` is typed as always present; a value with no entry gives `undefined`, and the page shows "undefined" or the next call throws. | Core | error | error |
| [unchecked-key](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/unchecked-key.md) | a key cast (`as keyof typeof LABELS`) or `in` test used to read a table without an own-key check | A cast such as `status as keyof typeof LABELS` tells TypeScript that `status` is a key of `LABELS` without checking it, so `LABELS[status]` compiles and can give `undefined` or an inherited value. | Add-on `unchecked-key` | warning | warning |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/records.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/records.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
