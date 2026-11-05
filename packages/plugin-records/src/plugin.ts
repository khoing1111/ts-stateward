import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  lookupMissesKey: moduleLoader(() => import("./lookup-misses-key.js")),
  tableTypeTooLoose: moduleLoader(() => import("./table-type-too-loose.js")),
  duplicateKey: moduleLoader(() => import("./duplicate-key.js")),
  keyedMapsOutOfSync: moduleLoader(() => import("./keyed-maps-out-of-sync.js")),
};

export function records() {
  return definePlugin({
    name: "records",
    description:
      "Lookup tables and records keyed by a union have every key, once, under a type that names them.",
    rules: {
      "lookup-misses-key": lazyRule(
        RULES["lookup-misses-key"],
        load.lookupMissesKey,
        (module) => module.lookupMissesKey,
      ),
      "table-type-too-loose": lazyRule(
        RULES["table-type-too-loose"],
        load.tableTypeTooLoose,
        (module) => module.tableTypeTooLoose,
      ),
      "duplicate-key": lazyRule(
        RULES["duplicate-key"],
        load.duplicateKey,
        (module) => module.duplicateKey,
      ),
      "keyed-maps-out-of-sync": lazyRule(
        RULES["keyed-maps-out-of-sync"],
        load.keyedMapsOutOfSync,
        (module) => module.keyedMapsOutOfSync,
      ),
    },
  });
}
