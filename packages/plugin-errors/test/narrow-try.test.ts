import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding, TextEdit } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "narrow-try";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

/** `rest` says what to move (`it …` or `these lines …`) and how; the reason follows it. */
function bug(expected: string, rest: string): string {
  const [lines, them] = rest.startsWith("these lines") ? ["the lines", "them"] : ["the line", "it"];
  const how = rest.replace(/^(?:it|these lines) /, "");
  const why = `so a bug in ${them} is not handled like a failed \`${expected}\``;
  const quick = " (quick fix)";
  return how.endsWith(quick)
    ? `move ${lines} ${how.slice(0, -quick.length)}, ${why}${quick}`
    : `move ${lines} ${how}, ${why}`;
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
        "the `try` for `throw new AccessError(…)` also catches errors from `onOpen()`",
        bug(
          "throw new AccessError(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `getPlan(…)` also catches errors from `setTitle(openEditor(plan))`",
        bug(
          "getPlan(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `savePlan(…)` also catches errors from `setSaved(true)`",
        bug("savePlan(…)", "these lines after the `try` (quick fix)"),
      ),
      says(
        "plan.tsx",
        "the `try` for `JSON.parse(…)` also catches errors from `onEvent(event)`",
        bug(
          "JSON.parse(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
        ),
      ),
      says(
        "plan.tsx",
        "the `try` for `savePlan(…)` also catches errors from `onSaved()`",
        bug(
          "savePlan(…)",
          "these lines after the `try` and return from the `catch` (declare what they use before the `try`)",
        ),
      ),
      says(
        "session.ts",
        "the `try` for `createSession.mutateAsync(…)` also catches errors from `onCreated(session)`",
        bug(
          "createSession.mutateAsync(…)",
          "it after the `try` and return from the `catch` (declare what it uses before the `try`)",
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
