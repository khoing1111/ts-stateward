import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { codeActions } from "./declare-action.js";
import { guarantees } from "./guarantees.js";
import { hover } from "./hover.js";
import { parseOptions, type ReactContextOptions } from "./provider-missing/options.js";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  fakeDefaultValue: moduleLoader(() => import("./fake-default-value.js")),
  providerMissing: moduleLoader(() => import("./provider-missing/rule.js")),
  providerNested: moduleLoader(() => import("./provider-nested/rule.js")),
  providerValue: moduleLoader(() => import("./provider-value/rule.js")),
  valueChangedByReader: moduleLoader(() => import("./value-changed-by-reader.js")),
};

/** Throws a `ReactContextOptionsError` when `options` is malformed, so the config fails to load. */
export function reactContext(options?: ReactContextOptions) {
  const entries = parseOptions(options);
  return definePlugin({
    name: "react-context",
    description:
      "Every context reader is under its Provider, defaults are real values, and Provider values keep their identity.",
    rules: {
      "fake-default-value": lazyRule(
        RULES["fake-default-value"],
        load.fakeDefaultValue,
        (module) => module.fakeDefaultValue,
      ),
      "provider-missing": lazyRule(RULES["provider-missing"], load.providerMissing, (module) =>
        module.createProviderMissing(entries),
      ),
      "provider-nested": lazyRule(RULES["provider-nested"], load.providerNested, (module) =>
        module.createProviderNested(entries),
      ),
      "provider-value-changes-every-render": lazyRule(
        RULES["provider-value-changes-every-render"],
        load.providerValue,
        (module) => module.providerValueChangesEveryRender,
      ),
      "value-changed-by-reader": lazyRule(
        RULES["value-changed-by-reader"],
        load.valueChangedByReader,
        (module) => module.valueChangedByReader,
      ),
    },
    editor: { hover, codeActions, guarantees },
  });
}
