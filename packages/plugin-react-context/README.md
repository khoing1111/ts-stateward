# @stateward/plugin-react-context

The `react-context` pack of [stateward](https://github.com/khoing1111/ts-stateward#readme). It finds a context with a fake default (`createContext({} as Theme)`), and a component rendered outside its Provider.

```bash
npm install --save-dev stateward @stateward/plugin-react-context
```

```ts
// stateward.config.ts
import { defineConfig } from "stateward";
import { reactContext } from "@stateward/plugin-react-context";

export default defineConfig({
  plugins: [reactContext()],
  preset: "recommended",
});
```

`npx stateward init` writes this for you. The rules, their options and how to fix what they find:
[docs/packs/react-context.md](https://github.com/khoing1111/ts-stateward/blob/main/docs/packs/react-context.md).
