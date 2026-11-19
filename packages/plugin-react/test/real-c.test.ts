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
          "`shouldBlock` copies the prop `isDirty`, except when set elsewhere, and an effect keeps them in sync",
        hint: 'one of\n- derive it from `isDirty`: add a state that `handleProceed` sets to the current `isDirty` in place of setting `shouldBlock` to `false`, and use `false` only while that state equals `isDirty`\n- or drop the effect and render `<LeaveGuard key={…}>` so it starts over when `isDirty` changes\n- or if the prop is meant to reset `shouldBlock` this way, list it under the rule\'s `ignore` option:\n    { ignore: ["shouldBlock"] }',
        notes: [
          "Blocker.tsx: useState(isDirty): `shouldBlock` starts as `isDirty`",
          "Blocker.tsx: setShouldBlock(false): `shouldBlock` is set, not from `isDirty`",
        ],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Blocker.tsx",
        at: "setText(query)",
        message:
          "`text` copies the prop `query`, except when set elsewhere, and an effect keeps them in sync",
        hint: 'one of\n- derive it from `query`: add a state that `onClear` sets to the current `query` in place of setting `text` to `""`, and use `""` only while that state equals `query`\n- or drop the effect and render `<Filter key={…}>` so it starts over when `query` changes\n- or if the prop is meant to reset `text` this way, list it under the rule\'s `ignore` option:\n    { ignore: ["text"] }',
        notes: [
          "Blocker.tsx: useState(query): `text` starts as `query`",
          'Blocker.tsx: setText(""): `text` is set, not from `query`',
        ],
        fixes: [],
      },
      {
        rule: "react/state-copies-prop",
        severity: "warning",
        file: "Blocker.tsx",
        at: "setDraft(body)",
        message:
          "effect overwrites the draft `draft` with `body` whenever it changes: edits are lost",
        hint: 'one of\n- drop the effect and render `<Note key={…}>` so the draft starts over when `body` changes\n- or if the prop is meant to reset `draft` this way, list it under the rule\'s `ignore` option:\n    { ignore: ["draft"] }',
        notes: ["Blocker.tsx: useState(body): `draft` starts as `body`"],
        fixes: [],
      },
    ]);
  });
});
