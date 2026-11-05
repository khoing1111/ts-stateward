import { defineConfig } from "@stateward/core";
import { reactContext } from "@stateward/plugin-react-context";

export default defineConfig({ preset: "recommended", plugins: [reactContext()] });
