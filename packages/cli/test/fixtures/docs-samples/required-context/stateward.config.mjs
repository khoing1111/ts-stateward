import { reactContext } from "@stateward/plugin-react-context";
export default { preset: "recommended", plugins: [reactContext({ entries: [{ file: "src/settings.tsx", export: "App", provides: [] }] })], include: ["src/**"] };
