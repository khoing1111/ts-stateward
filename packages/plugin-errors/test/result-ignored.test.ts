import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { typeErrorsOfText } from "@stateward/core/testing";
import { checkOnly, fixture, says, shown, type Shown } from "./helpers.js";

const RULE = "result-ignored";

/** What the hint says about a drop that is on purpose: `void` already, or not yet. */
const ON_PURPOSE = {
  plain:
    "- or, if dropping it is on purpose, write `void` before the call and set the rule's `allowVoid` option to `true`",
  voided:
    "- or, if dropping it is on purpose, set the rule's `allowVoid` option to `true`: a `void` drop is then stated",
};

/** A function that returns something else than the Result: the failure is handled, not returned. */
const HANDLE =
  "- check it, and handle its failure (report it, recover, or pass it on from a function that returns a Result)";

function dropped(
  callee: string,
  file: string,
  call: string,
  awaited = false,
  check = "if (!saved.ok) { … }",
  voided = false,
  first = HANDLE,
): Shown {
  return says(
    file,
    `the \`Result\` of \`${callee}(…)\` is dropped: its error is never handled`,
    [
      "one of",
      first,
      `    const saved = ${awaited ? "await " : ""}${call};`,
      `    ${check}`,
      voided ? ON_PURPOSE.voided : ON_PURPOSE.plain,
      `- or, if \`${call.replace(/\(.*$/s, "")}\` may always be dropped, list it under the rule's \`ignore\` option`,
    ].join("\n"),
  );
}

function inFlagged(file: string): Shown[] {
  const dir = fixture(`${RULE}/flagged`);
  return shown(checkOnly(dir, RULE)).filter((finding) => finding.file === file);
}

describe(`errors/${RULE}: flagged`, () => {
  it("says which call is dropped and shows how to check it, for a sync Result", () => {
    const at = (callee: string, call: string, voided = false): Shown =>
      dropped(callee, "sync.ts", call, false, undefined, voided);
    expect(inFlagged("sync.ts")).toEqual([
      at("saveUser", "saveUser(user)"), // a statement
      at("saveUser", "saveUser(user)", true), // void saveUser(user)
      at("saveUser", "saveUser(user)"), // (saveUser(user))
      at("repo.save", "repo.save(user)"),
      // a long callee keeps its end in the headline and its start in the example
      at("…ase.users.insertOneUserRecord", "app.database.users.insertOneUserRecord(user)"),
      at("inferred", "inferred(true)"), // the Result is inferred from ok() and err()
      at("ok", "ok(1)"),
      at("map", "map(saveUser(user), () => 1)"),
      at("tryCatch", 'tryCatch(() => 1, () => new Error("failed"))'),
      at("saveUser", "saveUser(user)"), // in an arrow function
      at("saveUser", "saveUser(user)"), // in a method
    ]);
  });

  it("flags a Promise of a Result that is awaited and dropped, voided, or left", () => {
    const at = (callee: string, call: string, voided = false): Shown =>
      dropped(callee, "async.ts", call, true, undefined, voided);
    expect(inFlagged("async.ts")).toEqual([
      at("loadUser", "loadUser(id)"), // await loadUser(id);
      at("loadUser", "loadUser(id)", true), // void loadUser(id);
      at("loadUser", "loadUser(id)"), // loadUser(id);
      at("loadUser", "loadUser(id)", true), // void (await loadUser(id));
      at("inferred", "inferred(true)"),
      // a long call keeps its callee and shows its arguments as …
      at("tryCatchAsync", "tryCatchAsync(…)"),
    ]);
  });

  it("knows neverthrow's `Ok | Err` and a zod-like `safeParse` result by their shape", () => {
    expect(inFlagged("shapes.ts")).toEqual([
      dropped("chargeCard", "shapes.ts", "chargeCard(10)", true, "if (saved.isErr()) { … }"),
      dropped("parseUser", "shapes.ts", "parseUser(input)", false, "if (!saved.success) { … }"),
    ]);
  });
});

describe(`errors/${RULE}: the code the hint shows fits the function`, () => {
  const dir = fixture(`${RULE}/function-shapes`);
  const findings = checkOnly(dir, RULE);
  const text = readFileSync(path.join(dir, "shapes.ts"), "utf8");

  it("returns the Result only from a function that returns that Result; says `async` where `await` needs it; keeps names free", () => {
    const hints = findings.map((finding) => finding.hint.split("\n"));
    expect(hints.map((lines) => lines.slice(1, 4))).toEqual([
      [
        "- check it, and pass it on",
        "    const saved = await loadUser(id);",
        "    if (!saved.ok) return saved;",
      ],
      [HANDLE, "    const saved = await loadUser(id);", "    if (!saved.ok) { … }"],
      [
        `${HANDLE}; \`await\` needs the function to be \`async\``,
        "    const saved = await loadUser(id);",
        "    if (!saved.ok) { … }",
      ],
      [HANDLE, "    const result = await loadUser(id);", "    if (!result.ok) { … }"],
    ]);
    // The old advice, returning the Result from a `Promise<void>` function, is gone.
    expect(findings.filter((finding) => finding.hint.includes("return saved;"))).toHaveLength(1);
  });

  it("writes code that compiles in the function it is shown for (`…` filled in, `async` added where said)", () => {
    for (const finding of findings) {
      const lines = finding.hint
        .split("\n")
        .filter((line) => line.startsWith("    "))
        .map((line) => line.trim().replace("{ … }", "{ void 0; }"));
      let source =
        text.slice(0, finding.location.start) + lines.join("\n") + text.slice(finding.location.end);
      // `notAsync` is made `async` as the hint says; it returns nothing, so its type follows.
      source = source.replace(
        "export function notAsync(): void {",
        "export async function notAsync(): Promise<void> {",
      );
      expect(typeErrorsOfText(source)).toBe("");
    }
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts a result that is used or passed on, and types that only look like one", () => {
    const dir = fixture(`${RULE}/not-flagged`);
    expect(shown(checkOnly(dir, RULE))).toEqual([]);
  });
});
