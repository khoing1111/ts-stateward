import { describe, expect, it } from "vitest";
import type { OptionValue } from "@stateward/core";
import { react } from "../src/index.js";
import { check, fixture, shown, type Shown } from "./helpers.js";

/** The shapes of a real project's first round of feedback. */
const REAL_B = fixture("real-b");

const ofRule = (rule: string, options: Record<string, OptionValue> = {}): Shown[] =>
  shown(
    REAL_B,
    check(REAL_B, { [`react/${rule}`]: ["warning", options] }, [react()], ["react/effect-race"]),
  ).filter((finding) => finding.rule === `react/${rule}`);

describe("react/effect-missing-cleanup", () => {
  it("accepts an unmount cleanup in another effect, an observer from a ternary, an unsubscribe in a variable; asks only for an unmount cleanup for a debounce timer", () => {
    expect(ofRule("effect-missing-cleanup")).toEqual([
      {
        rule: "react/effect-missing-cleanup",
        severity: "warning",
        file: "Cleanups.tsx",
        at: "setTimeout(() => setDebounced(query), 300)",
        message:
          "the timeout in `debounceRef.current` is cleared before each new one, but not on unmount",
        hint: "clear it on unmount, in an effect of its own:\n    useEffect(() => () => clearTimeout(debounceRef.current), []);",
        notes: [],
        fixes: [],
      },
      {
        rule: "react/effect-missing-cleanup",
        severity: "warning",
        file: "Cleanups.tsx",
        at: "window.setTimeout(() => setFlash(id), 500)",
        message: "effect starts a timeout that sets `flash` and never clears it",
        hint: "clear it in the cleanup: `return () => clearTimeout(flashRef.current);`",
        notes: [],
        fixes: [],
      },
    ]);
  });
});

const REDUX = fixture("real-b-redux");
const RACE = "react/effect-response-race";
const raceIn = (options: Record<string, OptionValue> = {}): Shown[] =>
  shown(REDUX, check(REDUX, { [RACE]: ["error", options] }, [react()], [])).filter(
    (finding) => finding.rule === RACE,
  );
const raceHint = (call: string, passed: string): string =>
  `create a controller in the effect, pass its signal to \`${call}\`, and abort it in the cleanup:\n    const controller = new AbortController();\n    ${passed}\n    return () => controller.abort();`;
const STALE = "state is set from the answer";

describe("react/effect-response-race", () => {
  it("never names a value that keeps its identity (dispatch, navigate, an RTK Query trigger) as the input, and skips an effect that runs once", () => {
    expect(raceIn()).toEqual([
      {
        rule: RACE,
        severity: "error",
        file: "Orders.tsx",
        at: "fetchOrders()",
        message:
          "`fetchOrders(…)` takes an AbortSignal the effect never passes: an answer for an old `filter` can overwrite a newer one",
        hint: raceHint("fetchOrders(…)", "fetchOrders(controller.signal)"),
        notes: [`Orders.tsx: setOrders(found.filter((order) => order.includes(filter))): ${STALE}`],
        fixes: [
          "Orders.tsx@446: const controller = new AbortController();\n     | Orders.tsx@458: controller.signal | Orders.tsx@594: \n    return () => controller.abort();",
        ],
      },
      {
        rule: RACE,
        severity: "error",
        file: "Orders.tsx",
        at: 'reload("open")',
        message:
          "`reload(…)` takes an AbortSignal the effect never passes: an answer for an old `reload` can overwrite a newer one",
        hint: raceHint("reload(…)", "reload(…, controller.signal)"),
        notes: [`Orders.tsx: setOrders: ${STALE}`],
        fixes: [
          "Orders.tsx@1423: const controller = new AbortController();\n     | Orders.tsx@1436: , controller.signal | Orders.tsx@1454: \n    return () => controller.abort();",
        ],
      },
      // An object from a hook not in `stableHooks` can change (real-world corpus: outline's stores).
      {
        rule: RACE,
        severity: "error",
        file: "Orders.tsx",
        at: 'store.reload("all")',
        message:
          "`store.reload(…)` takes an AbortSignal the effect never passes: an answer for an old `store` can overwrite a newer one",
        hint: raceHint("store.reload(…)", "store.reload(…, controller.signal)"),
        notes: [`Orders.tsx: setOrders: ${STALE}`],
        fixes: [
          "Orders.tsx@1748: const controller = new AbortController();\n     | Orders.tsx@1766: , controller.signal | Orders.tsx@1784: \n    return () => controller.abort();",
        ],
      },
    ]);
  });
  it("takes the values of `stableHooks` as keeping their identity: the effect runs once", () => {
    expect(raceIn({ stableHooks: ["use*Store"] }).map((finding) => finding.at)).toEqual([
      "fetchOrders()",
    ]);
  });
});

describe("react/state-copies-prop", () => {
  it("skips debounce and throttle hooks and previous-value counters; a draft gets only the `key` fix", () => {
    expect(ofRule("state-copies-prop")).toEqual([
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Copies.tsx",
        at: "setDraft(title)",
        message:
          "effect overwrites the draft `draft` with `title` whenever it changes: edits are lost",
        hint: "drop the effect and render `<TitleEditor key={…}>` so the draft starts over when `title` changes",
        notes: ["Copies.tsx: useState(title): `draft` starts as `title`"],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Copies.tsx",
        at: "setText(initial)",
        message:
          "effect overwrites the draft `text` with `initial` whenever it changes: edits are lost",
        hint: "drop the effect and reset the component with a `key` that changes with `initial`, so the draft starts over",
        notes: ["Copies.tsx: useState(initial): `text` starts as `initial`"],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Copies.tsx",
        at: "setShown(label)",
        message: "`shown` copies the prop `label` and an effect keeps them in sync",
        hint: "use `label` directly, or drop the effect and render `<Badge key={…}>` so it starts over when `label` changes",
        notes: ["Copies.tsx: useState(label): `shown` starts as `label`"],
        fixes: [],
      },
    ]);
  });
});

describe("react/dependency-changes-every-render", () => {
  const copied: Shown = {
    rule: "react/dependency-changes-every-render",
    severity: "warning",
    file: "RunPanel.tsx",
    at: "handlers",
    message:
      "effect runs after every render: `handlers` from `bindRunHandlers(…)` is a new object each time",
    hint: "make `{ ...run }`, an argument of `bindRunHandlers({ ...run })`, stable first, then wrap the call in `useMemo`: it is new every render too",
    notes: [
      "RunPanel.tsx: { onStop: () => run.stop(), onRetry: () => run.retry() }: `handlers` is created on every call of `bindRunHandlers`",
    ],
    fixes: [],
  };
  it("reports a memoized function's value it cannot see is memoized", () => {
    expect(ofRule("dependency-changes-every-render").map((finding) => finding.hint)).toEqual([
      "wrap the call in `useMemo` on its inputs: `useMemo(() => bindRunHandlers(run), [run])`",
      copied.hint,
    ]);
  });
  it("with `stableFunctions`, takes its value as stable, unless an argument is new every render", () => {
    expect(
      ofRule("dependency-changes-every-render", { stableFunctions: ["bind*Handlers"] }),
    ).toEqual([copied]);
  });
});
