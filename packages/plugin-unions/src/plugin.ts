import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { guarantees } from "./open-union.js";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  nonExhaustiveSwitch: moduleLoader(() => import("./non-exhaustive-switch.js")),
  ambiguousDiscriminant: moduleLoader(() => import("./ambiguous-discriminant.js")),
};

export function unions() {
  return definePlugin({
    name: "unions",
    description: "Every case of a union is handled, and its tag tells the cases apart.",
    rules: {
      "non-exhaustive-switch": lazyRule(
        RULES["non-exhaustive-switch"],
        load.nonExhaustiveSwitch,
        (module) => module.nonExhaustiveSwitch,
      ),
      "ambiguous-discriminant": lazyRule(
        RULES["ambiguous-discriminant"],
        load.ambiguousDiscriminant,
        (module) => module.ambiguousDiscriminant,
      ),
    },
    editor: { guarantees },
  });
}
