import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { checkOnly, exampleBlocks, fixture, inCopy, says, shown } from "./helpers.js";

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

const OUT =
  "- or, if it should run only when the `try` succeeds, move it out of the `finally`, after the `try` statement";
const CANNOT =
  "- or, if it cannot throw here, state it with `// stateward-ignore errors/finally-can-throw: <why>`";

/** The fix: the developer's own statement wrapped, or words where wrapping would change the code. */
function hintOf(statement: string | undefined): string {
  return [
    "one of",
    statement === undefined
      ? "- catch it inside the `finally`, around the call that can throw, so the original error is kept"
      : [
          "- catch it inside the `finally`, so the original error is kept",
          "    finally {",
          `      try { ${statement} } catch (e) { … }`,
          "    }",
        ].join("\n"),
    OUT,
    CANNOT,
  ].join("\n");
}

const THROW_HINT = [
  "one of",
  "- move the `throw` out of the `finally`, after the `try` statement: it then happens only when the `try` succeeds, and the original error is kept",
  "- or, if the `throw` should replace the original error, state it with `// stateward-ignore errors/finally-can-throw: <why>`",
].join("\n");

function at(message: string, statement?: string) {
  return says("finally.ts", message, message === lost() ? THROW_HINT : hintOf(statement));
}

describe(`errors/${RULE}: a finally that can throw`, () => {
  it("names the built-in, the throw or the same-file function", () => {
    expect(shown(flagged())).toEqual([
      // `const state = JSON.parse(raw);` declares a name the code after it uses: no example.
      at(throws("JSON.parse")),
      at(throws("JSON.stringify"), "report(JSON.stringify(value));"),
      at(throws("new URL"), "report(new URL(raw));"),
      at(throws("decodeURIComponent"), "report(decodeURIComponent(raw));"),
      at(throws("decodeURI"), "report(decodeURI(raw));"),
      at(throws("structuredClone"), "report(structuredClone(value));"),
      at(throws("atob"), "report(atob(raw));"),
      at(lost()),
      at(throws("this.close"), "this.close();"),
      at(throws("mustHave"), "report(mustHave(raw));"),
      at(throws("mustBeKnown"), "report(mustBeKnown(raw));"),
      at(throws("guardedThenRethrows"), "guardedThenRethrows();"),
      at(throws("mustSave"), "await mustSave();"),
      at(throws("JSON.parse"), "JSON.parse(raw);"),
      at(throws("JSON.parse"), "JSON.parse(raw);"),
      at(throws("JSON.parse"), "JSON.parse(raw);"),
      at(
        lost("`someVeryLongFunctionNameForTheTest(…)` can throw"),
        "someVeryLongFunctionNameForTheTest();",
      ),
      at(throws("JSON.parse"), "JSON.parse(raw);"),
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

describe(`errors/${RULE}: the readings are not offered as equal`, () => {
  it("offers moving the call out of the `finally` only for code that should run when the `try` succeeds", () => {
    for (const finding of flagged()) {
      expect(finding.hint).not.toContain("- or move it out of the `finally`");
      expect(finding.hint).toMatch(/move (?:it|the `throw`) out of the `finally`/);
    }
    for (const finding of flagged().filter((one) => one.hint.includes("- or, if it should"))) {
      expect(finding.hint).toContain(
        "- or, if it should run only when the `try` succeeds, move it out of the `finally`",
      );
    }
  });

  it("compiles the `try` / `catch` the hint wraps the developer's statement in, and silences the finding", () => {
    const wrappers = flagged().filter((one) => exampleBlocks(one.hint).length > 0);
    expect(wrappers.length).toBeGreaterThan(5);
    for (const finding of wrappers) {
      const [block = []] = exampleBlocks(finding.hint);
      const inner = block[1]?.trim() ?? "";
      const text = readFileSync(finding.location.file, "utf8");
      // The finding is on the call; the hint quotes the whole statement around it.
      const statementStart = text.lastIndexOf("\n", finding.location.start) + 1;
      const statementEnd = text.indexOf("\n", finding.location.end);
      const written = inner.replace("catch (e) { … }", "catch (e) { void e; }");
      inCopy(
        fixture(`${RULE}/flagged`),
        [
          {
            file: finding.location.file,
            start: statementStart,
            end: statementEnd,
            text: `    ${written}`,
          },
        ],
        (copy) => {
          expect(typeErrors(copy)).toBe("");
          // Only the first throwing call of a `finally` is reported: wrapping it shows the second.
          const second = text.slice(statementEnd).startsWith("\n    new URL(raw);") ? 1 : 0;
          expect(checkOnly(copy, RULE)).toHaveLength(flagged().length - 1 + second);
        },
      );
    }
  });
});
