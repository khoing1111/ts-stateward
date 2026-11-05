import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { checkFixture } from "@stateward/core/testing";
import type { TextEdit } from "@stateward/core";
import { errors } from "../src/index.js";
import { checkOnly, fixture, says, shown, type Shown } from "./helpers.js";

const RULE = "result-unchecked";
const FLAGGED = fixture(`${RULE}/flagged`);

function deadCatch(file: string, callee: string, call: string): Shown {
  return says(
    file,
    `\`${callee}(…)\` does not throw when it fails, so this \`catch\` never runs`,
    [
      'the lines after it still run on failure; add `.unwrap()` (quick fix), or check `"error" in result` and return:',
      `    const result = await ${call};`,
      '    if ("error" in result) return;',
    ].join("\n"),
  );
}

function goesOn(callee: string, condition: string, file = "save.ts"): Shown {
  return says(
    file,
    `the lines after this \`if\` run even when \`${callee}(…)\` failed`,
    [
      "end the branch that handles the failure with `return` (or `throw`):",
      `    if (${condition}) {`,
      "      // … what it shows now",
      "      return;",
      "    }",
    ].join("\n"),
  );
}

function applied(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.location.start - a.location.start)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
      text,
    );
}

function runsWithoutCatch(call: string): Shown {
  return says(
    "folders.ts",
    "the lines after this run even when `updateFolder(…)` failed, and the `catch` does not",
    [
      'add `.unwrap()` so a failure reaches the `catch` (quick fix), or check `"error" in result` and return:',
      `    const result = await ${call};`,
      '    if ("error" in result) return;',
    ].join("\n"),
  );
}

describe(`errors/${RULE}: flagged`, () => {
  const found = checkOnly(FLAGGED, RULE);

  it("says the lines after a trigger run and the `catch` does not, after another call in the `try`, and that an `if` reading the failure goes on (folders)", () => {
    expect(shown(found).filter((one) => one.file === "folders.ts")).toEqual([
      runsWithoutCatch("updateFolder({ ...folder, name })"),
      runsWithoutCatch("updateFolder(folder)"),
      // `toast("Moving…")` before and `toast("Folder moved")` after are not a pending state.
      goesOn("updateFolder", '"error" in result', "folders.ts"),
      goesOn("updateFolder", "result.error", "folders.ts"),
      goesOn("dispatch", "isError", "folders.ts"),
    ]);
  });

  it("says the lines after a block go on when the check is the last line of the block (nested)", () => {
    expect(shown(found).filter((one) => one.file === "nested.ts")).toEqual([
      goesOn("saveSettings", '"error" in result', "nested.ts"),
      goesOn("saveSettings", '"error" in result', "nested.ts"),
      goesOn("saveSettings", "result.error", "nested.ts"),
    ]);
  });

  it("still says it when a statement comes between the await and the return", () => {
    expect(shown(found).filter((one) => one.file === "returns-late.ts")).toEqual([
      says(
        "returns-late.ts",
        "the lines after this run even when `createPlan(…)` failed",
        [
          "check that it worked before reading `result.data`, and return when it failed:",
          '    if ("error" in result) return;',
        ].join("\n"),
      ),
    ]);
  });

  it("says a `catch` around a trigger without `.unwrap()` never runs, and a dropped trigger goes on (delete, reply)", () => {
    expect(
      shown(found).filter((one) => one.file === "delete.ts" || one.file === "reply.ts"),
    ).toEqual([
      deadCatch("delete.ts", "deletePlan", "deletePlan(id)"),
      deadCatch("reply.ts", "sendReply", "sendReply({ threadId, text })"),
      // `setSending(false)` only sets back the pending state; `setText("")` goes on.
      says(
        "reply.ts",
        "the lines after this run even when `sendReply(…)` failed",
        [
          'add `.unwrap()` so a failure throws (quick fix), or check `"error" in result` and return:',
          "    const result = await sendReply({ threadId, text });",
          '    if ("error" in result) return;',
        ].join("\n"),
      ),
    ]);
  });

  it("says the code goes on after a failure it read, or reads the data unchecked (save)", () => {
    expect(shown(found).filter((one) => one.file === "save.ts")).toEqual([
      goesOn("saveSettings", '"error" in result'),
      goesOn("saveSettings", "error"),
      says(
        "save.ts",
        "the lines after this run even when `createPlan(…)` failed",
        [
          "check that it worked before reading `created.data`, and return when it failed:",
          '    if ("error" in created) return;',
        ].join("\n"),
      ),
      goesOn("saveUser", "!saved.ok"),
      says(
        "save.ts",
        "stateward cannot tell whether this `if` checks that `saveSettings(…)` failed",
        'test the result itself to make it checkable, as in `if ("error" in result) return;`',
      ),
    ]);
    expect(found.map((one) => one.kind)).toEqual([
      ...Array.from({ length: 16 }, () => "problem"),
      "unknown",
    ]);
  });

  it("offers `.unwrap()` as a quick fix that compiles, only where the result is dropped", () => {
    const parsed = parseConfig(
      { plugins: [errors()], rules: { [`errors/${RULE}`]: "warning" } },
      FLAGGED,
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const checker = createChecker({ config: parsed.value, cwd: FLAGGED });
    const ours = checker.check().findings.filter((one) => one.ruleId === `errors/${RULE}`);
    const reviews = checker.reviewFixes(ours);
    const offered = reviews.map((review) =>
      review.finding.kind === "problem" ? review.finding.fixes.map((fix) => fix.title) : [],
    );
    const unwrap = "Add `.unwrap()` so a failure reaches the `catch`";
    const stops = "Add `.unwrap()` so a failure stops this function";
    expect(offered).toEqual([
      [unwrap],
      [unwrap],
      [unwrap],
      [],
      [],
      [],
      [],
      [],
      [],
      [unwrap],
      [stops],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const [first] = reviews;
    const edits = first?.finding.kind === "problem" ? first.finding.fixes[0]?.edits : undefined;
    const text = readFileSync(path.join(FLAGGED, "delete.ts"), "utf8");
    expect(applied(text, edits ?? [])).toContain("      await deletePlan(id).unwrap();\n");
  });
});

describe(`errors/${RULE} and errors/result-ignored`, () => {
  it("give one message for a dropped trigger, even when `resultTypes` names its result", () => {
    const { findings } = checkFixture(FLAGGED, [errors()], {
      "errors/result-ignored": ["error", { resultTypes: ["MutationResult"] }],
    });
    const rules = (file: string): string[] =>
      findings
        .filter(
          (one) =>
            path.basename(one.location.file) === file &&
            one.kind === "problem" &&
            // The two rules that could both report a dropped trigger; the others judge other things.
            (one.ruleId === `errors/${RULE}` || one.ruleId === "errors/result-ignored"),
        )
        .map((one) => one.ruleId);
    expect(rules("delete.ts")).toEqual([`errors/${RULE}`]);
    expect(rules("reply.ts")).toEqual([`errors/${RULE}`, `errors/${RULE}`]);
    const ignoredOnly = checkFixture(FLAGGED, [errors()], {
      [`errors/${RULE}`]: "off",
      "errors/result-ignored": ["error", { resultTypes: ["MutationResult"] }],
    }).findings.filter((one) => one.ruleId === "errors/result-ignored");
    expect(ignoredOnly.length).toBeGreaterThanOrEqual(3);
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts `.unwrap()`, `void`, a check that returns, an `else`, the hook's `isError`, a destructured `isError` tested first, a pending state set back, and promises that reject", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
