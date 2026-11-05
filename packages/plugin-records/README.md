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
  "records/keyed-maps-out-of-sync": ["warning", { minFunctions: 1 }],
},
```

Add-on rules stay off until you list their add-on:

```ts
addons: ["records/keyed-maps"],
```

- `records/keyed-maps`: `keyed-maps-out-of-sync`

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [duplicate-key](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/duplicate-key.md) | A new Map([...]) or new Set([...]) written out in code has the same key twice, so the second replaces the first. | Core | error | error |
| [lookup-misses-key](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/lookup-misses-key.md) | A lookup like labels[status] has an entry for every value of the key, or handles a missing one. | Core | error | error |
| [table-type-too-loose](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/table-type-too-loose.md) | A lookup table typed `Record<string, V>` says neither "these are all the keys" nor "keys come from outside"; say which in its type. | Core | error | error |
| [keyed-maps-out-of-sync](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/records/keyed-maps-out-of-sync.md) | Two records kept in step must lose a key together: a key removed from one and forgotten in the other is reported. (heuristic) | Add-on `keyed-maps` | warning | warning |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/records.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/records.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
