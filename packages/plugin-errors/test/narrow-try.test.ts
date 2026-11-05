import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding, TextEdit } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "narrow-try";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

function bug(expected: string, rest: string): string {
  return `a bug here would be handled like a failed \`${expected}\`; move ${rest}`;
}

/** Applies the edits to the text, last first so earlier offsets stay valid. */
function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

describe(`errors/${RULE}: lines after the expected call that can only fail as bugs`, () => {
  it("names the line and the call the try is for", () => {
    expect(shown(flagged())).toEqual([
      says(
        "access.ts",
        "`onOpen()` is inside the `try` meant for `throw new AccessError(…)`",
        bug(
          "throw new AccessError(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
        ),
      ),
      says(
        "plan.tsx",
        "`setTitle(openEditor(plan))` is inside the `try` meant for `getPlan(…)`",
        bug(
          "getPlan(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
        ),
      ),
      says(
        "plan.tsx",
        "`setSaved(true)` is inside the `try` meant for `savePlan(…)`",
        bug("savePlan(…)", "these lines after the `try` (quick fix)"),
      ),
      says(
        "plan.tsx",
        "`onEvent(event)` is inside the `try` meant for `JSON.parse(…)`",
        bug(
          "JSON.parse(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
        ),
      ),
      says(
        "plan.tsx",
        "`onSaved()` is inside the `try` meant for `savePlan(…)`",
        bug(
          "savePlan(…)",
          "these lines after the `try` and return from the `catch` (declare what they use before the `try`)",
        ),
      ),
    ]);
  });

  it("is a warning on the line, with a fix only where the move keeps every other outcome", () => {
    const findings = flagged();
    const fixable = findings.filter(
      (finding) => finding.kind === "problem" && finding.fixes.length > 0,
    );
    expect(fixable).toHaveLength(1);
    for (const finding of findings) {
      expect(finding).toMatchObject({
        kind: "problem",
        ruleId: `errors/${RULE}`,
        severity: "warning",
      });
    }
    const [first] = fixable;
    const edits = first?.kind === "problem" ? first.fixes.flatMap((fix) => fix.edits) : [];
    const file = first?.location.file ?? "";
    const fixed = applied(readFileSync(file, "utf8"), edits);
    expect(fixed).toContain(
      [
        "  try {",
        "    await savePlan(plan);",
        "  } catch (e) {",
        "    showError(e);",
        "    return;",
        "  }",
        "  closeEditor();",
        "  setSaved(true);",
        "}",
      ].join("\n"),
    );
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts a catch that tests or rethrows, a narrow try, lines that cannot fail, awaited calls, and reads, conditions, defaults, `break` and store dispatches (a large app)", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
