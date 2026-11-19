import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import type { Finding } from "@stateward/core";
import { check, exampleBlocks, fixture, inCopy, shown } from "./helpers.js";
import type { Replacement } from "./helpers.js";

const DIR = fixture("timer-hints");
const RULE = "react/timer-runs-after-unmount";
const IGNORE =
  "- or if it should still run after the component is gone, say so on the line above the timer with `// stateward-ignore react/timer-runs-after-unmount: <why>`";

const ofRule = (dir: string): readonly Finding[] =>
  check(dir, { "react/effect-missing-cleanup": "off" }).filter((one) => one.ruleId === RULE);
const found = ofRule(DIR);
const named = (file: string, text: string): Finding => {
  const one = found.find(
    (finding) => finding.location.file.endsWith(file) && finding.message.includes(text),
  );
  if (one === undefined) throw new Error(`no finding in ${file} for ${text}`);
  return one;
};

describe(`${RULE}: the hints write the clear the ref's own type takes`, () => {
  it("guards `cancelAnimationFrame` for a ref that can be `undefined`, and a clear for one that can be `null`", () => {
    expect(shown(DIR, found).map((one) => [one.file, one.message, one.hint])).toEqual([
      [
        "Frame.tsx",
        "`frame` can still run `onMove(…)` after `Follower` unmounts",
        [
          "one of",
          "- add an effect that clears it on unmount, after the ref's declaration (quick fix):",
          "    useEffect(() => () => {",
          "      if (frame.current !== undefined) cancelAnimationFrame(frame.current);",
          "    }, []);",
          IGNORE,
        ].join("\n"),
      ],
      [
        "Handed.tsx",
        "not checked: whether `frame` is cleared on unmount: its cleanup hands it to `stopAll`",
        [
          "one of",
          "- clear it in a cleanup written in an effect itself, so it can be checked:",
          "    useEffect(() => () => {",
          "      if (frame.current !== undefined) cancelAnimationFrame(frame.current);",
          "    }, []);",
          IGNORE,
        ].join("\n"),
      ],
      [
        "Nullable.tsx",
        "`closeTimer` can still run `onClose(…)` after `Chip` unmounts",
        [
          "one of",
          "- add an effect that clears it on unmount, after the ref's declaration (quick fix):",
          "    useEffect(() => () => {",
          "      if (closeTimer.current !== null) clearTimeout(closeTimer.current);",
          "    }, []);",
          IGNORE,
        ].join("\n"),
      ],
      [
        "Nullable.tsx",
        "`timer` can still run `onClose(…)` after `Both` unmounts",
        [
          "one of",
          "- add an effect that clears it on unmount, after the ref's declaration (quick fix):",
          "    useEffect(() => () => {",
          "      clearTimeout(timer.current);",
          "      if (timer.current !== undefined) cancelAnimationFrame(timer.current);",
          "    }, []);",
          IGNORE,
        ].join("\n"),
      ],
      [
        "Plain.tsx",
        "`closeTimer` can still run `onClose(…)` after `Plain` unmounts",
        [
          "one of",
          "- add an effect that clears it on unmount, after the ref's declaration (quick fix):",
          "    React.useEffect(() => () => clearTimeout(closeTimer.current), []);",
          IGNORE,
        ].join("\n"),
      ],
      [
        "Poll.tsx",
        "not checked: whether `ticker` is cleared on unmount: its cleanup is not written in the effect",
        [
          "one of",
          "- clear it in a cleanup written in an effect itself, so it can be checked:",
          "    useEffect(() => () => clearInterval(ticker.current), []);",
          IGNORE,
        ].join("\n"),
      ],
    ]);
  });

  it("no longer shows a placeholder ref, the wrong clear, an unguarded frame, or a cleanup that is 'not in the component'", () => {
    for (const finding of found) {
      expect(finding.hint).not.toContain("ref.current");
      expect(finding.message).not.toContain("not in the component");
    }
    expect(named("Poll.tsx", "ticker").hint).not.toContain("clearTimeout");
    expect(named("Handed.tsx", "frame").hint).not.toContain("clearTimeout");
    for (const file of ["Frame.tsx", "Handed.tsx"]) {
      expect(named(file, "frame").hint).not.toContain(
        "() => () => cancelAnimationFrame(frame.current)",
      );
    }
  });
});

/** The quick fix of a finding, as the replacements it makes. */
function fixOf(finding: Finding): Replacement[] {
  if (finding.kind !== "problem") return [];
  return finding.fixes.flatMap((fix) =>
    fix.edits.map((edit) => ({
      file: edit.location.file,
      start: edit.location.start,
      end: edit.location.end,
      text: edit.newText,
    })),
  );
}

describe(`${RULE}: the code the hints show works in the developer's component`, () => {
  it("compiles every quick fix and silences its finding", () => {
    const fixed = found.filter((one) => one.kind === "problem");
    expect(fixed).toHaveLength(4);
    for (const finding of fixed) {
      inCopy(DIR, fixOf(finding), (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(ofRule(copy)).toHaveLength(found.length - 1);
      });
    }
  });

  it("shows in the hint the same effect the quick fix writes", () => {
    for (const finding of found.filter((one) => one.kind === "problem")) {
      const [shownEffect = []] = exampleBlocks(finding.hint);
      const written = fixOf(finding).at(-1)?.text ?? "";
      expect(written.replace(/\n\s+/g, "\n").trim().split("\n")).toEqual(
        shownEffect.map((line) => line.trim()),
      );
    }
  });

  it("compiles the effect shown where the cleanup is not readable, in place of the one that hides it", () => {
    const old: Record<string, string> = {
      "Handed.tsx": "useEffect(() => () => stopAll(frame), []);",
      "Poll.tsx": "useEffect(() => stop, []);",
    };
    for (const finding of found.filter((one) => one.kind === "unknown")) {
      const file = finding.location.file;
      const source = readFileSync(file, "utf8");
      const target = old[file.split("/").pop() ?? ""] ?? "";
      const start = source.indexOf(target);
      expect(start).toBeGreaterThanOrEqual(0);
      const [lines = []] = exampleBlocks(finding.hint);
      inCopy(DIR, [{ file, start, end: start + target.length, text: lines.join("\n") }], (copy) => {
        expect(typeErrors(copy)).toBe("");
        expect(ofRule(copy)).toHaveLength(found.length - 1);
      });
    }
  });

  it("is silent once the line above the timer says it may run after unmount, with a reason", () => {
    for (const finding of found) {
      const file = finding.location.file;
      const source = readFileSync(file, "utf8");
      const lineStart = source.lastIndexOf("\n", finding.location.start) + 1;
      inCopy(
        DIR,
        [
          {
            file,
            start: lineStart,
            end: lineStart,
            text: "    // stateward-ignore react/timer-runs-after-unmount: stops with the page\n",
          },
        ],
        (copy) => {
          expect(typeErrors(copy)).toBe("");
          expect(ofRule(copy)).toHaveLength(found.length - 1);
        },
      );
    }
  });
});
