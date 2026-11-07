import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "finally-can-throw";
const FILE = fixture(`${RULE}/flagged/finally.ts`);

function flagged(): readonly Finding[] {
  return checkOnly(fixture(`${RULE}/flagged`), RULE);
}

function lost(subject?: string): string {
  const base = subject === undefined ? "a `throw`" : "a throw";
  const cause = subject === undefined ? "" : `: ${subject}`;
  return `${base} in \`finally\` replaces the original error${cause}`;
}

function throws(call: string): string {
  return lost(`\`${call}(…)\` can throw`);
}

const HINT =
  "catch it inside the `finally`, or move it out, so the original error is kept:\n    finally {\n      try { cleanup(); } catch (e) { report(e); }\n    }";

function at(message: string) {
  return says("finally.ts", message, HINT);
}

describe(`errors/${RULE}: a finally that can throw`, () => {
  it("names the built-in, the throw or the same-file function", () => {
    expect(shown(flagged())).toEqual([
      at(throws("JSON.parse")),
      at(throws("JSON.stringify")),
      at(throws("new URL")),
      at(throws("decodeURIComponent")),
      at(throws("decodeURI")),
      at(throws("structuredClone")),
      at(throws("atob")),
      at(lost()),
      at(throws("this.close")),
      at(throws("mustHave")),
      at(throws("mustBeKnown")),
      at(throws("guardedThenRethrows")),
      at(throws("mustSave")),
      at(throws("JSON.parse")),
      at(throws("JSON.parse")),
      at(throws("JSON.parse")),
      at(lost("`someVeryLongFunctionNameForTheTest(…)` can throw")),
      at(throws("JSON.parse")),
    ]);
  });

  it("reports an error on the call or the throw, once per finally, with no quick fix", () => {
    const text = readFileSync(FILE, "utf8");
    const found = flagged();
    for (const finding of found) {
      expect(finding).toMatchObject({
        kind: "problem",
        ruleId: `errors/${RULE}`,
        severity: "error",
        fixes: [],
      });
    }
    const shownText = found.map((finding) =>
      text.slice(finding.location.start, finding.location.end),
    );
    expect(shownText[0]).toBe("JSON.parse(raw)");
    expect(shownText[2]).toBe("new URL(raw)");
    expect(shownText[7]).toBe('throw new Error("empty");');
    expect(shownText[12]).toBe("mustSave()");
    expect(shownText[17]).toBe("JSON.parse(raw)");
  });

  it("reports only the first of two in one finally, and a nested finally once", () => {
    const text = readFileSync(FILE, "utf8");
    const lines = flagged().map(
      (finding) => text.slice(0, finding.location.start).split("\n").length,
    );
    const before =
      text.split("\n").findIndex((line) => line.includes("function onlyTheFirstIsReported")) + 1;
    expect(lines.filter((line) => line > before && line < before + 8)).toHaveLength(1);
    const nested =
      text.split("\n").findIndex((line) => line.includes("function insideANestedFinally")) + 1;
    expect(lines.filter((line) => line > nested && line < nested + 12)).toHaveLength(1);
  });

  it("never passes 100 characters in a headline or 140 on the fix line", () => {
    for (const finding of flagged()) {
      // Only quoted names may push a line past its limit.
      expect(finding.message.replace(/`[^`]*`/g, "").length).toBeLessThanOrEqual(100);
      expect(finding.hint.split("\n")[0]?.replace(/`[^`]*`/g, "").length).toBeLessThanOrEqual(140);
    }
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts safe calls, a nested try/catch, functions that are not called and shadowed names", () => {
    expect(shown(checkOnly(fixture(`${RULE}/not-flagged`), RULE))).toEqual([]);
  });
});
