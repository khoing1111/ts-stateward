import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { checkFixture, typeErrors } from "@stateward/core/testing";
import type { TextEdit } from "@stateward/core";
import { errors } from "../src/index.js";
import { checkOnly, fixture, says, shown, type Shown } from "./helpers.js";

const RULE = "result-unchecked";
const FLAGGED = fixture(`${RULE}/flagged`);

/**
 * The readings of a trigger whose failure is not checked: `.unwrap()` (a quick fix), the check
 * that stops or throws, and the `else` for the success path, which says the lines run either way.
 */
function triggerWays(call: string, where: "catch" | "outside"): string {
  const stored = `    const result = await ${call};`;
  const ways =
    where === "catch"
      ? [
          "- add `.unwrap()` so a failure throws into the `catch` (quick fix)",
          "- or check the result and throw its error into the `catch`",
          stored,
          '    if ("error" in result) throw result.error;',
        ]
      : [
          "- add `.unwrap()` so a failure throws (quick fix), and put the call in a `try` with a `catch`: nothing else catches it",
          "- or check the result, and stop there",
          stored,
          '    if ("error" in result) return;',
        ];
  return [
    "one of",
    ...ways,
    "- or, if the lines after it should run either way, say so with an `else` for the success path",
    '    if ("error" in result) { … } else { … }',
  ].join("\n");
}

function deadCatch(file: string, callee: string, call: string): Shown {
  return says(
    file,
    `\`catch\` never runs for \`${callee}(…)\`: it does not throw when it fails`,
    triggerWays(call, "catch"),
  );
}

function goesOn(callee: string, condition: string, file = "save.ts", stop = "return;"): Shown {
  const how = stop.startsWith("throw")
    ? "by throwing its error, so the `catch` and its rollback run"
    : "with `return`";
  return says(
    file,
    `code after the \`if\` runs even when \`${callee}(…)\` failed`,
    [
      "one of",
      `- end the branch that handles the failure ${how}`,
      `    if (${condition}) {`,
      "      // … what it shows now",
      `      ${stop}`,
      "    }",
      "- or, if the lines after the `if` should run either way, say so with an `else` for the success path",
      `    if (${condition}) { … } else { … }`,
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
    "code after the call runs even when `updateFolder(…)` failed, and the `catch` does not",
    triggerWays(call, "catch"),
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
      goesOn("saveSettings", '"error" in result', "nested.ts", "throw result.error;"),
      goesOn("saveSettings", "result.error", "nested.ts", "throw result.error;"),
    ]);
  });

  it("still says it when a statement comes between the await and the return", () => {
    expect(shown(found).filter((one) => one.file === "returns-late.ts")).toEqual([
      says(
        "returns-late.ts",
        "code after the call runs even when `createPlan(…)` failed",
        [
          "check that it worked before reading `result.data`, and stop when it failed (return what the function returns, or throw):",
          '    if ("error" in result) { … }',
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
        "code after the call runs even when `sendReply(…)` failed",
        triggerWays("sendReply({ threadId, text })", "outside"),
      ),
    ]);
  });

  it("says the code goes on after a failure it read, or reads the data unchecked (save)", () => {
    expect(shown(found).filter((one) => one.file === "save.ts")).toEqual([
      goesOn("saveSettings", '"error" in result'),
      goesOn("saveSettings", "error"),
      says(
        "save.ts",
        "code after the call runs even when `createPlan(…)` failed",
        [
          "check that it worked before reading `created.data`, and stop when it failed (return what the function returns, or throw):",
          '    if ("error" in created) { … }',
        ].join("\n"),
      ),
      goesOn("saveUser", "!saved.ok"),
      says(
        "save.ts",
        "not checked: whether the `if` tests that `saveSettings(…)` failed: it does not test the result itself",
        'test the result itself, as in `if ("error" in result) return;`, so the check can be followed',
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
    const stops = "Add `.unwrap()` so a failure stops the function";
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

describe(`errors/${RULE}: the code the hint shows works where it is shown`, () => {
  it("throws into the `catch` inside a `try`, and stops with `return;` only where the function returns void", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stateward-unchecked-"));
    try {
      cpSync(FLAGGED, dir, { recursive: true });
      const target = (file: string, wanted: string) =>
        checkOnly(FLAGGED, RULE).find(
          (finding) =>
            path.basename(finding.location.file) === file && finding.hint.includes(wanted),
        );
      for (const [file, wanted, expected] of [
        [
          "delete.ts",
          "throw its error into the `catch`",
          'if ("error" in result) throw result.error;',
        ],
        ["reply.ts", "put the call in a `try`", 'if ("error" in result) return;'],
      ] as const) {
        const finding = target(file, wanted);
        expect(finding?.hint).toContain(expected);
        const lines = (finding?.hint ?? "")
          .split("\n")
          .filter((line) => line.startsWith("    ") && !line.includes("…"))
          .map((line) => line.trim());
        const source = readFileSync(path.join(FLAGGED, file), "utf8");
        const start = finding?.location.start ?? 0;
        const end = finding?.location.end ?? 0;
        writeFileSync(
          path.join(dir, file),
          source.slice(0, start) + lines.join("\n") + source.slice(end),
        );
        expect(typeErrors(dir)).toBe("");
      }
      // Nothing in a `try` is told to `return`: that would skip the rollback in the `catch`.
      for (const finding of checkOnly(FLAGGED, RULE)) {
        if (finding.message.includes("`catch`")) expect(finding.hint).not.toContain("return;");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
