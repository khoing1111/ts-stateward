import { ownership } from "@stateward/plugin-ownership";
import { reactContext } from "@stateward/plugin-react-context";

export default {
  preset: "recommended",
  plugins: [
    ownership(),
    reactContext({ entries: [{ file: "src/main.tsx", export: "App", provides: ["ThemeContext"] }] }),
  ],
  include: ["src/**"],
};
