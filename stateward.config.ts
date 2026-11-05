// stateward checks its own source (docs/quality.md, "stateward checks itself"). The packs are
// imported from the built packages of this clone, so run `pnpm run build` first.
import { defineConfig } from "./packages/core/dist/index.js";
import { asyncFlow } from "./packages/plugin-async/dist/index.js";
import { errors } from "./packages/plugin-errors/dist/index.js";
import { ownership } from "./packages/plugin-ownership/dist/index.js";
import { records } from "./packages/plugin-records/dist/index.js";
import { reducers } from "./packages/plugin-reducers/dist/index.js";
import { unions } from "./packages/plugin-unions/dist/index.js";

export default defineConfig({
  // Every package's source project; tests are separate projects (test/tsconfig.json) and left out.
  tsconfig: [
    "packages/cli/tsconfig.json",
    "packages/core/tsconfig.json",
    "packages/language-server/tsconfig.json",
    "packages/plugin-async/tsconfig.json",
    "packages/plugin-errors/tsconfig.json",
    "packages/plugin-ownership/tsconfig.json",
    "packages/plugin-react/tsconfig.json",
    "packages/plugin-react-context/tsconfig.json",
    "packages/plugin-records/tsconfig.json",
    "packages/plugin-reducers/tsconfig.json",
    "packages/plugin-unions/tsconfig.json",
    "packages/vscode/tsconfig.json",
  ],
  // No React code here, so no React packs.
  plugins: [unions(), records(), asyncFlow(), errors(), ownership(), reducers()],
  preset: "recommended",
  addons: ["records/keyed-maps", "errors/catch-intent", "errors/narrow-try"],
  // Fixtures are deliberately bad code.
  exclude: ["**/test/**", "**/fixtures/**", "**/dist/**", "**/node_modules/**"],
});
