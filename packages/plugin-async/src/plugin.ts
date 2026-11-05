import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  pendingStateStuckOnFailure: moduleLoader(() => import("./pending-state-stuck-on-failure.js")),
  handlerRejectionLost: moduleLoader(() => import("./handler-rejection-lost.js")),
};

/** Named `asyncFlow`, not `async`: `async` is a keyword where a function name would be read. */
export function asyncFlow() {
  return definePlugin({
    name: "async",
    description:
      "An async failure is never lost: handlers catch their own, and state set before an await is set again when it fails.",
    rules: {
      "pending-state-stuck-on-failure": lazyRule(
        RULES["pending-state-stuck-on-failure"],
        load.pendingStateStuckOnFailure,
        (module) => module.pendingStateStuckOnFailure,
      ),
      "handler-rejection-lost": lazyRule(
        RULES["handler-rejection-lost"],
        load.handlerRejectionLost,
        (module) => module.handlerRejectionLost,
      ),
    },
  });
}
