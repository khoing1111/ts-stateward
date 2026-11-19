import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Finding, TextEdit } from "@stateward/core";
import { typeErrors } from "@stateward/core/testing";
import { react } from "../src/index.js";
import { exampleBlocks, fixture } from "./helpers.js";

const RULE = "react/effect-response-race";
const SOURCE = fixture("latest-wins-catch");
const SLOW = 300_000;
/** Under the package, so the copy resolves React from the package's own node_modules. */
const SCRATCH = fileURLToPath(new URL("../.scratch/abort-catch", import.meta.url));

const LINE = (name: string): string =>
  `if (${name} instanceof DOMException && ${name}.name === "AbortError") return;`;

let dir = "";
beforeEach(() => {
  mkdirSync(SCRATCH, { recursive: true });
  dir = mkdtempSync(path.join(SCRATCH, "app-"));
  cpSync(SOURCE, dir, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function reviewed(): Finding[] {
  const parsed = parseConfig({ preset: "recommended", plugins: [react()] }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const checker = createChecker({ config: parsed.value, cwd: dir, cache: false });
  return checker
    .reviewFixes(checker.check().findings)
    .map((review) => review.finding)
    .filter((finding) => finding.ruleId === RULE);
}

const at = (finding: Finding): string => {
  const text = readFileSync(finding.location.file, "utf8");
  return text.slice(finding.location.start, finding.location.end);
};

function apply(edits: readonly TextEdit[]): void {
  const file = path.join(dir, "Catching.tsx");
  writeFileSync(
    file,
    [...edits]
      .sort((a, b) => b.location.start - a.location.start)
      .reduce(
        (result, edit) =>
          result.slice(0, edit.location.start) + edit.newText + result.slice(edit.location.end),
        readFileSync(file, "utf8"),
      ),
  );
}

describe(`${RULE}: the abort rejects the request, so the catch ignores it`, () => {
  it("shows the line with the catch's own variable where `return;` fits, and words where it does not", () => {
    const hints = reviewed().map((finding) => [at(finding).split("\n")[0], finding.hint]);
    const byCall = (needle: string): string =>
      hints.find(([text]) => text?.includes(needle))?.[1] ?? "";
    // `.catch((reason) => …)`: the variable is `reason`.
    expect(exampleBlocks(byCall("fetchUser(userId)")).flat()).toContain(LINE("reason"));
    // `try … catch (error)`: the variable is `error`.
    expect(hints.some(([, hint]) => hint?.includes(LINE("error")))).toBe(true);
    // A handler that is a function of the component gets words only.
    const handed = reviewed().find((finding) => finding.hint.includes("make the `catch` ignore"));
    expect(handed?.hint).toContain("a `DOMException` named `AbortError`");
    expect(handed?.hint).not.toContain("instanceof DOMException");
    // No handler, nothing said about one.
    expect(
      reviewed().filter((finding) => finding.hint.includes("rejects the request")),
    ).toHaveLength(3);
    // The old hint, that stopped at the cleanup, is gone for a request with a `catch`.
    for (const finding of reviewed().filter((one) => one.hint.includes("rejects the request"))) {
      expect(finding.hint.split("\n").at(-1)).not.toContain("controller.abort()");
    }
  });

  it(
    "the quick fix adds the line to the `catch`, and the code compiles and is no longer reported",
    { timeout: SLOW },
    () => {
      const fixes = reviewed().flatMap((finding) =>
        finding.kind === "problem" ? finding.fixes.slice(0, 1) : [],
      );
      apply(fixes.flatMap((fix) => fix.edits));
      const text = readFileSync(path.join(dir, "Catching.tsx"), "utf8");
      expect(text).toContain(
        `      .catch((reason) => {\n        ${LINE("reason")}\n        setFailure`,
      );
      expect(text).toContain(
        `      } catch (error) {\n        ${LINE("error")}\n        setFailure`,
      );
      expect(typeErrors(dir)).toBe("");
      expect(reviewed()).toEqual([]);
    },
  );
});

describe("react/effect-response-race: the flag the add-on's hint shows", () => {
  it("compiles, as written in the effect, and the finding is gone", () => {
    const guessed = fixture("latest-wins");
    const file = path.join(guessed, "Guessed.tsx");
    const ADDON = ["react/effect-race"];
    const found = (root: string): readonly Finding[] => {
      const parsed = parseConfig(
        { preset: "recommended", plugins: [react()], addons: ADDON },
        root,
      );
      if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
      const checker = createChecker({ config: parsed.value, cwd: root, cache: false });
      return checker
        .check()
        .findings.filter((one) => one.ruleId === RULE && one.location.file.endsWith("Guessed.tsx"));
    };
    const before = found(guessed).find((one) => one.hint.includes("if (!ignore) setUser(loaded);"));
    expect(before).toBeDefined();
    expect(before?.hint).not.toContain("…");
    // The lines as shown, in the effect that writes `loaded`.
    const text = readFileSync(file, "utf8");
    const written =
      "    void (async () => {\n      const loaded = await loadUser(id);\n      setUser(loaded);\n    })();\n  }, [id]);";
    expect(text).toContain(written);
    const fixed =
      "    let ignore = false;\n    void (async () => {\n      const loaded = await loadUser(id);\n      if (!ignore) setUser(loaded);\n    })();\n    return () => { ignore = true; };\n  }, [id]);";
    const copy = `${guessed}-copy-flag`;
    try {
      cpSync(guessed, copy, { recursive: true });
      writeFileSync(path.join(copy, "Guessed.tsx"), text.replace(written, fixed));
      expect(typeErrors(copy)).toBe("");
      expect(found(copy).some((one) => one.message.includes("`id`"))).toBe(false);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
