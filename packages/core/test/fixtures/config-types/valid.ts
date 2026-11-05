import { defineConfig } from "../../../src/index.js";
import { first, second } from "./plugin.js";

export default defineConfig({
  plugins: [first, second],
  groups: { "first/sizing": "warning", "first/g": "off", "second/g": "info" },
  rules: {
    "first/sized": ["error", { max: 5, mode: "b", ignore: ["a*"], levels: { guess: "info" } }],
    "first/plain": "off",
    "second/plain": ["warning", {}],
  },
});
