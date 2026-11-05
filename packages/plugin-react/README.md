# @stateward/plugin-react

The `react` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds effects and `memo` components that rerun on every render because a hook returns a new function or object; effects that loop, leak or race; state copied from a prop; and flags that allow impossible combinations.

```bash
npm install --save-dev stateward @stateward/plugin-react
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { react } from "@stateward/plugin-react";

export default defineConfig({
  plugins: [react()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/react.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react.md).
