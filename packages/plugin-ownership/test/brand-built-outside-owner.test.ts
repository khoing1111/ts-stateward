import { describe, expect, it } from "vitest";
import { checkOnly, fixture, says, shown, ways, type Shown } from "./brand-helpers.js";

const RULE = "brand-built-outside-owner";

function built(brand: string): string {
  return `\`${brand}\` is built without its check`;
}

/** The constructor each fixture brand's file exports, and whether it builds or checks a value. */
const MAKERS: Readonly<Record<string, string>> = {
  Positive: "build it with `positive()`",
  NonNegative: "check it with `isNonNegative()`",
  Int: "check it with `assertInt()`",
  NonEmptyString: "build it with `nonEmptyString()`",
  NonEmptyArray: "build it with `nonEmptyArray()`",
  Cents: "build it with `cents()`",
  UserId: "build it with `userId()`",
  OrderId: "build it with `orderId()`",
  Email: "build it with `email()`",
};

/** The brands whose constructor returns `undefined` for a value that fails its check. */
const FAILS: ReadonlySet<string> = new Set([
  "Positive",
  "NonEmptyString",
  "NonEmptyArray",
  "UserId",
  "OrderId",
  "Email",
]);

/** The way to fix a brand built in the owner's absence: its constructor, and what it returns. */
function viaMaker(brand: string, owner: string, file: string): string {
  const handled = FAILS.has(brand) ? ", and handle the `undefined` it returns" : "";
  // The hint gives the path as the file imports it (`.js`), the headline the file (`.ts`).
  const imported = owner.replace(/\.ts$/, ".js");
  return ways(`${MAKERS[brand] ?? ""} from \`${imported}\`${handled}`, brand, file);
}

/** A project brand: the fix line names the constructor its owner file exports. */
function owned(file: string, brand: string, owner: string): Shown {
  return says(file, built(brand), viaMaker(brand, owner, file));
}

/** The brands whose constructor can fail: the hint never tells to build one without handling that. */
function everyFailingMakerIsHandled(findings: readonly Shown[]): void {
  for (const finding of findings) {
    if (
      /build it with `(?:positive|nonEmptyString|nonEmptyArray|userId|orderId|email)\(\)`/.test(
        finding.hint,
      )
    ) {
      expect(finding.hint).toContain("and handle the `undefined` it returns");
    }
  }
}

function flagged(): Shown[] {
  const dir = fixture(`${RULE}/flagged`);
  return shown(dir, checkOnly(dir, RULE));
}

