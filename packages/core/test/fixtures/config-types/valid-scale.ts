import { defaults, defineConfig } from "../../../src/index.js";
import { first, second } from "./plugin.js";

const team = defineConfig({
  plugins: [first],
  rules: { "first/sized": ["error", { max: 5 }] },
});

export default defineConfig({
  extends: [team],
  plugins: [second],
  exclude: [...defaults.exclude, "src/generated/**"],
  overrides: [
    { files: ["src/legacy/**"], rules: { "first/plain": "off", "second/plain": "warning" } },
    { files: ["src/payments/**"], preset: "strict", groups: { "first/sizing": "error" } },
  ],
  ignores: { requireReason: true, reportUnused: "off" },
  unknowns: "warning",
});
