import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  stateCannotLeave: moduleLoader(() => import("./state-cannot-leave.js")),
  reducerNotReadable: moduleLoader(() => import("./reducer-not-readable.js")),
  stateUnreachable: moduleLoader(() => import("./state-unreachable.js")),
};

export function reducers() {
  return definePlugin({
    name: "reducers",
    description: "A reducer reaches every state it declares and can leave every state it enters.",
    rules: {
      "state-cannot-leave": lazyRule(
        RULES["state-cannot-leave"],
        load.stateCannotLeave,
        (module) => module.stateCannotLeave,
      ),
      "reducer-not-readable": lazyRule(
        RULES["reducer-not-readable"],
        load.reducerNotReadable,
        (module) => module.reducerNotReadable,
      ),
      "state-unreachable": lazyRule(
        RULES["state-unreachable"],
        load.stateUnreachable,
        (module) => module.stateUnreachable,
      ),
    },
  });
}
