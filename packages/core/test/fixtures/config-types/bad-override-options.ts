import { defineConfig } from "../../../src/index.js";
import { first } from "./plugin.js";

export default defineConfig({
  plugins: [first],
  overrides: [{ files: ["src/**"], rules: { "first/sized": ["error", { max: 2 }] } }],
});
