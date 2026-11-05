import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  defaultHidesCases: moduleLoader(() => import("./default-hides-cases.js")),
  ifChainMissesCase: moduleLoader(() => import("./if-chain-misses-case.js")),
  tagDoesNotDiscriminate: moduleLoader(() => import("./tag-does-not-discriminate.js")),
};

export function unions() {
  return definePlugin({
    name: "unions",
    description: "Every case of a union is handled, and its tag tells the cases apart.",
    rules: {
      "default-hides-cases": lazyRule(
        RULES["default-hides-cases"],
        load.defaultHidesCases,
        (module) => module.defaultHidesCases,
      ),
      "if-chain-misses-case": lazyRule(
        RULES["if-chain-misses-case"],
        load.ifChainMissesCase,
        (module) => module.ifChainMissesCase,
      ),
      "tag-does-not-discriminate": lazyRule(
        RULES["tag-does-not-discriminate"],
        load.tagDoesNotDiscriminate,
        (module) => module.tagDoesNotDiscriminate,
      ),
    },
  });
}
