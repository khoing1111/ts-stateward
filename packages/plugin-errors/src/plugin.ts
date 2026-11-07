import { definePlugin, lazyRule, moduleLoader } from "@stateward/core";
import { codeActions } from "./refactors.js";
import { hover } from "./hover.js";
import { libraryFacts } from "./inference/deps.js";
import { inlayHints } from "./inlay.js";
import { RULES } from "./rules.meta.js";

/** Each rule's module, imported the first time the rule is on. */
const load = {
  catchHidesUnexpected: moduleLoader(() => import("./catch-hides-unexpected.js")),
  finallyCanThrow: moduleLoader(() => import("./finally-can-throw.js")),
  catchMissesError: moduleLoader(() => import("./catch-misses-error.js")),
  throwsDocMismatch: moduleLoader(() => import("./throws-doc-mismatch.js")),
  renderThrowWithoutBoundary: moduleLoader(() => import("./render-throw-without-boundary.js")),
  mustHandleError: moduleLoader(() => import("./must-handle-error.js")),
  narrowTry: moduleLoader(() => import("./narrow-try.js")),
  resultIgnored: moduleLoader(() => import("./result-ignored.js")),
  resultUnchecked: moduleLoader(() => import("./result-unchecked.js")),
};

export function errors() {
  return definePlugin({
    name: "errors",
    description:
      "Errors are handled where they can happen: none ignored, none replaced in `finally`, no `Result` dropped.",
    rules: {
      "catch-hides-unexpected": lazyRule(
        RULES["catch-hides-unexpected"],
        load.catchHidesUnexpected,
        (module) => module.catchHidesUnexpected,
      ),
      "finally-can-throw": lazyRule(
        RULES["finally-can-throw"],
        load.finallyCanThrow,
        (module) => module.finallyCanThrow,
      ),
      "catch-misses-error": lazyRule(
        RULES["catch-misses-error"],
        load.catchMissesError,
        (module) => module.catchMissesError,
      ),
      "throws-doc-mismatch": lazyRule(
        RULES["throws-doc-mismatch"],
        load.throwsDocMismatch,
        (module) => module.throwsDocMismatch,
      ),
      "render-throw-without-boundary": lazyRule(
        RULES["render-throw-without-boundary"],
        load.renderThrowWithoutBoundary,
        (module) => module.renderThrowWithoutBoundary,
      ),
      "must-handle-error": lazyRule(
        RULES["must-handle-error"],
        load.mustHandleError,
        (module) => module.mustHandleError,
      ),
      "narrow-try": lazyRule(RULES["narrow-try"], load.narrowTry, (module) => module.narrowTry),
      "result-ignored": lazyRule(
        RULES["result-ignored"],
        load.resultIgnored,
        (module) => module.resultIgnored,
      ),
      "result-unchecked": lazyRule(
        RULES["result-unchecked"],
        load.resultUnchecked,
        (module) => module.resultUnchecked,
      ),
    },
    editor: { hover, inlayHints, codeActions, libraryFacts },
  });
}
