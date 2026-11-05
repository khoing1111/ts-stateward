import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, checkWith, fixture, says, shown } from "./helpers.js";

const RULE = "catch-without-intent";

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

const LOGS = "this catch logs the error and carries on as if nothing failed";
const REST = "rethrow it, return a failure the caller can see, or show it to the user:";
const USER = "show it to the user: no caller of an event handler will";

function advice(variable: string, example = `throw ${variable};`): string {
  return `${REST}\n    ${example}`;
}

function calls(name: string): string {
  return `this catch calls \`${name}\` and carries on; stateward cannot tell whether that reports the error`;
}

function ifReports(name: string): string {
  return `if \`${name}\` reports it, add it to \`edgeHelpers\`; if not, ${advice("e")}`;
}

function fallback(variable: string): string {
  return `give \`${variable}\` a fallback before the \`try\`: \`let ${variable} = …;\``;
}

describe(`errors/${RULE}: a catch that only logs or does nothing, and the function goes on`, () => {
  it("says what the catch does and the better form for its shape", () => {
    expect(shown(flagged())).toEqual([
      // A dispatch that tells no one, and a setter given no failure, still ask.
      says("not-told.ts", calls("dispatch"), ifReports("dispatch")),
      says("not-told.ts", calls("setLoading"), ifReports("setLoading")),
      says("not-told.ts", calls("dispatch"), ifReports("dispatch")),
      says("shapes.tsx", LOGS, "return the default from the `catch`"),
      says("shapes.tsx", LOGS, USER),
      says("shapes.tsx", LOGS, USER),
      says("swallowed.ts", LOGS, fallback("text")),
      says("swallowed.ts", LOGS, advice("error")),
      says("swallowed.ts", LOGS, advice("e")),
      says("swallowed.ts", LOGS, advice("e")),
      says("swallowed.ts", LOGS, advice("e")),
      says("swallowed.ts", LOGS, advice("e")),
      says("swallowed.ts", LOGS, advice("e")),
      says("swallowed.ts", LOGS, advice("e")),
      says("swallowed.ts", LOGS, advice("e")),
      says("undeclared.ts", calls("showError"), ifReports("showError")),
      says("undeclared.ts", calls("render"), ifReports("render")),
      says("with-err.ts", LOGS, advice("e", "return fail(e);")),
    ]);
  });

  it("shows the file's own way to report, once its helpers are declared", () => {
    const findings = checkWith(fixture(`${RULE}/edge`), RULE, [
      "warning",
      {
        edgeHelpers: ["reportAndShow", "Sentry.captureException"],
        swallowHelpers: ["ignoreError"],
      },
    ]);
    expect(shown(findings)).toEqual([
      says("report.ts", LOGS, "report it like the rest of this file:\n    reportAndShow(e);"),
    ]);
  });

  it("reports a warning on the `catch` keyword, with no quick fix", () => {
    for (const finding of flagged()) {
      const text = readFileSync(finding.location.file, "utf8");
      expect(finding).toMatchObject({
        kind: "problem",
        ruleId: `errors/${RULE}`,
        severity: "warning",
        fixes: [],
      });
      expect(text.slice(finding.location.start, finding.location.end)).toBe("catch");
    }
  });

  it("is a heuristic, so a config cannot make it more than a warning by default", () => {
    expect(
      flagged().every((finding) => finding.kind === "problem" && finding.severity !== "error"),
    ).toBe(true);
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts a try that ends the function or a loop's body, a fallback, a rethrow, narrowing, a callback, empty catches, and a real project's reporters, notifications and failure states", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
