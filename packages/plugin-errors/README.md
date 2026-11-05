# @stateward/plugin-errors

The `errors` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a `catch` that misses an error class or hides the unexpected ones, an error lost in `finally`, a `Result` nobody checks, and a component that can throw with no error boundary above it. In VS Code, hints name the errors a function can throw.

```bash
npm install --save-dev stateward @stateward/plugin-errors
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { errors } from "@stateward/plugin-errors";

export default defineConfig({
  plugins: [errors()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/errors.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/errors.md).
