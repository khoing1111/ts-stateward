# @stateward/plugin-async

The `async` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a pending flag left set when the awaited call fails, and an async handler whose failure nobody sees.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-async
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { asyncFlow } from "@stateward/plugin-async";

export default defineConfig({
  plugins: [asyncFlow()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "async/pending-state-stuck-on-failure": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "async/handler-rejection-lost": ["error", { timers: ["setTimeout", "setInterval", "queueMicrotask"] }],
},
```

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [handler-rejection-lost](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/async/handler-rejection-lost.md) | An async event handler, listener or timer callback catches its own failures, since nothing awaits it. | Core | error | error |
| [pending-state-stuck-on-failure](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/async/pending-state-stuck-on-failure.md) | State set before an await and set again after it is also set again when the await fails, so a failure does not leave it pending. (heuristic) | Core | warning | warning |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/async.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/async.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
