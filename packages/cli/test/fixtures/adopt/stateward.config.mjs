import { records } from "@stateward/plugin-records";
import { unions } from "@stateward/plugin-unions";

export default {
  preset: "recommended",
  plugins: [unions(), records()],
  include: ["src/**"],
  rollout: true,
};
