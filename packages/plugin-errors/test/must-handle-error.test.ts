import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkOnly, fixture, says, shown } from "./helpers.js";

const RULE = "must-handle-error";
const FLAGGED = fixture(`${RULE}/flagged`);

function found(): readonly Finding[] {
  return checkOnly(FLAGGED, RULE);
}

function textAt(finding: Finding): string {
  const text = readFileSync(finding.location.file, "utf8");
  return text.slice(finding.location.start, finding.location.end);
}

const HOW = "      // Tell the user the card was declined and let them pick another card.";

function example(name: string): string {
  return [`    if (e instanceof ${name}) {`, HOW, "    }"].join("\n");
}

describe(`errors/${RULE}: an error marked @mustHandle is handled or passed on by every call`, () => {
  it("reports a call left alone, a catch-all, a rethrow-all without @throws and a subclass, with the author's sentence", () => {
    expect(shown(found())).toEqual([
      says(
        "checkout.ts",
        "`pay(…)` can throw `PaymentDeclinedError`, which must be handled",
        "name it in a `catch`, pass it on with `@throws {PaymentDeclinedError}` on `renew`, or return it as a failure instead of throwing:\n" +
          example("PaymentDeclinedError"),
      ),
      says(
        "checkout.ts",
        "`pay(…)` can throw `PaymentDeclinedError`, which must be handled",
        "name it in this `catch`, which treats every error alike, or rethrow it and add `@throws {PaymentDeclinedError}` to `payWithToast`:\n" +
          example("PaymentDeclinedError"),
      ),
      says(
        "checkout.ts",
        "`pay(…)` can throw `PaymentDeclinedError`, which must be handled",
        "name it in this `catch`, which treats every error alike, or rethrow it and add `@throws {PaymentDeclinedError}` to `payOrShowError`:\n" +
          example("PaymentDeclinedError"),
      ),
      says(
        "checkout.ts",
        "`pay(…)` can throw `PaymentDeclinedError`, which must be handled",
        "this `catch` passes it on: add `@throws {PaymentDeclinedError}` to `payAndReport`, or handle it in the `catch`:\n" +
          example("PaymentDeclinedError"),
      ),
      says(
        "checkout.ts",
        "`assertNotExpired(…)` can throw `CardExpiredError`, which must be handled",
        "name it in a `catch`, pass it on with `@throws {CardExpiredError}` on `payButtonLabel`, or return it as a failure instead of throwing:\n" +
          example("CardExpiredError"),
      ),
      says(
        "checkout.ts",
        "`pay(…)` can throw `PaymentDeclinedError` out of a callback stateward cannot follow",
        "name `PaymentDeclinedError` in a `catch` here, or make sure the code that calls this callback does: it must be handled",
      ),
      says(
        "session.ts",
        "stateward does not check `@mustHandle` on a type yet, only on an error class",
        "to have every call checked, throw an error class marked `@mustHandle`; plain-object errors come later",
      ),
    ]);
  });

  it("reports at the call, notes the catch and the tag, and lists its places not checked", () => {
    const all = found();
    expect(all.map(textAt)).toEqual([
      "pay",
      "pay",
      "pay",
      "pay",
      "assertNotExpired",
      "pay",
      "@mustHandle Send the user to the sign-in page and come back here afterwards. ",
    ]);
    expect(all.map((f) => (f.kind === "unknown" ? f.listed : f.kind))).toEqual([
      "problem",
      "problem",
      "problem",
      "problem",
      "problem",
      true,
      true,
    ]);
    const notes = all.map((f) =>
      f.kind === "problem"
        ? f.related.map((r) => `${path.basename(r.location.file)}: ${r.message}`)
        : [],
    );
    const tag =
      "errors.ts: `PaymentDeclinedError` must be handled: Tell the user the card was declined and let them pick another card.";
    expect(notes.slice(0, 5)).toEqual([
      [tag],
      [
        "checkout.ts: this `catch` does not name `PaymentDeclinedError`: it handles every error alike",
        tag,
      ],
      [
        "checkout.ts: this `catch` does not name `PaymentDeclinedError`: it handles every error alike",
        tag,
      ],
      ["checkout.ts: this `catch` rethrows `PaymentDeclinedError`", tag],
      [
        "errors.ts: `CardExpiredError` extends `PaymentDeclinedError`, which must be handled: Tell the user the card was declined and let them pick another card.",
      ],
    ]);
  });

  it("offers one fix, Pass it on, that adds @throws to the JSDoc or creates it", () => {
    const text = readFileSync(path.join(FLAGGED, "checkout.ts"), "utf8");
    const fixed = found().flatMap((f) => {
      if (f.kind !== "problem") return [];
      const [fix] = f.fixes;
      const [edit] = fix?.edits ?? [];
      if (fix === undefined || edit === undefined) return [`${textAt(f)}: none`];
      const after =
        text.slice(0, edit.location.start) + edit.newText + text.slice(edit.location.end);
      const from = edit.location.start;
      const shownText = after.slice(from, after.indexOf("function", from) + "function".length);
      return [`${fix.title}\n${shownText}`];
    });
    expect(fixed).toEqual([
      "Pass it on: add `@throws {PaymentDeclinedError}` to `renew`\n/** @throws {PaymentDeclinedError} */\nexport async function",
      "pay: none",
      "pay: none",
      "Pass it on: add `@throws {PaymentDeclinedError}` to `payAndReport`\n * @throws {PaymentDeclinedError}\n */\nexport async function",
      "Pass it on: add `@throws {CardExpiredError}` to `payButtonLabel`\n/**\n * The label of the pay button.\n * @throws {CardExpiredError}\n */\nexport function",
    ]);
  });

  it("accepts a catch that names it, a subclass branch, a callback handled inside and @throws on a rethrow-all", () => {
    expect(checkOnly(fixture(`${RULE}/not-flagged`), RULE)).toEqual([]);
  });

  it("accepts a negative guard, a conditional expression, an `&&`, a helper called only inside a handling try, and a catch that hands the error to a helper naming it first thing", () => {
    expect(checkOnly(fixture(`${RULE}/handled-forms`), RULE)).toEqual([]);
  });

  it("flags a guard or conditional that names another class, a guard that does not leave, and a helper also called bare", () => {
    const hint = (fn: string): string =>
      `name it in this \`catch\`, which treats every error alike, or rethrow it and add \`@throws {Declined}\` to \`${fn}\`:\n` +
      "    if (e instanceof Declined) {\n      // Tell the user the card was declined.\n    }";
    const bare = (fn: string): string =>
      `name it in a \`catch\`, pass it on with \`@throws {Declined}\` on \`${fn}\`, or return it as a failure instead of throwing:\n` +
      "    if (e instanceof Declined) {\n      // Tell the user the card was declined.\n    }";
    expect(shown(checkOnly(fixture(`${RULE}/flagged-forms`), RULE))).toEqual([
      says(
        "forms.ts",
        "`pay(…)` can throw `Declined`, which must be handled",
        hint("guardedByError"),
      ),
      says(
        "forms.ts",
        "`pay(…)` can throw `Declined`, which must be handled",
        hint("conditionalByError"),
      ),
      says("forms.ts", "`pay(…)` can throw `Declined`, which must be handled", hint("notAGuard")),
      says("forms.ts", "`pay(…)` can throw `Declined`, which must be handled", bare("charge")),
      says(
        "forms.ts",
        "`charge(…)` can throw `Declined`, which must be handled",
        bare("helperCalledBare"),
      ),
      // a helper that rethrows it, tests it after other code, or is a level further.
      says(
        "forms.ts",
        "`pay(…)` can throw `Declined`, which must be handled",
        hint("helperRethrows"),
      ),
      says(
        "forms.ts",
        "`pay(…)` can throw `Declined`, which must be handled",
        hint("helperTestsLater"),
      ),
      says(
        "forms.ts",
        "`pay(…)` can throw `Declined`, which must be handled",
        hint("helperTwoLevels"),
      ),
    ]);
  });

  it("reports nothing in a project with no @mustHandle", () => {
    expect(checkOnly(fixture("catch-misses-error/flagged"), RULE)).toEqual([]);
    expect(checkOnly(fixture("throws-doc-mismatch/flagged"), RULE)).toEqual([]);
  });
});
