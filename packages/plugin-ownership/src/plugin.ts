import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { guarantees } from "./guarantees.js";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  stateWrittenOutsideOwner: moduleLoader(() => import("./state-written-outside-owner.js")),
  brandBuiltOutsideOwner: moduleLoader(() => import("./brand-built-outside-owner.js")),
};

export function ownership() {
  return definePlugin({
    name: "ownership",
    description:
      "One owner per piece of shared state and per brand: others call the owner's functions.",
    rules: {
      "state-written-outside-owner": lazyRule(
        RULES["state-written-outside-owner"],
        load.stateWrittenOutsideOwner,
        (module) => module.stateWrittenOutsideOwner,
      ),
      "brand-built-outside-owner": lazyRule(
        RULES["brand-built-outside-owner"],
        load.brandBuiltOutsideOwner,
        (module) => module.brandBuiltOutsideOwner,
      ),
    },
    editor: { guarantees },
  });
}
