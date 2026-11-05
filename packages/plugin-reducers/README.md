# @stateward/plugin-reducers

The `reducers` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a reducer state no event reaches, and one the reducer never leaves.

```bash
npm install --save-dev stateward @stateward/plugin-reducers
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { reducers } from "@stateward/plugin-reducers";

export default defineConfig({
  plugins: [reducers()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/reducers.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/reducers.md).
