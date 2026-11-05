import { defineConfig } from "../../../src/index.js";
import { first } from "./plugin.js";

export default defineConfig({
  plugins: [first],
  rules: { "first/sized": ["error", { mode: "c" }] },
});
