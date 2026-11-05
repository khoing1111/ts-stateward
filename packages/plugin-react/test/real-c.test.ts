import { describe, expect, it } from "vitest";
import { check, fixture, shown, type Shown } from "./helpers.js";

/** The shapes of a real project's later feedback. */
const REAL_C = fixture("real-c");

const ofRule = (rule: string): Shown[] =>
  shown(REAL_C, check(REAL_C, { [`react/${rule}`]: "warning" })).filter(
    (finding) => finding.rule === `react/${rule}`,
  );

describe("react/state-copies-prop", () => {
  it("suggests a derived value when the state is also set to a constant; a draft keeps the `key` advice", () => {
    expect(ofRule("state-copies-prop")).toEqual([
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Blocker.tsx",
        at: "setShouldBlock(isDirty)",
        message:
          "`shouldBlock` follows the prop `isDirty` except when set elsewhere, kept in step by an effect",
        hint: "derive it from `isDirty` and whatever sets it to `false` (in `handleProceed`): `const shouldBlock = isDirty && !<that state>`",
        notes: [
          "Blocker.tsx: useState(isDirty): `shouldBlock` starts as `isDirty` here",
          "Blocker.tsx: setShouldBlock(false): `shouldBlock` is set here, not from `isDirty`",
        ],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Blocker.tsx",
        at: "setText(query)",
        message:
          "`text` follows the prop `query` except when set elsewhere, kept in step by an effect",
        hint: 'derive it from `query` and whatever sets it to `""` (in `onClear`): `const text = <that state> ? "" : query`',
        notes: [
          "Blocker.tsx: useState(query): `text` starts as `query` here",
          'Blocker.tsx: setText(""): `text` is set here, not from `query`',
        ],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Blocker.tsx",
        at: "setDraft(body)",
        message:
          "an effect overwrites the draft `draft` with `body` whenever it changes, losing edits",
        hint: "drop the effect and render `<Note key={…}>` so the draft starts over when `body` changes",
        notes: ["Blocker.tsx: useState(body): `draft` starts as `body` here"],
        fixes: [],
      },
    ]);
  });
});
