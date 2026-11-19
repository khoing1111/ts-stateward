import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prepare, removeCopies, root, run } from "./adversarial-project.js";

/**
 * The adversarial set: every case a reviewer found where a guarantee read
 * "proven" while the problem stayed, kept as a project in `fixtures/adversarial/<guarantee>/<case>`.
 * Each one must read "not proven" or "not checked", never "proven" (and `stateward guarantees` must
 * exit 1 for the first). Each `<case>-good` folder is the code fixed and must read "proven", so
 * the change is not "nothing is ever proven".
 */

type Status = "proven" | "unproven" | "unchecked" | "off";

type Expectation = {
  /** The guarantee's name, as `stateward guarantees` lists it. */
  name: string;
  status: Status;
  /** Text the pretty output has under this guarantee's name. */
  says?: string;
};

type Case = {
  /** `<group>/<case>`, under `fixtures/adversarial`. */
  dir: string;
  /** What the case's guarantees read, one entry per guarantee it asserts. */
  expect: readonly Expectation[];
  /** The exit code of `stateward guarantees`. */
  exit: 0 | 1;
  /** Text `stateward check` prints for the case (a hint), and text it must not print. */
  check?: { has: readonly string[]; not?: readonly string[] };
};

const NOT_PROVEN = (name: string, says?: string): Expectation => ({
  name,
  status: "unproven",
  ...(says === undefined ? {} : { says }),
});
const UNCHECKED = (name: string, says: string): Expectation => ({
  name,
  status: "unchecked",
  says,
});
const OFF = (name: string, says: string): Expectation => ({ name, status: "off", says });
const PROVEN = (name: string): Expectation => ({ name, status: "proven" });

