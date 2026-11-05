# @stateward/plugin-async

The `async` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a pending flag left set when the awaited call fails, and an async handler whose failure nobody sees.

```bash
npm install --save-dev stateward @stateward/plugin-async
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { asyncFlow } from "@stateward/plugin-async";

export default defineConfig({
  plugins: [asyncFlow()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/async.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/async.md).
