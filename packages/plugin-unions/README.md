# @stateward/plugin-unions

The `unions` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a `switch` or `if` chain that misses a case of a union, today or after someone adds one, and a tag that cannot tell the cases apart.

```bash
npm install --save-dev stateward @stateward/plugin-unions
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { unions } from "@stateward/plugin-unions";

export default defineConfig({
  plugins: [unions()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/unions.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/unions.md).
