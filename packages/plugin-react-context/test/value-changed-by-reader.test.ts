import { randomUUID } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Finding } from "@stateward/core";
import { checkFixture, expectMessageStandard, typeErrors } from "@stateward/core/testing";
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

const FUNCTION_WAY =
  "- add a function to the value that sets the Provider's state, and call it: readers re-render only when the Provider passes a new value";
const IGNORE_WAY = [
  "- or, if it is changed in place on purpose, list `CartContext` under the rule's `ignore` option:",
  '    { ignore: ["CartContext"] }',
];
const hintOf = (readonlyWay: string | undefined): string =>
  [
    "one of",
    FUNCTION_WAY,
    ...(readonlyWay === undefined ? [] : [`- or ${readonlyWay}, so TypeScript rejects the write`]),
    ...IGNORE_WAY,
  ].join("\n");
const HINT = hintOf("type it as a `ReadonlyArray` (`readonly T[]`)");

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

describe("react-context/value-changed-by-reader: every way the hint offers", () => {
  const findings = run([RULE]);
  const hints = findings.map((finding) => finding.hint);
  const property = hintOf("mark the property `readonly`");

  it("offers the function, a `readonly` declaration where TypeScript then rejects the write, and `ignore`", () => {
    expect(hints).toEqual([
      HINT,
      property,
      property,
      property,
      HINT,
      hintOf("type it as a `ReadonlyMap`"),
      hintOf("type it as a `ReadonlySet`"),
      // `Object.assign` accepts a read-only target: no `readonly` reading is offered.
      hintOf(undefined),
      property,
      HINT,
    ]);
  });

  it("no longer says a function exists that the Provider passes", () => {
    for (const hint of hints) {
      expect(hint).not.toContain("call a function the `CartContext` Provider passes");
    }
  });

  /** The fixture with its `Cart` type changed as the hint says, as a copy next to it. */
  function withCart(change: (type: string) => string): { errors: string; left: readonly string[] } {
    const copy = `${DIR}-copy-${randomUUID().slice(0, 8)}`;
    try {
      cpSync(DIR, copy, { recursive: true });
      const file = path.join(copy, "cart.tsx");
      writeFileSync(file, change(readFileSync(file, "utf8")));
      const { findings: after } = checkFixture(copy, [reactContext()], {}, [RULE]);
      return {
        errors: typeErrors(copy),
        left: after.filter((one) => one.ruleId === RULE).map((one) => one.message),
      };
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }

  it("makes TypeScript reject each write to a property declared `readonly`", () => {
    const { errors } = withCart((text) =>
      text
        .replace("  count: number;", "  readonly count: number;")
        .replace("  draft?: string;", "  readonly draft?: string;")
        .replace("  items: string[];", "  readonly items: string[];"),
    );
    // `cart.count += 1`, `cart.count++`, `delete cart.draft` and `cart.items = []`.
    expect(errors.match(/error TS2540/g)).toHaveLength(3);
    expect(errors).toContain("TS2704");
  });

  it("makes the array, Map and Set mutators unavailable once declared read-only, and silences them", () => {
    const { errors, left } = withCart((text) =>
      text
        .replace("  items: string[];", "  items: readonly string[];")
        .replace("  byId: Map<string, string>;", "  byId: ReadonlyMap<string, string>;")
        .replace("  tags: Set<string>;", "  tags: ReadonlySet<string>;"),
    );
    expect(errors.match(/error TS2339/g)?.length).toBeGreaterThanOrEqual(5);
    expect(left).toEqual([
      "`cart.count += …` changes the `CartContext` value outside its Provider",
      "`cart.count++` changes the `CartContext` value outside its Provider",
      "`delete cart.draft` changes the `CartContext` value outside its Provider",
      "`Object.assign(cart, …)` changes the `CartContext` value outside its Provider",
      "`cart.items = …` changes the `CartContext` value outside its Provider",
    ]);
  });

  it("is silent for a context listed under `ignore` exactly as the hint shows", () => {
    const listed = (hints[0] ?? "").split("\n").at(-1) ?? "";
    const names: unknown = JSON.parse(listed.replace(/^\s*\{ ignore: /, "").replace(/ \}$/, ""));
    if (!Array.isArray(names) || !names.every((one) => typeof one === "string")) {
      throw new Error("the hint lists names");
    }
    expect(names).toEqual(["CartContext"]);
    const { findings: after } = checkFixture(
      DIR,
      [reactContext()],
      { [RULE]: ["error", { ignore: names }] },
      [RULE],
    );
    expect(after.filter((one) => one.ruleId === RULE)).toEqual([]);
  });
});
