import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { hover } from "./hover.js";
import { parseOptions, type ReactContextOptions } from "./provider-missing/options.js";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  fakeDefaultValue: moduleLoader(() => import("./fake-default-value.js")),
  providerMissing: moduleLoader(() => import("./provider-missing/rule.js")),
};

/** Throws a `ReactContextOptionsError` when `options` is malformed, so the config fails to load. */
export function reactContext(options?: ReactContextOptions) {
  const entries = parseOptions(options);
  return definePlugin({
    name: "react-context",
    description: "A component that needs a context is always rendered under its Provider.",
    rules: {
      "fake-default-value": lazyRule(
        RULES["fake-default-value"],
        load.fakeDefaultValue,
        (module) => module.fakeDefaultValue,
      ),
      "provider-missing": lazyRule(RULES["provider-missing"], load.providerMissing, (module) =>
        module.createProviderMissing(entries),
      ),
    },
    editor: { hover },
  });
}
