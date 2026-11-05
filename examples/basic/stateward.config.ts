import { defineConfig } from "@stateward/core";
import { reactContext } from "@stateward/plugin-react-context";
import { records } from "@stateward/plugin-records";
import { unions } from "@stateward/plugin-unions";
import { team } from "./stateward-rules/team.js";

// "strict" turns the findings that "recommended" shows only as info into errors: here, the
// context with a placeholder default.
// `team` is this project's own plugin (stateward-rules/team.ts); its rule takes an option.
export default defineConfig({
  plugins: [reactContext(), unions(), records(), team],
  preset: "strict",
  rules: { "team/max-union-members": ["warning", { max: 12 }] },
});
