# @stateward/plugin-ownership

The `ownership` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds module-level state that several files change instead of the one that owns it, and a brand (`OrderId`) built outside its owner.

```bash
npm install --save-dev stateward @stateward/plugin-ownership
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { ownership } from "@stateward/plugin-ownership";

export default defineConfig({
  plugins: [ownership()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/ownership.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/ownership.md).
