import { describe, expect, it } from "vitest";
import { checkOnly, fixture, says, shown } from "./brand-helpers.js";

const RULE = "brand-built-outside-owner";
const DIR = fixture(`${RULE}/opaque`);

describe(`ownership/${RULE}: a brand stated \`Opaque\``, () => {
  const findings = checkOnly(DIR, RULE);

  it("reports every value built outside its module: a plain value, a cast, `any`, an object literal", () => {
    const check = "build it with `orderId()` from `./order-id.ts`";
    expect(shown(DIR, findings)).toEqual([
      says("orders.ts", '`OrderId` is built from `"o-2"` outside `./order-id.ts`', check),
      says("orders.ts", "`OrderId` is built without its check", check),
      says("orders.ts", "`OrderId` is built from an `any` value outside `./order-id.ts`", check),
      says(
        "orders.ts",
        "`Point` is built from `{ x: 1, y: 2 }` outside `./point.ts`",
        "build it with `point()` from `./point.ts`",
      ),
      // A branch of a conditional is the value; `undefined` builds no brand.
      says("orders.ts", "`OrderId` is built from `raw` outside `./order-id.ts`", check),
      // Stated with no constructor: still only its module builds one.
      says(
        "orders.ts",
        '`Label` is built from `"urgent"` outside `./label.ts`',
        "build it in `./label.ts`, its owner",
      ),
      // Through a local alias, the owner is the module that states it.
      says("orders.ts", "`OrderId` is built from `raw` outside `./order-id.ts`", check),
    ]);
  });

  it("names where the trait is stated, so `stateward guarantees` counts the error", () => {
    const brands = ["OrderId", "OrderId", "OrderId", "Point", "OrderId", "Label", "OrderId"];
    const notes = findings.map((finding) =>
      finding.kind === "problem" ? finding.related.map((note) => note.message) : [],
    );
    expect(notes).toEqual(brands.map((brand) => [`\`${brand}\` is stated \`Opaque\` here`]));
  });
});
