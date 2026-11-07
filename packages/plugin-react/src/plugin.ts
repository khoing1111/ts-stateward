import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  dependencyChangesEveryRender: moduleLoader(() => import("./dependency-changes-every-render.js")),
  providerValueChangesEveryRender: moduleLoader(
    () => import("./provider-value-changes-every-render.js"),
  ),
  effectCopiesDerivedValue: moduleLoader(() => import("./effect-copies-derived-value.js")),
  stateCopiesProp: moduleLoader(() => import("./state-copies-prop.js")),
  effectLoops: moduleLoader(() => import("./effect-loops.js")),
  effectMissingCleanup: moduleLoader(() => import("./effect-missing-cleanup.js")),
  effectResponseRace: moduleLoader(() => import("./effect-response-race.js")),
  timerRunsAfterUnmount: moduleLoader(() => import("./timer-runs-after-unmount.js")),
  closureReadsStaleState: moduleLoader(() => import("./closure-reads-stale-state.js")),
  indexKeyOnReorderedList: moduleLoader(() => import("./index-key-on-reordered-list.js")),
};

export function react() {
  return definePlugin({
    name: "react",
    description:
      "Values that effects and memoized components depend on keep their identity; effects do not copy state, loop, leak or race; state updates see the latest state; flags do not stand in for one state.",
    rules: {
      "dependency-changes-every-render": lazyRule(
        RULES["dependency-changes-every-render"],
        load.dependencyChangesEveryRender,
        (module) => module.dependencyChangesEveryRender,
      ),
      "provider-value-changes-every-render": lazyRule(
        RULES["provider-value-changes-every-render"],
        load.providerValueChangesEveryRender,
        (module) => module.providerValueChangesEveryRender,
      ),
      "effect-copies-derived-value": lazyRule(
        RULES["effect-copies-derived-value"],
        load.effectCopiesDerivedValue,
        (module) => module.effectCopiesDerivedValue,
      ),
      "state-copies-prop": lazyRule(
        RULES["state-copies-prop"],
        load.stateCopiesProp,
        (module) => module.stateCopiesProp,
      ),
      "effect-loops": lazyRule(
        RULES["effect-loops"],
        load.effectLoops,
        (module) => module.effectLoops,
      ),
      "effect-missing-cleanup": lazyRule(
        RULES["effect-missing-cleanup"],
        load.effectMissingCleanup,
        (module) => module.effectMissingCleanup,
      ),
      "effect-response-race": lazyRule(
        RULES["effect-response-race"],
        load.effectResponseRace,
        (module) => module.effectResponseRace,
      ),
      "timer-runs-after-unmount": lazyRule(
        RULES["timer-runs-after-unmount"],
        load.timerRunsAfterUnmount,
        (module) => module.timerRunsAfterUnmount,
      ),
      "closure-reads-stale-state": lazyRule(
        RULES["closure-reads-stale-state"],
        load.closureReadsStaleState,
        (module) => module.closureReadsStaleState,
      ),
      "index-key-on-reordered-list": lazyRule(
        RULES["index-key-on-reordered-list"],
        load.indexKeyOnReorderedList,
        (module) => module.indexKeyOnReorderedList,
      ),
    },
  });
}
