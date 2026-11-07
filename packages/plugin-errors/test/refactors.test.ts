import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import type { Checker, TextEdit } from "@stateward/core";
import { errors } from "../src/index.js";
import { fixture } from "./helpers.js";

const DIR = fixture("inlay-hints");
const TITLE = "Handle the known errors, rethrow the rest";

const parsed = parseConfig({ preset: "recommended", plugins: [errors()] }, DIR);
if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
const checker: Checker = createChecker({ config: parsed.value, cwd: DIR });
checker.check();

/** The refactorings offered on the `catch` of the `occurrence`-th `catch` keyword in `file`. */
function onCatch(file: string, occurrence = 0) {
  const full = path.join(DIR, file);
  const text = readFileSync(full, "utf8");
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = text.indexOf("catch", at + 1);
  return { text, actions: checker.refactors(full, at + 2, at + 2) };
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

describe("errors: handle the known errors here", () => {
  it("wraps a catch-all for the classes its try can throw, rethrowing the rest", () => {
    const { text, actions } = onCatch("refactor.ts", 0);
    expect(actions.map((action) => action.title)).toEqual([TITLE]);
    const fixed = applied(
      text,
      actions.flatMap((action) => action.edits),
    );
    const body = fixed.slice(
      fixed.indexOf("} catch (e) {"),
      fixed.indexOf("export function chain"),
    );
    expect(body.replace(/\s+/g, " ")).toBe(
      '} catch (e) { if (e instanceof AuthError || e instanceof ParseError) { show("failed"); } else { throw e; } } } ',
    );
  });

  it("is offered nowhere else: not on a chain, a rethrow, an unknown try, or no variable", () => {
    for (const occurrence of [1, 2, 3, 4]) {
      expect(onCatch("refactor.ts", occurrence).actions).toEqual([]);
    }
  });

  it("is not offered away from the catch", () => {
    const full = path.join(DIR, "refactor.ts");
    expect(checker.refactors(full, 0, 10)).toEqual([]);
  });

  it("is not offered when the result would not compile (a class the file does not import)", () => {
    expect(onCatch("not-imported-catch.ts").actions).toEqual([]);
  });
});
