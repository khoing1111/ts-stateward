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
        message: "this effect starts a timeout that sets `flash` and never clears it",
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
  shown(
    REDUX,
    check(REDUX, { [RACE]: ["warning", options] }, [react()], ["react/effect-race"]),
  ).filter((finding) => finding.rule === RACE);
const raceHint = (setter: string): string =>
  `ignore a response that arrives after the effect is cleaned up:\n    let ignore = false;\n    … if (!ignore) ${setter}(…);\n    return () => { ignore = true; };`;

describe("react/effect-response-race", () => {
  it("never names a value that keeps its identity (dispatch, navigate, an RTK Query trigger) as the input", () => {
    expect(raceIn()).toEqual([
      {
        rule: RACE,
        severity: "warning",
        file: "Orders.tsx",
        at: "setOrders(found.filter((order) => order.includes(filter)))",
        message: "a slow response for an old `filter` can overwrite a newer one",
        hint: raceHint("setOrders"),
        notes: ["Orders.tsx: fetchOrders(): the request that can answer late"],
        fixes: [],
      },
      {
        rule: RACE,
        severity: "warning",
        file: "Orders.tsx",
        at: "setOrders",
        message: "a slow response for an old `reload` can overwrite a newer one",
        hint: raceHint("setOrders"),
        notes: ['Orders.tsx: reload("open"): the request that can answer late'],
        fixes: [],
      },
      // An object from a hook not in `stableHooks` can change (real-world corpus: outline's stores).
      {
        rule: RACE,
        severity: "warning",
        file: "Orders.tsx",
        at: "setOrders",
        message: "a slow response for an old `store` can overwrite a newer one",
        hint: raceHint("setOrders"),
        notes: ['Orders.tsx: store.reload("all"): the request that can answer late'],
        fixes: [],
      },
    ]);
  });
  it("takes the values of `stableHooks` as keeping their identity", () => {
    expect(raceIn({ stableHooks: ["use*Store"] }).map((finding) => finding.at)).toEqual([
      "setOrders(found.filter((order) => order.includes(filter)))",
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
          "an effect overwrites the draft `draft` with `title` whenever it changes, losing edits",
        hint: "drop the effect and render `<TitleEditor key={…}>` so the draft starts over when `title` changes",
        notes: ["Copies.tsx: useState(title): `draft` starts as `title` here"],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Copies.tsx",
        at: "setText(initial)",
        message:
          "an effect overwrites the draft `text` with `initial` whenever it changes, losing edits",
        hint: "drop the effect and reset the component with a `key` that changes with `initial`, so the draft starts over",
        notes: ["Copies.tsx: useState(initial): `text` starts as `initial` here"],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Copies.tsx",
        at: "setShown(label)",
        message:
          "`shown` is a copy of the prop `label`, kept in step by an effect: two sources of truth",
        hint: "use `label` directly, or drop the effect and render `<Badge key={…}>` so it starts over when `label` changes",
        notes: ["Copies.tsx: useState(label): `shown` starts as `label` here"],
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
      "`handlers` from `bindRunHandlers(…)` is a new object every render, so this effect runs after every render",
    hint: "`{ ...run }`, an argument of `bindRunHandlers({ ...run })`, is new every render too: make it stable first, then wrap the call in `useMemo`",
    notes: [
      "RunPanel.tsx: { onStop: () => run.stop(), onRetry: () => run.retry() }: `handlers` is created here on every call of `bindRunHandlers`",
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
