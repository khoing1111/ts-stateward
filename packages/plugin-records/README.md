# @stateward/plugin-records

The `records` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a lookup like `labels[status]` that misses a key, a table typed too loosely to be checked, a key written twice, and maps keyed alike that drift apart.

```bash
npm install --save-dev stateward @stateward/plugin-records
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { records } from "@stateward/plugin-records";

export default defineConfig({
  plugins: [records()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/records.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/records.md).
