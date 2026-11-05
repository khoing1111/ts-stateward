// Every pack loads a rule's code the first time the rule is on (plan step PKG2): the CLI and the
// language server do it when they load the config (`loadConfigFile`). Tests check fixtures
// synchronously (`checkFixture`, `createChecker`), so every rule of every pack is loaded here,
// before each test file, from the same source modules the tests import.
import { loadAllRules } from "@stateward/core/internal";
import { asyncFlow } from "./packages/plugin-async/src/index.js";
import { errors } from "./packages/plugin-errors/src/index.js";
import { ownership } from "./packages/plugin-ownership/src/index.js";
import { react } from "./packages/plugin-react/src/index.js";
import { reactContext } from "./packages/plugin-react-context/src/index.js";
import { records } from "./packages/plugin-records/src/index.js";
import { reducers } from "./packages/plugin-reducers/src/index.js";
import { unions } from "./packages/plugin-unions/src/index.js";

await loadAllRules([
  asyncFlow(),
  errors(),
  ownership(),
  react(),
  reactContext(),
  records(),
  reducers(),
  unions(),
]);