const CASES: readonly Case[] = [
  // Release
  {
    dir: "release/ignore-comment",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 ignored — lives as long as the app")],
    exit: 1,
  },
  { dir: "release/ignore-comment-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/parameter-never-releases",
    expect: [NOT_PROVEN("keep(_stop)", "not proven: 1 error"), NOT_PROVEN("watchPrices")],
    exit: 1,
  },
  {
    dir: "release/parameter-never-releases-good",
    expect: [PROVEN("keep(stop)"), PROVEN("watchPrices")],
    exit: 0,
  },
  {
    dir: "release/closure-never-called",
    expect: [
      UNCHECKED(
        "watchPrices",
        "not checked: `stop` from `watchPrices(…)` is released only in `later`, which nothing calls",
      ),
    ],
    exit: 0,
  },
  { dir: "release/closure-never-called-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/closure-one-branch",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
    check: { has: ["is released only on some paths of the function that releases it"] },
  },
  { dir: "release/closure-one-branch-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/stored-in-owned",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/stored-in-owned-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/option-ignore",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/option-ignore-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/rule-info",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/rule-info-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/rule-off-for-file",
    expect: [
      OFF("watchPrices", "not checked: ownership/resource-not-released is off for 1 caller"),
    ],
    exit: 0,
  },
  // Release: the call reaches the function by another name
  {
    dir: "release/alias-call",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/alias-call-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/dynamic-import",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/dynamic-import-good", expect: [PROVEN("watchPrices")], exit: 0 },
  // Release: every reference to the function or the parameter is read, or the place is not checked
  {
    dir: "release/class-field",
    expect: [
      UNCHECKED("watchPrices", "is kept in the field `stop` of `Feed`, which is not followed"),
    ],
    exit: 0,
  },
  { dir: "release/class-field-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/async-starter",
    expect: [
      UNCHECKED(
        "on",
        '`on("x")` (a call) is a use of `on` that stateward does not read for `Release`',
      ),
    ],
    exit: 0,
  },
  { dir: "release/async-starter-good", expect: [PROVEN("on")], exit: 0 },
  {
    dir: "release/async-starter-all",
    expect: [
      UNCHECKED(
        "on",
        '`on("y")` (a call) is a use of `on` that stateward does not read for `Release`',
      ),
    ],
    exit: 0,
  },
  { dir: "release/async-starter-all-good", expect: [PROVEN("on")], exit: 0 },
  {
    dir: "release/map-function",
    expect: [
      UNCHECKED(
        "on",
        '`["a"].map(on)` (given as an argument) is a use of `on` that stateward does not read',
      ),
    ],
    exit: 0,
  },
  { dir: "release/map-function-good", expect: [PROVEN("on")], exit: 0 },
  {
    dir: "release/destructured-result",
    expect: [
      UNCHECKED(
        "on",
        '`on("a")` (a call) is a use of `on` that stateward does not read for `Release`',
      ),
    ],
    exit: 0,
  },
  { dir: "release/destructured-result-good", expect: [PROVEN("on")], exit: 0 },
  {
    dir: "release/map-callback",
    expect: [UNCHECKED("watchPrices", "is returned from a callback given to")],
    exit: 0,
  },
  { dir: "release/map-callback-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/rest-parameter",
    expect: [
      UNCHECKED("watchPrices", "is given to the rest parameter `stops`"),
      UNCHECKED(
        "stops",
        "`stops.length` (a read) is a use of `stops` that stateward does not read",
      ),
    ],
    exit: 0,
  },
  {
    dir: "release/rest-parameter-good",
    expect: [PROVEN("watchPrices"), PROVEN("keep(stop)")],
    exit: 0,
  },
  // Release: a value stated `Release` is released only if nothing between the start and the release can throw or leave
  {
    dir: "release/labelled-break",
    expect: [NOT_PROVEN("watchPrices", "is not released on every way out")],
    exit: 1,
  },
  { dir: "release/labelled-break-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/generator-yield",
    expect: [NOT_PROVEN("watchPrices", "is not released on every way out")],
    exit: 1,
  },
  { dir: "release/generator-yield-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/then-callback",
    expect: [
      UNCHECKED(
        "watchPrices",
        "is released only in a callback given to `done.then()`, which is not followed",
      ),
    ],
    exit: 0,
  },
  { dir: "release/then-callback-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/sync-throw",
    expect: [NOT_PROVEN("watchPrices", "is not released on every way out")],
    exit: 1,
  },
  { dir: "release/sync-throw-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/comma-dropped",
    expect: [NOT_PROVEN("watchPrices", "the result of `watchPrices(…)` is never released")],
    exit: 1,
  },
  { dir: "release/comma-dropped-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/async-inferred-return",
    expect: [
      UNCHECKED(
        "watchPrices",
        "is returned from the async function `start`, whose callers are not followed",
      ),
    ],
    exit: 0,
  },
  { dir: "release/async-inferred-return-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/module-let-uncalled",
    expect: [
      UNCHECKED(
        "watchPrices",
        "is stored in `stopAll`, released only in `stop`, which nothing calls",
      ),
    ],
    exit: 0,
  },
  { dir: "release/module-let-uncalled-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/module-let-conditional",
    expect: [NOT_PROVEN("watchPrices", "which the file releases only on some paths")],
    exit: 1,
  },
  { dir: "release/module-let-conditional-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/pushed-list",
    expect: [NOT_PROVEN("watchPrices", "which the file releases only on some paths")],
    exit: 1,
  },
  { dir: "release/pushed-list-good", expect: [PROVEN("watchPrices")], exit: 0 },
  // OpenUnion
  {
    dir: "open-union/default-assert-never",
    expect: [NOT_PROVEN("OrderStatus", "the `default` throws on a value outside `OrderStatus`")],
    exit: 1,
  },
  { dir: "open-union/default-assert-never-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/default-throws",
    expect: [NOT_PROVEN("OrderStatus", "the `default` throws on a value outside `OrderStatus`")],
    exit: 1,
  },
  { dir: "open-union/default-throws-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/kind-info",
    expect: [NOT_PROVEN("OrderStatus", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "open-union/kind-info-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/kind-off",
    expect: [NOT_PROVEN("OrderStatus", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "open-union/kind-off-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/rule-info",
    expect: [NOT_PROVEN("OrderStatus", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "open-union/rule-info-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/option-ignore",
    expect: [NOT_PROVEN("OrderStatus", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "open-union/option-ignore-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/rule-off-for-file",
    expect: [
      OFF("OrderStatus", "not checked: unions/non-exhaustive-switch is off for 1 switch or lookup"),
    ],
    exit: 0,
  },
  {
    dir: "open-union/ignore-comment",
    expect: [
      NOT_PROVEN("OrderStatus", "not proven: 1 ignored — the caller checks the status first"),
    ],
    exit: 1,
  },
  { dir: "open-union/ignore-comment-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/if-chain-no-else",
    expect: [UNCHECKED("OrderStatus", "the `if` chain on `status` is not read as a switch")],
    exit: 0,
  },
  {
    dir: "open-union/if-chain-throwing-else",
    expect: [UNCHECKED("OrderStatus", "the `if` chain on `status` is not read as a switch")],
    exit: 0,
  },
  { dir: "open-union/if-chain-no-else-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  // OpenUnion: every value the code decides by is a typed flow; only a `switch` is read
  {
    dir: "open-union/if-chain-handled",
    expect: [UNCHECKED("OrderStatus", "the `if` chain on `status` is not read as a switch")],
    exit: 0,
  },
  {
    dir: "open-union/switch-true",
    expect: [UNCHECKED("OrderStatus", "the `switch (true)` on `status` is not read as a switch")],
    exit: 0,
  },
  { dir: "open-union/switch-true-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/ternary-chain",
    expect: [UNCHECKED("OrderStatus", "the `?:` on `status` is not read as a switch")],
    exit: 0,
  },
  { dir: "open-union/ternary-chain-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/lookup",
    expect: [
      UNCHECKED("OrderStatus", "the lookup `labels[status]` by `status` is not read as a switch"),
    ],
    exit: 0,
  },
  { dir: "open-union/lookup-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/if-chain-reject",
    expect: [UNCHECKED("OrderStatus", "the `if` chain on `status` is not read as a switch")],
    exit: 0,
  },
  { dir: "open-union/if-chain-reject-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/if-else-reject",
    expect: [UNCHECKED("OrderStatus", "the `if` chain on `status` is not read as a switch")],
    exit: 0,
  },
  { dir: "open-union/if-else-reject-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  // Owned
  { dir: "owned/rule-info", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/rule-info-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/kind-info", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/kind-info-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/kind-off", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/kind-off-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/option-ignore", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/option-ignore-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/rule-off-for-file",
    expect: [
      OFF("session", "not checked: ownership/state-written-outside-owner is off for 1 writer"),
    ],
    exit: 0,
  },
  // Owned: every use of the value is read, or the place is not checked
  {
    dir: "owned/callback-in-array-literal",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "owned/callback-in-array-literal-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/loop-over-array-literal",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "owned/loop-over-array-literal-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/element-read", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/element-read-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/callback-parameter",
    expect: [UNCHECKED("session", "not checked: `f(…)` may change `session`")],
    exit: 0,
  },
  { dir: "owned/callback-parameter-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/spread-nested-write",
    expect: [NOT_PROVEN("session", "not proven: 2 errors")],
    exit: 1,
  },
  { dir: "owned/spread-nested-write-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/named-callback",
    expect: [UNCHECKED("session", "hands each element of `[session]` to `touch`")],
    exit: 0,
  },
  { dir: "owned/named-callback-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/stored-in-collection",
    expect: [UNCHECKED("session", "`keep.push(session)` stores `session` in `keep`")],
    exit: 0,
  },
  { dir: "owned/stored-in-collection-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/stored-in-map", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/stored-in-map-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/stored-in-property",
    expect: [
      UNCHECKED("session", "`holder.current = session` stores `session` in `holder.current`"),
    ],
    exit: 0,
  },
  { dir: "owned/stored-in-property-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/computed-key",
    expect: [UNCHECKED("session", "reads `table` by a computed key")],
    exit: 0,
  },
  { dir: "owned/computed-key-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/given-to-class",
    expect: [UNCHECKED("session", "`new Keeper(session)` gives `session` to `Keeper`")],
    exit: 0,
  },
  { dir: "owned/given-to-class-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/spread-argument", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/spread-argument-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/parameter-keeps-value",
    expect: [UNCHECKED("session", "not checked: `remember(…)` may change `session`")],
    exit: 0,
  },
  { dir: "owned/parameter-keeps-value-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/parameter-returns-value",
    expect: [UNCHECKED("session", "not checked: `same(…)` may change `session`")],
    exit: 0,
  },
  { dir: "owned/parameter-returns-value-good", expect: [PROVEN("session")], exit: 0 },
  // Owned: a value reached through a call whose declaration is not found
  {
    dir: "owned/api-current",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "owned/api-current-good", expect: [PROVEN("session")], exit: 0 },
  // Owned: every reference to the value is read, or the place is not checked
  {
    dir: "owned/class-field",
    expect: [UNCHECKED("session", "keeps `session` in the field `s` of `Panel`")],
    exit: 0,
  },
  { dir: "owned/class-field-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/default-parameter",
    expect: [UNCHECKED("session", "`s = session` is a default value, which is not followed")],
    exit: 0,
  },
  { dir: "owned/default-parameter-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/conditional-target",
    expect: [UNCHECKED("session", "changes a value that is not traced back to `session`")],
    exit: 0,
  },
  { dir: "owned/conditional-target-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/getter",
    expect: [UNCHECKED("session", "is what the getter `value` returns, which is not followed")],
    exit: 0,
  },
  { dir: "owned/getter-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/proxy",
    expect: [UNCHECKED("session", "wraps `session` in a value whose changes are not followed")],
    exit: 0,
  },
  { dir: "owned/proxy-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/push-through-call",
    expect: [UNCHECKED("session", "calls a function with `session` indirectly")],
    exit: 0,
  },
  { dir: "owned/push-through-call-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/reflect-apply",
    expect: [UNCHECKED("session", "calls a function with `session` indirectly")],
    exit: 0,
  },
  { dir: "owned/reflect-apply-good", expect: [PROVEN("session")], exit: 0 },
  { dir: "owned/object-values", expect: [NOT_PROVEN("session", "not proven: 1 error")], exit: 1 },
  { dir: "owned/object-values-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/generator",
    expect: [UNCHECKED("session", "`yield session` is yielded by a generator")],
    exit: 0,
  },
  { dir: "owned/generator-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/async-generator",
    expect: [UNCHECKED("session", "`yield session` is yielded by a generator")],
    exit: 0,
  },
  { dir: "owned/async-generator-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/object-getter",
    expect: [UNCHECKED("session", "is what the getter `s` returns, which is not followed")],
    exit: 0,
  },
  { dir: "owned/object-getter-good", expect: [PROVEN("session")], exit: 0 },
  // Owned: the hint names an owner's function only for the same property and the same kind of value
  {
    dir: "owned/hint-other-value",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
    check: {
      has: ["add a function in `src/session.ts` that makes the change (e.g. `setUser(name)`)"],
      not: ["call `signOut`"],
    },
  },
  {
    dir: "owned/hint-other-value-good",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
    check: { has: ["call `signOut` from `src/session.ts` instead"] },
  },
  {
    dir: "owned/hint-destructuring",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
    check: { has: ["add a function in `src/session.ts`"], not: ["call `signOut`"] },
  },
  {
    dir: "owned/hint-destructuring-good",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
    check: { has: ["call `signOut` from `src/session.ts` instead"] },
  },
  {
    dir: "owned/hint-object-assign",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
    check: {
      has: ["add a function in `src/session.ts` that sets `count`"],
      not: ["call `signOut`"],
    },
  },
  {
    dir: "owned/hint-object-assign-good",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
    check: { has: ["call `signOut` from `src/session.ts` instead"] },
  },
  // Opaque: every place a value of the brand is produced is read, or the place is not checked
  { dir: "opaque/async-return", expect: [NOT_PROVEN("OrderId", "not proven: 1 error")], exit: 1 },
  { dir: "opaque/async-return-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/template-literal",
    expect: [NOT_PROVEN("OrderId", "not proven: 1 error")],
    exit: 1,
    // A template literal is named, not quoted: a code span around it showed two pairs of backticks.
    check: { has: ["is built from a template literal outside"], not: ["``"] },
  },
  { dir: "opaque/template-literal-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/container-return",
    expect: [UNCHECKED("OrderId", "`raw` (`string[]`) is given as `OrderId[]`")],
    exit: 0,
  },
  { dir: "opaque/container-return-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/container-assign",
    expect: [UNCHECKED("OrderId", "`raw` (`string[]`) is given as `OrderId[]`")],
    exit: 0,
  },
  { dir: "opaque/container-assign-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/map-container",
    expect: [UNCHECKED("OrderId", "is given as `Map<string, OrderId>`")],
    exit: 0,
  },
  { dir: "opaque/map-container-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/object-container",
    expect: [UNCHECKED("OrderId", "is given as `{ id: OrderId; }`")],
    exit: 0,
  },
  { dir: "opaque/object-container-good", expect: [PROVEN("OrderId")], exit: 0 },
  { dir: "opaque/cast-container", expect: [NOT_PROVEN("OrderId", "not proven: 1 error")], exit: 1 },
  { dir: "opaque/cast-container-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/assigned-property",
    expect: [NOT_PROVEN("OrderId", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "opaque/assigned-property-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/logical-assignment",
    expect: [NOT_PROVEN("OrderId", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "opaque/logical-assignment-good", expect: [PROVEN("OrderId")], exit: 0 },
  { dir: "opaque/default-value", expect: [NOT_PROVEN("OrderId", "not proven: 1 error")], exit: 1 },
  { dir: "opaque/default-value-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/wrapper-constructor",
    expect: [NOT_PROVEN("OrderId", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "opaque/wrapper-constructor-good", expect: [PROVEN("OrderId")], exit: 0 },
  { dir: "opaque/higher-order", expect: [NOT_PROVEN("OrderId", "not proven: 1 error")], exit: 1 },
  { dir: "opaque/higher-order-good", expect: [PROVEN("OrderId")], exit: 0 },
  // Opaque: every value made of the brand is a typed flow, read or not checked
  {
    dir: "opaque/generic-call",
    expect: [
      UNCHECKED("OrderId", '`getJson<Order>("/order")` makes `OrderId` by its type arguments'),
    ],
    exit: 0,
  },
  { dir: "opaque/generic-call-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/generic-cast",
    expect: [UNCHECKED("OrderId", '`make<OrderId>("o-1")` makes `OrderId` by its type arguments')],
    exit: 0,
  },
  { dir: "opaque/generic-cast-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/overload-any",
    expect: [
      UNCHECKED("OrderId", "`raw` is returned as `OrderId` by an overload's implementation"),
    ],
    exit: 0,
  },
  { dir: "opaque/overload-any-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/cast-to-type-parameter",
    expect: [UNCHECKED("OrderId", '`"o-1"` is cast to a type that holds `OrderId`')],
    exit: 0,
  },
  { dir: "opaque/cast-to-type-parameter-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/indirect-call",
    expect: [
      UNCHECKED(
        "OrderId",
        '`show.call(null, "o-1")` passes arguments past their types to a function that takes `OrderId`',
      ),
    ],
    exit: 0,
  },
  { dir: "opaque/indirect-call-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/spread-argument",
    expect: [UNCHECKED("OrderId", "spreads values into places typed `OrderId`")],
    exit: 0,
  },
  { dir: "opaque/spread-argument-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/for-of-target",
    expect: [UNCHECKED("OrderId", "writes a place typed `OrderId` from a loop")],
    exit: 0,
  },
  { dir: "opaque/for-of-target-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/reflect-write",
    expect: [
      UNCHECKED(
        "OrderId",
        '`Object.defineProperty(order, "id", { value: "o-1" })` writes a value typed `OrderId` by reflection',
      ),
    ],
    exit: 0,
  },
  { dir: "opaque/reflect-write-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/proxy",
    expect: [UNCHECKED("OrderId", "is cast to a type that holds `OrderId`")],
    exit: 0,
  },
  { dir: "opaque/proxy-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/function-type",
    expect: [
      UNCHECKED("OrderId", "is a function given where one that returns `OrderId` is expected"),
    ],
    exit: 0,
  },
  { dir: "opaque/function-type-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/jsx-spread",
    expect: [
      UNCHECKED("OrderId", "`<Show {...props} />` spreads values into places typed `OrderId`"),
    ],
    exit: 0,
  },
  { dir: "opaque/jsx-spread-good", expect: [PROVEN("OrderId")], exit: 0 },
  // `ignore` on the other stated guarantees
  {
    dir: "react/stable-ignore-option",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "react/stable-ignore-option-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "react/single-provider-ignore-option",
    expect: [NOT_PROVEN("StoreContext", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "react/single-provider-ignore-option-good", expect: [PROVEN("StoreContext")], exit: 0 },
  { dir: "react/pending-ignore-option", expect: [NOT_PROVEN("saving", "not proven")], exit: 1 },
  { dir: "react/pending-ignore-option-good", expect: [PROVEN("saving")], exit: 0 },
  // Stable: every read of the value is listed and read
  {
    dir: "stable/helper-reads-prop",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`helper` reads `onSave`, which the `useCallback` does not list"] },
  },
  { dir: "stable/helper-reads-prop-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/named-callback",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`onSave` is read in the `useCallback` but not in its dependencies"] },
  },
  { dir: "stable/named-callback-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/named-builder",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`onSave` is read in the `useMemo` but not in its dependencies"] },
  },
  { dir: "stable/named-builder-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/project-hook-in-memo",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`n` is read in the `useMemo` but not in its dependencies"] },
  },
  { dir: "stable/project-hook-in-memo-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/project-hook-value",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["its value comes from `useActions()`, a hook of the project"] },
  },
  { dir: "stable/project-hook-value-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/module-let",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["its value changes when `current` changes"] },
  },
  { dir: "stable/module-let-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/module-let-in-memo",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`current` is read in the `useMemo` but not in its dependencies"] },
  },
  { dir: "stable/module-let-in-memo-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/module-let-destructured",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`current` is read in the `useMemo` but not in its dependencies"] },
  },
  { dir: "stable/module-let-destructured-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/fresh-reads-through-helper",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: {
      has: ["keep `saving` (state) out of this value"],
      not: ["dependencies that never change"],
    },
  },
  { dir: "stable/fresh-reads-through-helper-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/memo-over-helper-state",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`save` reads `saving`, which the `useMemo` does not list"] },
  },
  { dir: "stable/memo-over-helper-state-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/nested-object-closure",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`handlers` reads `onSave`, which the `useCallback` does not list"] },
  },
  { dir: "stable/nested-object-closure-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/helper-from-call",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`helper` reads `onSave`, which the `useCallback` does not list"] },
  },
  { dir: "stable/helper-from-call-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/provider-element",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "stable/provider-element-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/unreadable-call",
    expect: [
      UNCHECKED(
        "ActionsContext",
        "not checked: `makeActions()` is a call whose result is not followed",
      ),
    ],
    exit: 0,
  },
  { dir: "stable/unreadable-call-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/unreadable-read-in-memo",
    expect: [
      UNCHECKED(
        "ActionsContext",
        "not checked: `makeActions()` is a call whose result is not followed",
      ),
    ],
    exit: 0,
  },
  { dir: "stable/unreadable-read-in-memo-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/dependency-list-variable",
    expect: [
      UNCHECKED(
        "ActionsContext",
        "not checked: the dependency list `dependencies` of the `useCallback` is not an array written in place",
      ),
    ],
    exit: 0,
  },
  { dir: "stable/dependency-list-variable-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/callback-from-call",
    expect: [
      UNCHECKED(
        "ActionsContext",
        "not checked: the callback `debounce(run)` of the `useCallback` is not a function written in place",
      ),
    ],
    exit: 0,
  },
  { dir: "stable/callback-from-call-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/spread-props",
    expect: [
      UNCHECKED(
        "ActionsContext",
        "not checked: its `value` may be given through a spread of props",
      ),
    ],
    exit: 0,
  },
  { dir: "stable/spread-props-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/module-level-provider",
    expect: [
      UNCHECKED("ActionsContext", "not checked: its `value` is written outside a component"),
    ],
    exit: 0,
  },
  { dir: "stable/module-level-provider-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  // Stable: every reference to the context is read, or the place is not checked
  {
    dir: "stable/provider-alias",
    expect: [UNCHECKED("ActionsContext", "gives the Provider another name")],
    exit: 0,
  },
  { dir: "stable/provider-alias-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/provider-create-element",
    expect: [UNCHECKED("ActionsContext", "passes the context's Provider on")],
    exit: 0,
  },
  { dir: "stable/provider-create-element-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "stable/context-alias",
    expect: [UNCHECKED("ActionsContext", "gives the context another name")],
    exit: 0,
  },
  { dir: "stable/context-alias-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  // RequiredContext: every reference to the context is read, or the place is not checked
  {
    dir: "required-context/class-context-type",
    expect: [UNCHECKED("ThemeContext", "reads the context in a class component")],
    exit: 0,
  },
  { dir: "required-context/class-context-type-good", expect: [PROVEN("ThemeContext")], exit: 0 },
  {
    dir: "required-context/alias",
    expect: [UNCHECKED("ThemeContext", "`C = ThemeContext` gives the context another name")],
    exit: 0,
  },
  { dir: "required-context/alias-good", expect: [PROVEN("ThemeContext")], exit: 0 },
  {
    dir: "required-context/hook-factory",
    expect: [UNCHECKED("ThemeContext", "passes the context to a call")],
    exit: 0,
  },
  { dir: "required-context/hook-factory-good", expect: [PROVEN("ThemeContext")], exit: 0 },
  {
    dir: "required-context/stored-in-object",
    expect: [UNCHECKED("ThemeContext", "keeps the context in an object or array literal")],
    exit: 0,
  },
  { dir: "required-context/stored-in-object-good", expect: [PROVEN("ThemeContext")], exit: 0 },
  // SingleProvider and provider-missing: every place the Provider can be rendered. A place the
  // proof cannot follow is "not checked" (the developer keeps the say), never an error.
  {
    dir: "single-provider/render-prop-wrapper",
    expect: [
      UNCHECKED("StoreContext", "not checked: `wrap(children)` in `<Wrap>` cannot be followed"),
    ],
    exit: 0,
    check: {
      has: [
        "not checked: `wrap(children)` in `<Wrap>` cannot be followed",
        "not checked: `<Inner>` is passed to `wrapInner()`, which cannot be followed",
      ],
      not: ["error"],
    },
  },
  { dir: "single-provider/render-prop-wrapper-good", expect: [PROVEN("StoreContext")], exit: 0 },
  {
    dir: "single-provider/element-given-to-call",
    expect: [
      UNCHECKED(
        "StoreContext",
        "not checked: `<Inner>` is passed to `toast()`, which cannot be followed",
      ),
    ],
    exit: 0,
    check: { has: ["not checked: `<Inner>` is passed to `toast()`, which cannot be followed"] },
  },
  { dir: "single-provider/element-given-to-call-good", expect: [PROVEN("StoreContext")], exit: 0 },
  {
    dir: "single-provider/provider-in-escaping-slot",
    expect: [UNCHECKED("StoreContext", "which cannot be followed")],
    exit: 0,
    check: { has: ["is given to `wrap(children)`, which cannot be followed"] },
  },
  {
    dir: "single-provider/provider-in-escaping-slot-good",
    expect: [PROVEN("StoreContext")],
    exit: 0,
  },
  {
    dir: "single-provider/slot-kept-in-object",
    expect: [UNCHECKED("StoreContext", "not checked: `child` in `<Wrap>` cannot be followed")],
    exit: 0,
    check: { has: ["not checked: `child` in `<Wrap>` cannot be followed"] },
  },
  { dir: "single-provider/slot-kept-in-object-good", expect: [PROVEN("StoreContext")], exit: 0 },
  {
    dir: "single-provider/reader-through-wrap",
    expect: [NOT_PROVEN("ThemeContext", "not proven: ")],
    exit: 1,
    check: { has: ["`Reader` is rendered through `wrap(…)`, which cannot be followed"] },
  },
  { dir: "single-provider/reader-through-wrap-good", expect: [PROVEN("ThemeContext")], exit: 0 },
  {
    dir: "single-provider/recursive-nesting",
    expect: [NOT_PROVEN("StoreContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["note", "renders itself inside it"] },
  },
  { dir: "single-provider/recursive-nesting-good", expect: [PROVEN("StoreContext")], exit: 0 },
  {
    dir: "single-provider/alias-nested",
    expect: [UNCHECKED("StoreContext", "`C = StoreContext` gives the context another name")],
    exit: 0,
  },
  { dir: "single-provider/alias-nested-good", expect: [PROVEN("StoreContext")], exit: 0 },
  // Round 4: a Provider kept in a variable renders where the proof does not follow
  {
    dir: "single-provider/kept-in-variable",
    expect: [UNCHECKED("StoreContext", "`<StoreContext.Provider>` is kept in `inner`")],
    exit: 0,
  },
  { dir: "single-provider/kept-in-variable-good", expect: [PROVEN("StoreContext")], exit: 0 },
  {
    dir: "single-provider/provider-helper",
    expect: [
      UNCHECKED(
        "StoreContext",
        "`provide(StoreContext, store, children)` passes the context to a call, which stateward does not follow",
      ),
    ],
    exit: 0,
  },
  // A hook of the project that only reads the context it is given is a reader.
  { dir: "single-provider/provider-helper-good", expect: [PROVEN("StoreContext")], exit: 0 },
  // Pending: every write of the state is listed and read, or the place is not checked
  {
    dir: "pending/alias",
    expect: [UNCHECKED("busy", "not checked: `setBusy` is copied to `set`")],
    exit: 0,
    check: { has: ["not checked: `setBusy` is copied to `set`, whose writes cannot be followed"] },
  },
  { dir: "pending/alias-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/updater",
    expect: [UNCHECKED("busy", "`setBusy((value) => !value)` is an updater")],
    exit: 0,
    check: { has: ["is an updater, so the value it writes is not known"] },
  },
  { dir: "pending/updater-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/in-timeout",
    expect: [UNCHECKED("busy", "`setBusy(true)` is not a statement of its function")],
    exit: 0,
    check: { has: ["so when it runs is not followed"] },
  },
  { dir: "pending/in-timeout-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/passed-on",
    expect: [UNCHECKED("busy", "`setBusy` is passed to `register(…)`, which cannot be followed")],
    exit: 0,
  },
  { dir: "pending/passed-on-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/returned-setter",
    expect: [UNCHECKED("busy", "`setBusy` is stored, returned or passed on")],
    exit: 0,
  },
  { dir: "pending/returned-setter-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/value-unreadable",
    expect: [UNCHECKED("busy", "`setBusy(next)` writes a value that is not a literal")],
    exit: 0,
  },
  { dir: "pending/value-unreadable-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/conditional-finally",
    expect: [NOT_PROVEN("busy", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`busy` is set back only on some paths of `save`"] },
  },
  { dir: "pending/conditional-finally-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/reset-in-timeout",
    expect: [UNCHECKED("busy", "runs in `setTimeout(…)`, which stateward does not follow")],
    exit: 0,
  },
  { dir: "pending/reset-in-timeout-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/field-compound",
    expect: [UNCHECKED("busy", "is not a plain `place = value;` statement")],
    exit: 0,
  },
  { dir: "pending/field-compound-good", expect: [PROVEN("busy")], exit: 0 },
  {
    dir: "pending/private-field",
    // The guard `if (this.#saving) return` is read as for a public field: only the failure is an error.
    expect: [NOT_PROVEN("#saving", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "pending/private-field-good", expect: [PROVEN("#saving")], exit: 0 },
  // The same member, settled: a member of an object type is listed and proven.
  { dir: "pending/module-object-settled", expect: [PROVEN("saving")], exit: 0 },
  {
    dir: "pending/module-object",
    expect: [NOT_PROVEN("saving", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "pending/module-object-good", expect: [PROVEN("saving")], exit: 0 },
  {
    dir: "pending/self-alias",
    expect: [
      UNCHECKED("saving", "`self.saving = true` writes it in a way stateward does not follow"),
    ],
    exit: 0,
  },
  { dir: "pending/self-alias-good", expect: [PROVEN("saving")], exit: 0 },
  {
    dir: "pending/element-key",
    expect: [UNCHECKED("saving", "writes it in a way stateward does not follow")],
    exit: 0,
  },
  { dir: "pending/element-key-good", expect: [PROVEN("saving")], exit: 0 },
  // Pending: an object holding the state, written past every reference to it
  {
    dir: "pending/object-assign",
    expect: [
      UNCHECKED("saving", "`Object.assign(this, { saving: true })` writes `saving` by reflection"),
    ],
    exit: 0,
  },
  { dir: "pending/object-assign-good", expect: [PROVEN("saving")], exit: 0 },
  {
    dir: "pending/state-object",
    expect: [
      UNCHECKED(
        "saving",
        "`{ ...form, saving: true }` writes `saving` in a new object for the state",
      ),
    ],
    exit: 0,
  },
  { dir: "pending/state-object-good", expect: [PROVEN("saving")], exit: 0 },
  {
    dir: "pending/reducer-state",
    expect: [UNCHECKED("status", '`status: "saving"` writes it in an object literal')],
    exit: 0,
  },
  { dir: "pending/reducer-state-good", expect: [PROVEN("status")], exit: 0 },
  // JSDoc tags: each tag is a guarantee; what contradicts it is reported (not proven), and what
  // cannot be read is not checked, never taken at the tag's word.
  {
    dir: "tags/never-rejects-promise-reject",
    expect: [NOT_PROVEN("run", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`run` is tagged `@neverRejects`, but `Promise.reject(…)` can reject"] },
  },
  {
    dir: "tags/never-rejects-promise-reject-good",
    expect: [PROVEN("run")],
    exit: 0,
    check: { has: [], not: ["tagged `@neverRejects`"] },
  },
  {
    dir: "tags/never-rejects-json-parse",
    expect: [NOT_PROVEN("run")],
    exit: 1,
    check: { has: ["`run` is tagged `@neverRejects`, but `JSON.parse(…)` can throw"] },
  },
  {
    dir: "tags/never-rejects-json-parse-good",
    expect: [PROVEN("run")],
    exit: 0,
    check: { has: [], not: ["tagged `@neverRejects`"] },
  },
  {
    dir: "tags/never-rejects-throw",
    expect: [NOT_PROVEN("run")],
    exit: 1,
    check: { has: ["`run` is tagged `@neverRejects`, but it throws"] },
  },
  {
    dir: "tags/never-rejects-throw-good",
    expect: [PROVEN("run")],
    exit: 0,
    check: { has: [], not: ["tagged `@neverRejects`"] },
  },
  {
    dir: "tags/never-rejects-catch-rethrows",
    expect: [NOT_PROVEN("run")],
    exit: 1,
    check: { has: ["the `catch` rethrows: handle the error there instead"] },
  },
  {
    dir: "tags/never-rejects-catch-rethrows-good",
    expect: [PROVEN("run")],
    exit: 0,
    check: { has: [], not: ["tagged `@neverRejects`"] },
  },
  {
    dir: "tags/never-rejects-prop",
    expect: [NOT_PROVEN("onSearch", "not proven: 2 errors")],
    exit: 1,
    check: {
      has: [
        "`onSearch` is tagged `@neverRejects`, but in the function given to it, `fetch(…)` can reject",
      ],
    },
  },
  {
    dir: "tags/never-rejects-prop-good",
    expect: [PROVEN("onSearch"), PROVEN("safePost")],
    exit: 0,
  },
  {
    dir: "tags/never-rejects-executor",
    expect: [NOT_PROVEN("wait"), NOT_PROVEN("parse")],
    exit: 1,
    check: { has: ["`wait` is tagged `@neverRejects`, but `new Promise(…)` can reject"] },
  },
  {
    dir: "tags/never-rejects-executor-good",
    expect: [PROVEN("wait"), PROVEN("parse")],
    exit: 0,
  },
  {
    dir: "tags/never-rejects-return-in-try",
    expect: [NOT_PROVEN("save")],
    exit: 1,
    check: { has: ["`save` is tagged `@neverRejects`, but `post(…)` can reject"] },
  },
  { dir: "tags/never-rejects-return-in-try-good", expect: [PROVEN("save")], exit: 0 },
  {
    dir: "tags/never-rejects-new-array",
    expect: [UNCHECKED("make", "whether `new Array(…)` throws is not known")],
    exit: 0,
  },
  { dir: "tags/never-rejects-new-array-good", expect: [PROVEN("make")], exit: 0 },
  {
    dir: "tags/never-rejects-unfollowed",
    expect: [
      UNCHECKED("load", "whether `import(…)` rejects is not known"),
      UNCHECKED("drain", "whether `[post()]` rejects is not known"),
    ],
    exit: 0,
  },
  {
    dir: "tags/never-rejects-unfollowed-good",
    expect: [PROVEN("load"), PROVEN("drain")],
    exit: 0,
  },
  {
    dir: "tags/never-rejects-indirect",
    expect: [NOT_PROVEN("viaCall"), NOT_PROVEN("viaAlias"), NOT_PROVEN("run")],
    exit: 1,
    check: { has: ["`viaCall` is tagged `@neverRejects`, but `post.call(…)` can reject"] },
  },
  {
    dir: "tags/never-rejects-indirect-good",
    expect: [PROVEN("viaCall"), PROVEN("viaAlias"), PROVEN("run")],
    exit: 0,
  },
  {
    dir: "tags/throws-through-alias",
    expect: [UNCHECKED("load", "the call `check(…)` cannot be followed")],
    exit: 0,
    check: { has: ["not checked: the call `check(…)` cannot be followed"] },
  },
  {
    dir: "tags/throws-through-alias-good",
    expect: [PROVEN("load")],
    exit: 0,
    check: { has: [], not: ["cannot be followed", "does not list"] },
  },
  {
    dir: "tags/throws-held-error",
    expect: [NOT_PROVEN("held"), NOT_PROVEN("assigned")],
    exit: 1,
    check: { has: ["`@throws` of `held` does not list `BErr`"] },
  },
  { dir: "tags/throws-held-error-good", expect: [PROVEN("held"), PROVEN("assigned")], exit: 0 },
  {
    dir: "tags/throws-made-error",
    expect: [UNCHECKED("made", "what `makeB` throws is not known")],
    exit: 0,
  },
  { dir: "tags/throws-made-error-good", expect: [PROVEN("made")], exit: 0 },
  {
    dir: "tags/throws-accessor",
    expect: [
      UNCHECKED("read", "a getter or setter runs here"),
      UNCHECKED("write", "a getter or setter runs here"),
    ],
    exit: 0,
  },
  { dir: "tags/throws-accessor-good", expect: [PROVEN("read"), PROVEN("write")], exit: 0 },
  {
    dir: "tags/throws-generator",
    expect: [UNCHECKED("steps", "`steps` is a generator")],
    exit: 0,
  },
  { dir: "tags/throws-generator-good", expect: [PROVEN("steps")], exit: 0 },
  {
    dir: "tags/throws-call-method",
    expect: [NOT_PROVEN("viaCall"), NOT_PROVEN("run")],
    exit: 1,
    check: { has: ["`@throws` of `viaCall` does not list `BErr`"] },
  },
  {
    dir: "tags/throws-call-method-good",
    expect: [PROVEN("viaCall"), PROVEN("run")],
    exit: 0,
  },
  {
    dir: "tags/initial-start-not-listed",
    expect: [NOT_PROVEN("light")],
    exit: 1,
    check: { has: ['`useReducer` starts `light` in "yellow", which `@initial` does not list'] },
  },
  {
    dir: "tags/initial-start-not-listed-good",
    expect: [PROVEN("light")],
    exit: 0,
    check: { has: [], not: ["which `@initial` does not list"] },
  },
  {
    dir: "tags/initial-init-function",
    expect: [NOT_PROVEN("light")],
    exit: 1,
    check: { has: ['`useReducer` starts `light` in "yellow", which `@initial` does not list'] },
  },
  { dir: "tags/initial-init-function-good", expect: [PROVEN("light")], exit: 0 },
  {
    dir: "tags/initial-alias",
    expect: [
      UNCHECKED(
        "light",
        "gives the reducer another name, and stateward does not check where it starts",
      ),
    ],
    exit: 0,
  },
  { dir: "tags/initial-alias-good", expect: [PROVEN("light")], exit: 0 },
  // Round 4: a start object changed after it is made is not read as the start
  {
    dir: "tags/initial-start-changed",
    expect: [UNCHECKED("light", "starts the reducer in a state that is not known")],
    exit: 0,
  },
  { dir: "tags/initial-start-changed-good", expect: [PROVEN("light")], exit: 0 },
  {
    dir: "tags/initial-generic-hook",
    expect: [UNCHECKED("light", "gives the reducer to a function other than `useReducer`")],
    exit: 0,
  },
  { dir: "tags/initial-generic-hook-good", expect: [PROVEN("light")], exit: 0 },
  {
    dir: "tags/initial-direct-call",
    expect: [UNCHECKED("light", "calls the reducer directly")],
    exit: 0,
  },
  { dir: "tags/initial-direct-call-good", expect: [PROVEN("light")], exit: 0 },
  {
    dir: "tags/initial-string-state",
    expect: [UNCHECKED("light", "`light` is not read as a reducer")],
    exit: 0,
  },
  { dir: "tags/initial-string-state-good", expect: [PROVEN("light")], exit: 0 },
  {
    dir: "tags/final-destructured",
    expect: [UNCHECKED("Payment", "which state it leaves from is not known")],
    exit: 0,
  },
  { dir: "tags/final-destructured-good", expect: [PROVEN("Payment")], exit: 0 },
  {
    dir: "tags/final-status-copy",
    expect: [UNCHECKED("Payment", "which state it leaves from is not known")],
    exit: 0,
  },
  { dir: "tags/final-status-copy-good", expect: [PROVEN("Payment")], exit: 0 },
  {
    dir: "tags/final-switch-true",
    expect: [UNCHECKED("Payment", "which state it leaves from is not known")],
    exit: 0,
  },
  { dir: "tags/final-switch-true-good", expect: [PROVEN("Payment")], exit: 0 },
  {
    dir: "tags/final-predicate",
    expect: [UNCHECKED("Payment", "which state it leaves from is not known")],
    exit: 0,
  },
  { dir: "tags/final-predicate-good", expect: [PROVEN("Payment")], exit: 0 },
  // Proof fixes the ledger does not cover: a marked reference read wrongly.
  {
    dir: "release/finally-conditional",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/finally-conditional-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/conditional-start",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "release/conditional-start-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "release/reassigned-holder",
    expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
    exit: 1,
    check: { has: ["`stop` from `watchPrices(…)` is lost: `stop` is given another value"] },
  },
  { dir: "release/reassigned-holder-good", expect: [PROVEN("watchPrices")], exit: 0 },
  {
    dir: "stable/ref-current-copy",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "stable/ref-current-copy-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  {
    dir: "open-union/default-reject",
    expect: [NOT_PROVEN("OrderStatus", "not proven: 1 error")],
    exit: 1,
    check: { has: ["the `default` throws on a value outside `OrderStatus`"] },
  },
  { dir: "open-union/default-reject-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/default-reject-unknown",
    expect: [UNCHECKED("OrderStatus", "is returned by a function that does not return a promise")],
    exit: 0,
  },
  { dir: "open-union/default-reject-unknown-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/default-invariant",
    expect: [NOT_PROVEN("OrderStatus", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "open-union/default-invariant-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "open-union/default-assertion",
    expect: [UNCHECKED("OrderStatus", "the assertion `invariant(…)` may let the value through")],
    exit: 0,
  },
  { dir: "open-union/default-assertion-good", expect: [PROVEN("OrderStatus")], exit: 0 },
  {
    dir: "pending/for-await",
    expect: [NOT_PROVEN("saving", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "pending/for-await-good", expect: [PROVEN("saving")], exit: 0 },
  // Round 3: Release
  ...[
    ["release/loop", "is released only in a loop, which can run zero times"],
    ["release/while", "is released only in a loop, which can run zero times"],
    ["release/for-each", "is released only in a `forEach` callback"],
    ["release/effect-conditional-cleanup", "on some paths of the function that releases it"],
    ["release/ref-never-released", "is stored in `stop.current`, which the file never releases"],
    ["release/ref-other-released", "is stored in `prices.current`, which the file never releases"],
    ["release/inferred-wrapper", "the result of `start(…)` is never released"],
    ["release/method-wrapper", "the result of `api.start(…)` is never released"],
    ["release/static-wrapper", "the result of `Feed.start(…)` is never released"],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    {
      dir,
      expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")],
      exit: 1,
      check: { has: [says] },
    },
    { dir: `${dir}-good`, expect: [PROVEN("watchPrices")], exit: 0 },
  ]),
  {
    dir: "release/getter",
    expect: [
      UNCHECKED("watchPrices", "is returned from the getter `sub`, whose reads are not followed"),
    ],
    exit: 0,
  },
  { dir: "release/getter-good", expect: [PROVEN("watchPrices")], exit: 0 },
  // Round 3: Owned
  {
    dir: "owned/own-method",
    expect: [UNCHECKED("settings", "`settings.reset()` may change `settings`")],
    exit: 0,
  },
  { dir: "owned/own-method-good", expect: [PROVEN("settings")], exit: 0 },
  {
    dir: "owned/callback-array-argument",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "owned/callback-array-argument-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/destructured-parameter",
    expect: [NOT_PROVEN("session", "not proven: 1 error")],
    exit: 1,
  },
  { dir: "owned/destructured-parameter-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/arguments-object",
    expect: [UNCHECKED("session", "`rename(…)` may change `session`")],
    exit: 0,
  },
  { dir: "owned/arguments-object-good", expect: [PROVEN("session")], exit: 0 },
  {
    dir: "owned/readonly-prop",
    expect: [UNCHECKED("session", "<… value={…} />")],
    exit: 0,
  },
  // Noise: a prop no code can change through reads the value only.
  { dir: "owned/readonly-prop-good", expect: [PROVEN("session")], exit: 0 },
  // Round 3: Opaque
  ...["opaque/override-method", "opaque/override-field"].flatMap((dir): Case[] => [
    {
      dir,
      expect: [
        UNCHECKED(
          "OrderId",
          '`"bad"` is given by a class member whose base member (the one it overrides or implements) is typed `OrderId`',
        ),
      ],
      exit: 0,
    },
    { dir: `${dir}-good`, expect: [PROVEN("OrderId")], exit: 0 },
  ]),
  {
    dir: "opaque/state-of-brand",
    expect: [NOT_PROVEN("OrderId", '`OrderId` is built from `"bad"`')],
    exit: 1,
  },
  // Round 4: Opaque reads a library call that gives the brand, an ambient value, a union parameter
  {
    dir: "opaque/from-entries",
    expect: [
      UNCHECKED("OrderId", '`Object.fromEntries([["first", "bad"]])` is given as `OrderId`'),
    ],
    exit: 0,
  },
  { dir: "opaque/from-entries-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/declared",
    expect: [UNCHECKED("OrderId", "`magic` is declared with `declare`")],
    exit: 0,
  },
  { dir: "opaque/declared-good", expect: [PROVEN("OrderId")], exit: 0 },
  {
    dir: "opaque/union-parameter",
    expect: [NOT_PROVEN("OrderId", '`OrderId` is built from `"bad"`')],
    exit: 1,
  },
  { dir: "opaque/union-parameter-good", expect: [PROVEN("OrderId")], exit: 0 },
  // Noise: a type predicate that only drops `undefined` from the brand builds nothing.
  {
    dir: "opaque/predicate-filter",
    expect: [NOT_PROVEN("OrderId", "says a value is `OrderId` without its check")],
    exit: 1,
  },
  { dir: "opaque/predicate-filter-good", expect: [PROVEN("OrderId")], exit: 0 },
  // Round 4: Owned links `o ?? session` to `session`; a `typeof` helper is read at its calls; a
  // destructured plain value shown in JSX is a read
  ...["owned/nullish-fallback", "owned/typeof-helper", "owned/destructured-jsx"].flatMap(
    (dir): Case[] => [
      { dir, expect: [NOT_PROVEN("session", "is changed outside its owner")], exit: 1 },
      { dir: `${dir}-good`, expect: [PROVEN("session")], exit: 0 },
    ],
  ),
  // Noise: a state or a map of the brand made empty makes no value of it.
  { dir: "opaque/state-of-brand-good", expect: [PROVEN("OrderId")], exit: 0 },
  // Round 3: Pending
  ...[
    ["pending/sync-throw", "saving", "`saving` stays `true` when `JSON.parse(…)` fails"],
    ["pending/generator-yield", "saving", '`saving` stays `true` when `"saving"` fails'],
    ["pending/then-failure-callback", "saving", "`saving` stays `true` when `fetch(…)` fails"],
    // Round 4: `.catch` after a `.then` that resets does not reset on failure
    ["pending/then-catch-ignored", "saving", "`saving` stays `true` when `fetch(…)` fails"],
  ].flatMap(([dir = "", name = "", says = ""]): Case[] => [
    { dir, expect: [NOT_PROVEN(name)], exit: 1, check: { has: [says] } },
    { dir: `${dir}-good`, expect: [PROVEN(name)], exit: 0 },
  ]),
  // Round 4: a `useState` pair kept whole is listed, and its element reads are not checked
  {
    dir: "pending/tuple-kept",
    expect: [
      UNCHECKED("saving", "`saving[1]` (a read) is a use of `saving` that stateward does not read"),
    ],
    exit: 0,
  },
  { dir: "pending/tuple-kept-good", expect: [PROVEN("saving")], exit: 0 },
  // The setter alone states the state: it is listed, and its errors stand against it.
  {
    dir: "pending/setter-alone",
    expect: [NOT_PROVEN("setSaving", "not proven: 2 errors")],
    exit: 1,
    check: { has: ["`saving` stays `true` when `fetch(…)` fails"] },
  },
  { dir: "pending/setter-alone-good", expect: [PROVEN("saving")], exit: 0 },
  // Round 3: Stable
  {
    dir: "stable/module-const-property",
    expect: [NOT_PROVEN("ActionsContext", "not proven: 1 error")],
    exit: 1,
    check: { has: ["its value changes when `holder.current` changes"] },
  },
  { dir: "stable/module-const-property-good", expect: [PROVEN("ActionsContext")], exit: 0 },
  // Round 4: a holder is read only when every write to it is in its file and read
  ...[
    ["stable/holder-other-file", "which another file declares and may write"],
    [
      "stable/holder-alias",
      "which `same = holder` uses whole, where stateward does not follow a write to it",
    ],
    ["stable/holder-object-assign", "uses whole, where stateward does not follow a write to it"],
    [
      "stable/holder-class-field",
      "which is not an object written in place, so its own methods may write it",
    ],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED("ActionsContext", says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN("ActionsContext")], exit: 0 },
  ]),
  // Round 3: RequiredContext and SingleProvider
  {
    dir: "required-context/let-provider",
    expect: [NOT_PROVEN("ThemeContext")],
    exit: 1,
    check: { has: ["the component behind `<Provider>` cannot be followed"] },
  },
  { dir: "required-context/let-provider-good", expect: [PROVEN("ThemeContext")], exit: 0 },
  {
    dir: "single-provider/provider-in-memo",
    expect: [
      UNCHECKED(
        "StoreContext",
        "`<StoreContext.Provider>` is written in a callback of `useMemo`, which cannot be followed",
      ),
    ],
    exit: 0,
  },
  { dir: "single-provider/provider-in-memo-good", expect: [PROVEN("StoreContext")], exit: 0 },
  // Round 3: tags
  ...[
    ["tags/never-rejects-new-url", "pathOf", "whether `new URL(…)` throws is not known"],
    ["tags/never-rejects-reduce", "total", "whether `values.reduce(…)` throws is not known"],
  ].flatMap(([dir = "", name = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED(name, says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN(name)], exit: 0 },
  ]),
  {
    dir: "tags/final-left-spread",
    expect: [NOT_PROVEN("Payment", "not proven: 1 error")],
    exit: 1,
    check: { has: ['error[reducers/state-cannot-leave]: "paid" is marked final'] },
  },
  { dir: "tags/final-left-spread-good", expect: [PROVEN("Payment")], exit: 0 },
  // Round 3: latest wins (a loader that takes an AbortSignal)
  ...[
    [
      "latest-wins/conditional-abort",
      "effect aborts `controller` only on some paths of its cleanup",
    ],
    ["latest-wins/no-signal", "`fetchUser(…)` takes an AbortSignal the effect never passes"],
    ["latest-wins/other-controller", "effect never aborts `controller` in its cleanup"],
    // Round 4: a flag checked before the `await` does not drop the late answer
    [
      "latest-wins/flag-before-await",
      "`fetchUser(…)` takes an AbortSignal the effect never passes",
    ],
    // Round 5: a flag set back after the `await` does not tell a late answer
    ["latest-wins/flag-set-back", "`fetchUser(…)` takes an AbortSignal the effect never passes"],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [NOT_PROVEN("fetchUser", says)], exit: 1, check: { has: [says] } },
    { dir: `${dir}-good`, expect: [PROVEN("fetchUser")], exit: 0 },
  ]),
  // Round 3: OpenUnion
  ...[
    [
      "open-union/default-never-check",
      "the `default` only checks against `never`, so a value outside `OrderStatus` goes through unhandled",
    ],
    ["open-union/default-void-helper", "the `default` throws on a value outside `OrderStatus`"],
    ["open-union/default-new-promise", "the `default` throws on a value outside `OrderStatus`"],
    // Round 4: the throwing endings are a closed list, read through helpers, methods and code after the switch
    ...[
      "default-break-then-throw",
      "default-async-iife",
      "default-await-reject",
      "default-never-kept",
      "default-throwing-helper",
      "default-throwing-method",
    ].map((one) => [`open-union/${one}`, "the `default` throws on a value outside `OrderStatus`"]),
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [NOT_PROVEN("OrderStatus")], exit: 1, check: { has: [says] } },
    { dir: `${dir}-good`, expect: [PROVEN("OrderStatus")], exit: 0 },
  ]),
  ...[
    ["open-union/includes", "`done.includes(status)`, a call that decides by `status`"],
    ["open-union/map-get", "`labels.get(status)`, a call that decides by `status`"],
    ["open-union/object-is", '`Object.is(status, "paid")`, a call that decides by `status`'],
    [
      "open-union/derived-switch",
      "`status.toUpperCase()`, a value made from the union, is not read as a switch",
    ],
    [
      "open-union/lookup-fallback",
      "the lookup `labels[status]` by `status` is not read as a switch",
    ],
    // Round 4: any value made from the union, or a call that answers by it, decides by it
    ["open-union/cast-switch", "`status as string`, a value made from the union"],
    ["open-union/string-switch", "`String(status)`, a value made from the union"],
    ["open-union/template-switch", "``${status}``, a value made from the union"],
    ["open-union/starts-with", '`status.startsWith("p")`, a value made from the union'],
    ["open-union/regex-test", "`/^(paid|shipped)$/.test(status)`, a call that decides by `status`"],
    ["open-union/reflect-get", "`Reflect.get(labels, status)`, a call that decides by `status`"],
    ["open-union/has-own", "`Object.hasOwn(labels, status)`, a call that decides by `status`"],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED("OrderStatus", says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN("OrderStatus")], exit: 0 },
  ]),
  // Round 5: Release reads the platform's calls on the platform's own types only, and a release
  // that a caught throw skips is not on every path
  ...[
    "release/try-catch-skips",
    "release/try-catch-skips-statement",
    "release/element-read",
    "release/element-getter",
    "release/iterable-union",
    "release/new-set-iterable",
    "release/number-of-unknown",
    "release/string-of-unknown",
    "release/join-unknown",
    "release/to-string-base",
    "release/headers-set",
    "release/reflect-get",
    "release/map-subclass",
    "release/class-list-add",
  ].flatMap((dir): Case[] => [
    { dir, expect: [NOT_PROVEN("watchPrices", "not proven: 1 error")], exit: 1 },
    { dir: `${dir}-good`, expect: [PROVEN("watchPrices")], exit: 0 },
  ]),
  // Noise: code between the start and the release that cannot throw.
  ...[
    "release/divide-good",
    "release/remainder-good",
    "release/destructure-good",
    "release/reduce-good",
    "release/is-finite-good",
    "release/instanceof-good",
    "release/array-spread-good",
    // Round 6: a property is read as declared, and the platform's plain calls on its own types
    "release/interface-property-good",
    "release/brand-string-good",
    "release/date-get-time-good",
    "release/to-fixed-good",
    "release/map-values-loop-good",
    "release/object-entries-good",
    "release/array-from-good",
    "release/number-parse-int-good",
  ].map((dir): Case => ({ dir, expect: [PROVEN("watchPrices")], exit: 0 })),
  // A limit, not a proof (round 6): a member declared as a property is read as one, so a class
  // that gives an interface's property as a getter is not seen, nor a getter `Object.values` runs.
  ...["release/interface-getter", "release/object-values"].flatMap((dir): Case[] => [
    { dir, expect: [PROVEN("watchPrices")], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN("watchPrices")], exit: 0 },
  ]),
  ...[
    ["tags/never-rejects-interface-getter", "port"],
    ["tags/throws-interface-getter", "port"],
  ].flatMap(([dir = "", name = ""]): Case[] => [
    { dir, expect: [PROVEN(name)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN(name)], exit: 0 },
  ]),
  // Round 5: Pending counts a getter or setter, an element read, a tagged template and a `for…of`
  // over an iterable as work; a reset in an earlier link of a chain does not cover later ones; a
  // function that leaves the state running is not started twice only by a test of this state
  ...[
    ["pending/getter-work", "`saving` stays `true` when `this.total` fails"],
    ["pending/setter-work", "`saving` stays `true` when `this.value` fails"],
    ["pending/element-work", "`saving` stays `true` when `this.items[0]` fails"],
    ["pending/tagged-template", "`saving` stays `true` when"],
    ["pending/for-of-iterable", "`saving` stays `true` when `items` fails"],
    ["pending/catch-then", "`saving` stays `true` when"],
    ["pending/chain-twice", "`run` starts again while `saving` is `true`"],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [NOT_PROVEN("saving")], exit: 1, check: { has: [says] } },
    { dir: `${dir}-good`, expect: [PROVEN("saving")], exit: 0 },
  ]),
  ...["pending/guard-nested", "pending/guard-other", "pending/disabled-other"].flatMap(
    (dir): Case[] => [
      {
        dir,
        expect: [UNCHECKED("saving", "tests `saving` in a way stateward does not read")],
        exit: 0,
      },
      { dir: `${dir}-good`, expect: [PROVEN("saving")], exit: 0 },
    ],
  ),
  // Noise: a ref whose every write mirrors the state guards the start.
  { dir: "pending/ref-mirror-good", expect: [PROVEN("saving")], exit: 0 },
  // Round 5: tags read the platform's calls on its own types, a getter behind an interface, an
  // element that may not be there, and `Promise.any`
  ...[
    ["tags/never-rejects-element-read", "firstLen", "whether `xs[0]` throws is not known"],
    ["tags/never-rejects-new-set-iterable", "uniq", "whether `new Set(…)` throws is not known"],
    ["tags/never-rejects-to-string-base", "show", "whether `n.toString(…)`"],
  ].flatMap(([dir = "", name = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED(name, says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN(name)], exit: 0 },
  ]),
  ...[
    ["tags/never-rejects-promise-any", "first"],
    ["tags/throws-to-string-base", "show"],
    ["tags/throws-headers-set", "put"],
  ].flatMap(([dir = "", name = ""]): Case[] => [
    { dir, expect: [NOT_PROVEN(name, "not proven: 1 error")], exit: 1 },
    { dir: `${dir}-good`, expect: [PROVEN(name)], exit: 0 },
  ]),
  // Round 5: OpenUnion reads a `default` that returns a value built from a throw, and a lookup
  // whose fallback throws, as not checked; a value handed to a closed union and a `<` comparison
  // are decided flows
  ...[
    ["open-union/default-wrapped-fail", "`fail(s)` can throw"],
    ["open-union/default-array-of-fail", "`fail(s)` can throw"],
    ["open-union/default-nullish-fail", "`fail(s)` can throw"],
    ["open-union/default-json-parse", '`JSON.parse("")` can throw'],
    ["open-union/default-throwing-constructor", "`new Unreachable(s)` can throw"],
    ["open-union/default-getter", "`this.bad` can throw"],
    ["open-union/lookup-fail-fallback", "whose fallback `fail(s)` can throw"],
    ["open-union/closed-parameter", "`text(s)`, a call that decides by `s`"],
    ["open-union/closed-variable", "is not read as a switch"],
    ["open-union/relational", "the `if` on `s`"],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED("OrderStatus", says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN("OrderStatus")], exit: 0 },
  ]),
  // Round 5: Owned reads a `Readonly` prop handed to a writable parameter or `Object.assign`, and
  // an element a generic function of the project hands to its callback
  ...[
    ["owned/readonly-prop-to-writable", "gives `settings` to a component, which is not followed"],
    ["owned/readonly-prop-object-assign", "gives `settings` to a component, which is not followed"],
    ["owned/generic-callback-writes", "`each(…)` may change `settings`"],
  ].flatMap(([dir = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED("settings", says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN("settings")], exit: 0 },
  ]),
  // Round 5: Opaque reads `++`, `--` and a compound assignment of a brand as a value it makes
  ...[
    ["opaque/decrement", "Positive", "`p--` is given as `Positive`"],
    ["opaque/minus-assign", "Positive", "`p -= 100` is given as `Positive`"],
    ["opaque/plus-assign", "OrderId", '`id += "!bad"` is given as `OrderId`'],
    ["opaque/field-plus-assign", "OrderId", "`this.id += s` is given as `OrderId`"],
  ].flatMap(([dir = "", name = "", says = ""]): Case[] => [
    { dir, expect: [UNCHECKED(name, says)], exit: 0 },
    { dir: `${dir}-good`, expect: [PROVEN(name)], exit: 0 },
  ]),
];

afterAll(removeCopies);

type Listed = { name: string; status: string; declaration?: string; rule?: string };

function isListed(value: unknown): value is Listed {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "status" in value &&
    typeof value.status === "string"
  );
}

type Reported = { kind: string; ruleId: string; severity?: string; guarantees?: string[] };

function isReported(value: unknown): value is Reported {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "ruleId" in value &&
    typeof value.ruleId === "string"
  );
}

/** The findings `stateward check --format json` lists. */
function reportedOf(stdout: string): Reported[] {
  const parsed: unknown = JSON.parse(stdout);
  const list =
    typeof parsed === "object" && parsed !== null && "findings" in parsed
      ? parsed.findings
      : undefined;
  if (!Array.isArray(list) || !list.every(isReported)) throw new Error("unexpected findings");
  return list;
}

function listedOf(stdout: string): Listed[] {
  const parsed: unknown = JSON.parse(stdout);
  const list =
    typeof parsed === "object" && parsed !== null && "guarantees" in parsed
      ? parsed.guarantees
      : undefined;
  if (!Array.isArray(list) || !list.every(isListed)) throw new Error("unexpected guarantees");
  return list;
}

/** Every file of a folder, read as text, through its subfolders. */
function textsIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    return entry.isDirectory() ? textsIn(at) : [readFileSync(at, "utf8")];
  });
}

/**
 * Whether a case keeps every finding at its own severity: no config but the React pack, and no
 * ignore comment in its files.
 */
function lowersNothing(dir: string): boolean {
  const config = path.join(root, dir, "config.json");
  if (existsSync(config)) {
    const parsed: unknown = JSON.parse(readFileSync(config, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return false;
    if (Object.keys(parsed).some((key) => key !== "react")) return false;
  }
  return !textsIn(path.join(root, dir, "src")).some((text) => text.includes("stateward-ignore"));
}

/** The lines of the pretty output that belong to the guarantee `name` (to the next blank line). */
function blockOf(pretty: string, name: string): string {
  return (
    pretty
      .split("\n\n")
      .find((block) => block.startsWith(`${name}:`) || block.includes(`\n${name}:`)) ?? ""
  );
}

describe(
  "the adversarial set: no guarantee reads proven while the problem stays",
  {
    timeout: 60_000,
  },
  () => {
    for (const one of CASES) {
      it(`${one.dir}: ${one.expect.map((entry) => `${entry.name} ${entry.status}`).join(", ")}`, async () => {
        const { project, cache } = prepare(one.dir);
        const json = await run(["guarantees", "--format", "json"], project, cache);
        expect(json.stderr).toBe("");
        const listed = listedOf(json.stdout);
        for (const entry of one.expect) {
          expect(
            listed.filter((item) => item.name === entry.name).map((item) => item.status),
            `${one.dir}: ${entry.name}`,
          ).toEqual([entry.status]);
        }
        expect(json.code).toBe(one.exit);
        // `check` and `guarantees` agree: an error `check` links to a guarantee is never read as
        // proven or unused by `guarantees`.
        const checked = await run(["check", "--format", "json"], project, cache);
        for (const finding of reportedOf(checked.stdout)) {
          if (finding.kind !== "problem" || finding.severity !== "error") continue;
          for (const id of finding.guarantees ?? []) {
            const named = listed.filter(
              (item) => item.declaration === id && item.rule === finding.ruleId,
            );
            expect(named.length, `${one.dir}: no guarantee for ${id}`).toBeGreaterThan(0);
            for (const item of named) {
              expect(["proven", "unused"], `${one.dir}: ${item.name}`).not.toContain(item.status);
            }
          }
        }
        // `check` and `guarantees` agree. An error `check` links to a guarantee
        // makes `guarantees` exit 1; and a guarantee read "not proven" is an error in `check`,
        // unless the case lowers it on purpose (a severity or option in its config, an ignore
        // comment), which hides it from `check` and still leaves the guarantee not proven.
        const findings = reportedOf(checked.stdout);
        const linkedError = findings.some(
          (finding) =>
            finding.kind === "problem" &&
            finding.severity === "error" &&
            (finding.guarantees ?? []).length > 0,
        );
        if (linkedError) expect(json.code, `${one.dir}: check has a linked error`).toBe(1);
        if (lowersNothing(one.dir) && listed.some((item) => item.status === "unproven")) {
          expect(checked.code, `${one.dir}: a guarantee is not proven`).toBe(1);
        }
        const pretty = await run(["guarantees"], project, cache);
        for (const entry of one.expect) {
          if (entry.says !== undefined)
            expect(blockOf(pretty.stdout, entry.name)).toContain(entry.says);
        }
        expect(pretty.code).toBe(one.exit);
        if (one.check !== undefined) {
          // `--verbose` lists the places not checked, which `check` counts quietly otherwise.
          const shown = await run(["check", "--no-cache", "--verbose"], project, cache);
          for (const text of one.check.has) expect(shown.stdout, one.dir).toContain(text);
          for (const text of one.check.not ?? []) expect(shown.stdout, one.dir).not.toContain(text);
        }
      });
    }

    it("exits 1 exactly when a case has a guarantee that is not proven", () => {
      // The documented rule: not checked and off exit 0; not proven exits 1.
      for (const one of CASES) {
        expect(one.exit, one.dir).toBe(
          one.expect.some((entry) => entry.status === "unproven") ? 1 : 0,
        );
      }
    });

    it("has a good case for every adversarial one", () => {
      // `if-chain-throwing-else` and `if-chain-handled` are fixed by the same code as
      // `if-chain-no-else`; a rule turned off for a file has no fix in the code;
      // `module-object-settled` is `module-object` fixed in place, a second good twin.
      const alone = [
        "open-union/if-chain-throwing-else",
        "open-union/if-chain-handled",
        "pending/module-object-settled",
      ];
      const bad = CASES.map((one) => one.dir).filter(
        (dir) => !dir.endsWith("-good") && !dir.endsWith("-off-for-file") && !alone.includes(dir),
      );
      expect(bad.filter((dir) => !CASES.some((one) => one.dir === `${dir}-good`))).toEqual([]);
    });
  },
);
