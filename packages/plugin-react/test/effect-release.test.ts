import { describe, expect, it } from "vitest";
import { react } from "../src/index.js";
import { check, fixture, shown } from "./helpers.js";

const DIR = fixture("effects-release");

describe("react/effect-missing-cleanup: the release trait", () => {
  const found = shown(DIR, check(DIR, {}, [react()])).filter(
    (finding) => finding.rule === "react/effect-missing-cleanup",
  );

  it("reports a value whose release trait is stated, whatever its name, and says where the trait comes from", () => {
    expect(found.map(({ at, message, hint, notes }) => ({ at, message, hint, notes }))).toEqual([
      {
        at: "watchFeed((item) => setItems((current) => [...current, item]))",
        message: "`watchFeed(…)` returns a release function that the effect never calls",
        hint: "return it as the cleanup: `return watchFeed(…);`",
        notes: [
          "FeedList.tsx: watchFeed((item) => setItems((current) => [...current, item])): `watchFeed` returns a release function (its return type is stated `Release`)",
        ],
      },
      {
        at: "connect()",
        message: "`connect(…)` returns a value that the effect never releases",
        hint: "end it in the cleanup: `return () => socket[Symbol.dispose]();`",
        notes: [
          "FeedList.tsx: connect(): `connect` returns a value released with `using` or `[Symbol.dispose]()` (its type, `Disposable`)",
        ],
      },
    ]);
  });
});
