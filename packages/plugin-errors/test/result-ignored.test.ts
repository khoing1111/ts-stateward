import { describe, expect, it } from "vitest";
import { checkOnly, fixture, says, shown, type Shown } from "./helpers.js";

const RULE = "result-ignored";

function dropped(
  callee: string,
  file: string,
  call: string,
  awaited = false,
  check = "if (!saved.ok) return saved;",
): Shown {
  return says(
    file,
    `the \`Result\` of \`${callee}(…)\` is dropped: its error is never handled`,
    [
      "check it, or pass it on:",
      `    const saved = ${awaited ? "await " : ""}${call};`,
      `    ${check}`,
    ].join("\n"),
  );
}

function inFlagged(file: string): Shown[] {
  const dir = fixture(`${RULE}/flagged`);
  return shown(checkOnly(dir, RULE)).filter((finding) => finding.file === file);
}

describe(`errors/${RULE}: flagged`, () => {
  it("says which call is dropped and shows how to check it, for a sync Result", () => {
    const at = (callee: string, call: string): Shown => dropped(callee, "sync.ts", call);
    expect(inFlagged("sync.ts")).toEqual([
      at("saveUser", "saveUser(user)"), // a statement
      at("saveUser", "saveUser(user)"), // void saveUser(user)
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
    const at = (callee: string, call: string): Shown => dropped(callee, "async.ts", call, true);
    expect(inFlagged("async.ts")).toEqual([
      at("loadUser", "loadUser(id)"), // await loadUser(id);
      at("loadUser", "loadUser(id)"), // void loadUser(id);
      at("loadUser", "loadUser(id)"), // loadUser(id);
      at("loadUser", "loadUser(id)"), // void (await loadUser(id));
      at("inferred", "inferred(true)"),
      // a long call keeps its callee and shows its arguments as …
      at("tryCatchAsync", "tryCatchAsync(…)"),
    ]);
  });

  it("knows neverthrow's `Ok | Err` and a zod-like `safeParse` result by their shape", () => {
    expect(inFlagged("shapes.ts")).toEqual([
      dropped(
        "chargeCard",
        "shapes.ts",
        "chargeCard(10)",
        true,
        "if (saved.isErr()) return saved;",
      ),
      dropped(
        "parseUser",
        "shapes.ts",
        "parseUser(input)",
        false,
        "if (!saved.success) return saved;",
      ),
    ]);
  });
});

describe(`errors/${RULE}: not flagged`, () => {
  it("accepts a result that is used or passed on, and types that only look like one", () => {
    const dir = fixture(`${RULE}/not-flagged`);
    expect(shown(checkOnly(dir, RULE))).toEqual([]);
  });
});
