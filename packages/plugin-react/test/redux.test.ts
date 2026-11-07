import { describe, expect, it } from "vitest";
import { check, fixture, shown } from "./helpers.js";

const REDUX = fixture("redux");
const RULE = "react/dependency-changes-every-render";

const handlers = {
  rule: RULE,
  severity: "unknown",
  file: "Board.tsx",
  at: "onOpen",
  message:
    "not checked: whether `onOpen` from `useStableCardHandlers()` is new each render: `useStableCardHandlers` is not a module-level function",
  hint: "declare `useStableCardHandlers` as a module-level function (`function useX() { … }`), so it can be checked",
  notes: [],
  fixes: [],
};

describe("react/dependency-changes-every-render: values packages keep stable (react-redux, RTK Query, react-router)", () => {
  it("says nothing of dispatch, the store, navigate, RTK Query triggers, refetch and data, or React's setters", () => {
    expect(shown(REDUX, check(REDUX))).toEqual([handlers]);
  });

  it("with `stableHooks`, takes every value of the named hooks as stable", () => {
    expect(check(REDUX, { [RULE]: ["warning", { stableHooks: ["useStable*Handlers"] }] })).toEqual(
      [],
    );
  });
});
