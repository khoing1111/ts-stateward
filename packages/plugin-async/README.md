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

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [handler-rejection-lost](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/async/handler-rejection-lost.md) | an async `onClick`, listener or timer callback whose failure is never caught | No code awaits an event handler or a timer callback, so its failure is an unhandled rejection the user never sees; a `catch` inside it can show the error. | Core | error | error |
| [pending-state-stuck-on-failure](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/async/pending-state-stuck-on-failure.md) | a "loading" state set before an `await` that stays set when the call fails (guess) | When the awaited call fails, a state set to "loading" before it stays set and the spinner shows until reload; resetting it in `finally` prevents that. | Core | warning | warning |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/async.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/async.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
