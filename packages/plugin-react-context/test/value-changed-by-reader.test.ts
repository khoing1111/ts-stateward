import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkFixture, expectMessageStandard } from "@stateward/core/testing";
import { reactContext } from "../src/index.js";

const RULE = "react-context/value-changed-by-reader";
const DIR = fileURLToPath(new URL("./fixtures/value-changed-by-reader", import.meta.url));

function run(addons: readonly string[]): readonly Finding[] {
  const { findings } = checkFixture(DIR, [reactContext()], {}, addons);
  expectMessageStandard(findings);
  return findings.filter((finding) => finding.ruleId === RULE);
}

function line(finding: Finding): string {
  const text = readFileSync(finding.location.file, "utf8");
  const at = text.slice(0, finding.location.start).split("\n").length;
  return `${path.basename(finding.location.file)}:${String(at)}: ${finding.message}`;
}

const HINT =
  "call a function the `CartContext` Provider passes in the value to set its state: readers re-render only when the Provider passes a new value";

describe("react-context/value-changed-by-reader", () => {
  it("is an add-on: off until the config names it", () => {
    expect(run([])).toEqual([]);
  });

  it("reports each write to the value or a part of it, in a component or hook", () => {
    const findings = run([RULE]);
    expect(findings.map(line)).toEqual([
      "cart.tsx:37: `cart.items.push(…)` changes the `CartContext` value outside its Provider",
      "cart.tsx:38: `cart.count += …` changes the `CartContext` value outside its Provider",
      "cart.tsx:39: `cart.count++` changes the `CartContext` value outside its Provider",
      "cart.tsx:40: `delete cart.draft` changes the `CartContext` value outside its Provider",
      "cart.tsx:41: `items.sort(…)` changes the `CartContext` value outside its Provider",
      "cart.tsx:42: `byId.set(…)` changes the `CartContext` value outside its Provider",
      "cart.tsx:43: `cart.tags.add(…)` changes the `CartContext` value outside its Provider",
      "cart.tsx:44: `Object.assign(cart, …)` changes the `CartContext` value outside its Provider",
      // Through `useCart()`, which returns the value, and through `use`.
      "cart.tsx:59: `cart.items = …` changes the `CartContext` value outside its Provider",
      "cart.tsx:60: `other.items.splice(…)` changes the `CartContext` value outside its Provider",
    ]);
    const [first] = findings;
    expect(first?.hint).toBe(HINT);
    expect(first?.kind === "problem" ? first.related.map((note) => note.message) : []).toEqual([
      "`useContext(CartContext)` reads the value",
    ]);
  });

  it("`ignore`: a context named there is not reported", () => {
    const { findings } = checkFixture(
      DIR,
      [reactContext()],
      { [RULE]: ["error", { ignore: ["Cart*"] }] },
      [RULE],
    );
    expect(findings.filter((finding) => finding.ruleId === RULE)).toEqual([]);
  });
});
