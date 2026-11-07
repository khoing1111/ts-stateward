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
addons: ["errors/narrow-try"],
```

- `errors/narrow-try`: `narrow-try`

Every key of the config: [config.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/user/config.md).

<!-- /generated:setup -->

<!-- generated:rules -->

## Rules

| Rule | What it finds | Why it matters | Kind | `recommended` | `strict` |
| --- | --- | --- | --- | --- | --- |
| [must-handle-error](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/must-handle-error.md) | a call that can throw an error marked `@mustHandle`, with no code that handles or passes it on | An error marked `@mustHandle` needs a decision at each call, such as a message to the user; a call that neither catches it nor passes it on lets it reach the top. | Core | error | error |
| [result-ignored](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/result-ignored.md) | a `Result` dropped as a statement, after `void` or after `await` | A `Result` dropped as a statement discards its error, so a failed call looks the same as a successful one. | Core | error | error |
| [result-unchecked](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/result-unchecked.md) | a call that fails in its value (an RTK Query trigger, a Result) used as if it had worked (guess) | A call that returns its failure instead of throwing never reaches the `catch`; without a check, the code after it runs as if the call worked. | Core | warning | warning |
| [throws-doc-mismatch](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/throws-doc-mismatch.md) | a `@throws` tag that lists an error the function cannot throw, or misses one it can | Callers decide what to catch from `@throws`: a class it omits reaches them unhandled, and a class listed in excess asks them to handle a case that cannot happen. | Core | error | error |
| [catch-hides-unexpected](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/catch-hides-unexpected.md) | a `catch` that handles some error classes with `instanceof` and ignores the rest | A `catch` that tests some error classes and has no last branch ignores every other error, bugs included; rethrowing the rest keeps them visible. | Core | error | error |
| [catch-misses-error](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/catch-misses-error.md) | a `catch` that branches on error classes but misses one its `try` can throw | An error class the `try` can throw and the `catch` does not test goes to the generic branch, or is ignored; a branch for it, or a rethrow, handles it explicitly. | Core | error | error |
| [finally-can-throw](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/finally-can-throw.md) | a `finally` that calls something that can throw and replace the original error | An error thrown in `finally` replaces the error that was already thrown, so the report names the cleanup instead of the original cause. | Core | error | error |
| [narrow-try](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/narrow-try.md) | calls to your own code inside a `try` after the call it is for, so their bugs look like its failure | A bug in code inside a `try` meant for another call is caught and reported as that call's failure; moving the code after the `try` keeps the two apart. | Add-on `narrow-try` | warning | warning |
| [render-throw-without-boundary](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/errors/render-throw-without-boundary.md) | a component that can throw a known error while rendering, with no error boundary above it | An error thrown while rendering, with no error boundary above the component, unmounts the whole React tree and leaves a blank page. | Core | warning | warning |

**Core** rules are on in every preset. **Coverage** rules point at code whose types do not say
enough for stateward to check it; they are info under `recommended` and errors under `strict`.
**Add-on** rules stay off until you list their add-on in `addons`; the table shows their severity
once it is listed. A rule marked (guess) judges from patterns in the code, not only from types, so
it can be wrong and is never an error unless you make it one.

Each rule's page shows an example with what stateward prints for it, the fix, why it matters, what it misses, and its options. The pack's page: [docs/packs/errors.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/errors.md). Every pack's rules: [the rules index](https://github.com/khoing1111/ts-stateward/blob/main/docs/rules/README.md).

<!-- /generated:rules -->
