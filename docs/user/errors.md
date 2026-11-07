# Errors: what can throw, and who handles it

TypeScript does not track what a function can throw. A `catch (e)` gets `unknown`, and the compiler
reports nothing when a new error starts reaching it. The errors pack infers what each function can
throw from the code, its `@throws` tags and the packages it calls, and shows the result in the
editor and in `check`.

## What it shows

In VS Code:

- **A grey hint after a function's signature** with the errors it can throw, or reject with for an
  async function: `throws NotFoundError | ParseError`. When part of it is unknown, the hint says
  where the unknown part comes from: ``throws ParseError (unknown from `fetchAvatar`)``.
- **A grey hint after a `catch` variable** with what its `try` can throw:
  `catch (e: NotFoundError | ParseError)`.
- **Hover** a function or a hint to see where each error comes from, call by call.
- **The lightbulb on a `catch (e)`** that handles everything the same way offers "Handle the known
  errors here, rethrow the rest". It keeps your code for the errors stateward knows and rethrows
  the others:

  ```ts
  // before
  try {
    await saveOrder(order);
  } catch (e) {
    toast("Could not save");
  }

  // after
  try {
    await saveOrder(order);
  } catch (e) {
    if (e instanceof NetworkError || e instanceof ValidationError) {
      toast("Could not save");
    } else {
      throw e;
    }
  }
  ```

  It is offered only when the result compiles. `--fix` never applies it, because rethrowing
  changes what happens to the errors it did not know.

In the terminal and CI, the rules report what is missing:

| Rule | Reports |
| --- | --- |
| [catch-misses-error](../rules/errors/catch-misses-error.md) | A `catch` that branches with `instanceof` but misses an error its `try` can throw |
| [catch-hides-unexpected](../rules/errors/catch-hides-unexpected.md) | A `catch` that handles some errors and discards all the others |
| [throws-doc-mismatch](../rules/errors/throws-doc-mismatch.md) | A `@throws` tag that misses an error the function can throw, or lists one it cannot |
| [must-handle-error](../rules/errors/must-handle-error.md) | A call that can throw an error you marked `@mustHandle`, with no `catch` for it |
| [finally-can-throw](../rules/errors/finally-can-throw.md) | A `finally` that can throw and replace the error in flight |
| [render-throw-without-boundary](../rules/errors/render-throw-without-boundary.md) | A component that can throw while rendering, with no error boundary above it |
| [result-ignored](../rules/errors/result-ignored.md), [result-unchecked](../rules/errors/result-unchecked.md) | A returned failure (a `Result`, `{ error }`) that is ignored or used without a check |

## Turn it on

```bash
npm install --save-dev @stateward/plugin-errors
```

```ts
import { defineConfig } from "stateward";
import { errors } from "@stateward/plugin-errors";

export default defineConfig({ plugins: [errors()], preset: "recommended" });
```

The hints and the hover come from `errors/throws-doc-mismatch` and show once that rule is on. Both
presets include it; with `rollout: true`, it is on once `stateward next` reaches it. The hints
appear after the first project check. To hide them, set `stateward.inlayHints.throws` or
`stateward.inlayHints.catchVariable` to `false` in VS Code's settings.

## Where the answers come from

For each call, stateward takes the first source that answers:

1. **Your code.** It follows what each function throws through the functions it calls, across
   files: `throw new X()`, rethrows, and what a `catch` lets through.
2. **Your `@throws` tags.** `/** @throws {NotFoundError} */` on a function, also on one declared
   without a body (`declare function`, a `.d.ts` in your project).
3. **Your config's `facts`**, for a package that does not say:
   `facts: { axios: { get: { throws: ["AxiosError"] } } }`.
4. **The package**: `@throws` tags in its `.d.ts`, or its JavaScript, read the same way as your
   code.
5. **Unknown** otherwise. stateward reports it as unknown and does not guess. `npx stateward deps`
   lists the library calls still unknown, so that `facts` can be added for the ones that matter.

## State your intent

Three JSDoc tags state what a type cannot express:

- `@throws {X}`: this function can throw `X`. `throws-doc-mismatch` keeps the tag true.
- `@mustHandle`: on an error class, every call that can throw it must catch it by name or pass it
  on with `@throws`. Use it for errors with a real recovery (a payment declined, a session expired).
- `@neverRejects`: on a function or a callback prop, it catches and reports its own failures, so
  the async rules do not ask its callers to.

## Limits

- Errors from the runtime's own checks, such as a `TypeError` from reading a property of
  `undefined` or a `RangeError`, are not tracked. They are bugs, not states to handle.
- A call through a value stateward cannot resolve, such as a callback passed in or `any`, is
  unknown.
- Hints need the first project check to finish, so they appear shortly after VS Code starts.
