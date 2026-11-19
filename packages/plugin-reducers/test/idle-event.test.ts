import { describe, expect, it } from "vitest";
import { check, fixture, shown } from "./helpers.js";

const DIR = fixture("graph/refund");
const RULE = "reducers/state-unreachable";

describe(`${RULE}: a case that exists and does nothing`, () => {
  const [found] = shown(
    DIR,
    check(DIR).filter((one) => one.ruleId === RULE),
  );

  it("says to return the state from that case, not to add an event", () => {
    expect(found?.message).toBe('`order` never reaches "refunded": no case returns it');
    expect(found?.hint).toBe(
      [
        "one of",
        '- return "refunded" from a case: `refund` returns the state unchanged now',
        '- or remove "refunded" from `OrderState`, if it is not used',
        '- or, if "refunded" is entered from outside the reducer, list it under the rule\'s `ignoreStates` option',
      ].join("\n"),
    );
    // The old line, which says to add an event that already exists.
    expect(found?.hint).not.toContain("add the event that leads to");
  });
});
