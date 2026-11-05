import { asyncFlow } from "@stateward/plugin-async";
import { records } from "@stateward/plugin-records";
import { unions } from "@stateward/plugin-unions";

export default {
  preset: "recommended",
  plugins: [unions(), records(), asyncFlow()],
  include: ["src/**"],
};
