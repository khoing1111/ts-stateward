// The one copy of TypeScript stateward uses. Plugins import it from here
// (`import ts from "@stateward/core/typescript"`) instead of depending on `typescript` themselves,
// so an app installs a single TypeScript for all of stateward.
export { default } from "typescript";