describe(`ownership/${RULE}: flagged`, () => {
  it("names the brand and the file that owns it, for a brand made with the project's helper", () => {
    expect(flagged().filter((finding) => finding.file === "builtins.ts")).toEqual([
      owned("builtins.ts", "Positive", "./values.ts"), // input as Positive
      owned("builtins.ts", "Positive", "./values.ts"), // <Positive>input
      owned("builtins.ts", "Positive", "./values.ts"), // input as unknown as Positive
      owned("builtins.ts", "NonNegative", "./values.ts"),
      owned("builtins.ts", "Int", "./values.ts"),
      owned("builtins.ts", "NonEmptyString", "./values.ts"),
      owned("builtins.ts", "NonEmptyArray", "./values.ts"),
      owned("builtins.ts", "Positive", "./values.ts"), // Positive & Int: the first brand
      owned("builtins.ts", "Positive", "./values.ts"), // (input as Positive) + 1
      owned("builtins.ts", "Int", "./values.ts"), // a parenthesized type
    ]);
  });

  it("never offers a constructor that returns `Positive | undefined` as if it returned `Positive`", () => {
    everyFailingMakerIsHandled(flagged());
  });

  it("names a project brand and its owner file, relative to the file that casts", () => {
    expect(flagged().filter((finding) => finding.file === "users.ts")).toEqual([
      owned("users.ts", "UserId", "./ids.ts"),
      owned("users.ts", "OrderId", "./ids.ts"),
      owned("users.ts", "Positive", "./values.ts"), // Qty = Positive renames, so it owns nothing
      owned("users.ts", "UserId", "./ids.ts"), // UserId & OrderId: the first brand
      owned("users.ts", "Email", "./email.ts"), // a hand-written brand with a `__brand` tag
    ]);
    expect(flagged().filter((finding) => finding.file === "sub/deep.ts")).toEqual([
      owned("sub/deep.ts", "UserId", "../ids.ts"),
    ]);
  });

  it("follows aliased imports, namespace imports and re-exported types to the declaration", () => {
    expect(flagged().filter((finding) => finding.file === "aliased.ts")).toEqual([
      owned("aliased.ts", "Positive", "./values.ts"), // import type { Positive as Pos }
      owned("aliased.ts", "Positive", "./values.ts"), // v.Positive
      owned("aliased.ts", "Cents", "./money.ts"), // import type { Cents as Money }
      owned("aliased.ts", "Cents", "./money.ts"), // re-exported from reexport.ts
      owned("aliased.ts", "UserId", "./ids.ts"), // re-exported as Id
    ]);
  });

  it("resolves a local alias to the brand's real declaration, not the file that renames it", () => {
    expect(flagged().filter((finding) => finding.file === "alias-local.ts")).toEqual([
      owned("alias-local.ts", "Positive", "./values.ts"), // the alias file does not own Positive
    ]);
    expect(flagged().filter((finding) => finding.file === "alias-user.ts")).toEqual([
      owned("alias-user.ts", "Positive", "./values.ts"), // not "build it in ./alias-local.ts"
      owned("alias-user.ts", "Cents", "./money.ts"), // type Money = Cents
      owned("alias-user.ts", "Cents", "./money.ts"), // type Parenthesized = (Cents)
    ]);
  });

  it("looks inside unions, arrays, tuples and object members, one level deep", () => {
    const positive = owned("containers.ts", "Positive", "./values.ts");
    const cents = owned("containers.ts", "Cents", "./money.ts");
    expect(flagged().filter((finding) => finding.file === "containers.ts")).toEqual([
      positive, // Positive | undefined
      positive, // Positive[]
      positive, // readonly Positive[]
      positive, // Array<Positive>
      positive, // { qty: Positive }
      cents, // [string, Cents]
      cents, // { readonly price?: Cents } | null
      positive, // [label: string, ...rest: Positive[]]
    ]);
  });

  it("flags a type predicate or assertion function that declares values without their check", () => {
    const declares = (name: string, brand: string): Shown =>
      says(
        "predicates.ts",
        `${name} says a value is \`${brand}\` without its check`,
        viaMaker("Positive", "./values.ts", "predicates.ts"),
      );
    expect(flagged().filter((finding) => finding.file === "predicates.ts")).toEqual([
      declares("`isQty`", "Positive"),
      declares("`assertQty`", "Positive"),
      says(
        "predicates.ts",
        "`isPrice` says a value is `Cents` without its check",
        viaMaker("Cents", "./money.ts", "predicates.ts"),
      ),
      declares("`isMaybeQty`", "Positive"),
      declares("`Check`", "Positive"),
      declares("an unnamed function", "Positive"),
    ]);
  });

  it("does not report the owner's own casts, and reports in the order of files", () => {
    const files = flagged().map((finding) => finding.file);
    expect(files).not.toContain("money.ts");
    expect(files).not.toContain("values.ts");
    expect(files).not.toContain("email.ts");
    expect([...files].sort()).toEqual(files);
  });

  it("is an error on the assertion, with no quick fix", () => {
    const dir = fixture(`${RULE}/flagged`);
    const [first] = checkOnly(dir, RULE);
    expect(first).toMatchObject({
      kind: "problem",
      ruleId: `ownership/${RULE}`,
      severity: "error",
      related: [],
      fixes: [],
    });
  });
});

describe(`ownership/${RULE}: not flagged`, () => {
  it("accepts casts in the owner file, constructors, other types, look-alikes, type parameters, and brands with no exported check", () => {
    const dir = fixture(`${RULE}/not-flagged`);
    expect(shown(dir, checkOnly(dir, RULE))).toEqual([]);
  });
});
