import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  lookupMissesKey: moduleLoader(() => import("./lookup-misses-key.js")),
  ambiguousTable: moduleLoader(() => import("./ambiguous-table.js")),
  duplicateKey: moduleLoader(() => import("./duplicate-key.js")),
  uncheckedKey: moduleLoader(() => import("./unchecked-key.js")),
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
      "ambiguous-table": lazyRule(
        RULES["ambiguous-table"],
        load.ambiguousTable,
        (module) => module.ambiguousTable,
      ),
      "duplicate-key": lazyRule(
        RULES["duplicate-key"],
        load.duplicateKey,
        (module) => module.duplicateKey,
      ),
      "unchecked-key": lazyRule(
        RULES["unchecked-key"],
        load.uncheckedKey,
        (module) => module.uncheckedKey,
      ),
    },
  });
}
