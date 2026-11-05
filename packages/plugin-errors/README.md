# @stateward/plugin-errors

The `errors` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a `catch` that misses an error class or hides the unexpected ones, an error lost in `finally`, a `Result` nobody checks, and a component that can throw with no error boundary above it. In VS Code, hints name the errors a function can throw.

## Contents

- [Turn it on](#turn-it-on)
- [Rules](#rules)

<!-- generated:setup -->

## Turn it on

```bash
npm install --save-dev stateward @stateward/plugin-errors
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { errors } from "@stateward/plugin-errors";

export default defineConfig({
  plugins: [errors()],
  preset: "recommended", // or "strict"
});
```

`npx stateward init` writes this for you. A preset turns on the core and coverage rules; without one
no rule is on.

One rule's severity (`error`, `warning`, `info` or `off`), and its options, go under `rules`:

```ts
rules: {
  "errors/must-handle-error": "warning",
  // a severity and options; this option is at its default, the rule's page lists them all
  "errors/result-ignored": ["error", { allowVoid: false }],
},
```

Add-on rules stay off until you list their add-on:

```ts
addons: ["errors/catch-intent", "errors/narrow-try"],
```

- `errors/catch-intent`: `catch-without-intent`
- `errors/narrow-try`: `narrow-try`

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- |
| [must-handle-error](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/must-handle-error.md) | An error class marked @mustHandle is named in a catch or passed on with @throws by every call that can throw it. | Core | error | error |
| [result-ignored](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/result-ignored.md) | The Result of a call is checked or passed on, not dropped as a statement, after void or after await. | Core | error | error |
| [result-unchecked](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/result-unchecked.md) | A call that reports failure in its value, not by throwing, is checked before the code goes on as if it worked. (heuristic) | Core | warning | warning |
| [throws-doc-mismatch](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/throws-doc-mismatch.md) | A function's @throws tag lists exactly the error classes it can throw, as far as stateward can see. | Core | error | error |
| [catch-hides-unexpected](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/catch-hides-unexpected.md) | A catch that handles some errors with instanceof also rethrows or handles all the others. | Core | error | error |
| [catch-misses-error](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/catch-misses-error.md) | A catch that branches with instanceof handles every error class its try can throw, or rethrows the rest; so does an error boundary's fallback. | Core | error | error |
| [finally-can-throw](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/finally-can-throw.md) | A finally block does not call something that throws, so the error that led to it is not lost. | Core | error | error |
| [catch-without-intent](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/catch-without-intent.md) | Experimental: on real projects it is mostly wrong; it may change or be removed. A catch that handles every error says how: it narrows, reports, or falls back; one that only logs, or calls something stateward cannot judge, and carries on is reported. (heuristic) | Add-on `catch-intent` | warning | warning |
| [narrow-try](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/narrow-try.md) | Calls to your own code placed in a `try` after the call it is for: move them after the `try`. | Add-on `narrow-try` | warning | warning |
| [render-throw-without-boundary](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/render-throw-without-boundary.md) | A component that can throw a known error while rendering has an error boundary above it. | Core | warning | warning |

Kind: **Core** rules are on in every preset. **Coverage** rules ask your types to say more; they
are info under `recommended` and errors under `strict`. **Add-on** rules stay off until you list
their add-on in `addons`; the table shows their severity once it is listed. A heuristic rule
guesses, so it is never an error unless you set it.

Each rule's page says why it matters, what it catches and misses, how to fix what it finds, and its options. The pack's page: [docs/packs/errors.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/errors.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
