import path from "node:path";
import { describe, expect, it } from "vitest";
import { createChecker, parseConfig } from "@stateward/core";
import { describeStatus, proveGuarantees } from "@stateward/core/internal";
import { ownership } from "../src/index.js";
import { fixture } from "./helpers.js";

const OWNED = fixture("state-written-outside-owner/owned");
/** `flags`, stated owned and read, never changed. */
const DEAD = fixture("guarantees");
const RULE = "ownership/state-written-outside-owner";
const OPAQUE = fixture("brand-built-outside-owner/opaque");
const BRAND_RULE = "ownership/brand-built-outside-owner";

/** Each value stated owned as `<file> <name> <marker>: <status> [<writers>]`. */
function listed(dir: string, rules: readonly string[] = [RULE]): string[] {
  const parsed = parseConfig({ plugins: [ownership()], preset: "recommended" }, dir);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const checker = createChecker({ config: parsed.value, cwd: dir });
  const result = checker.check();
  return proveGuarantees(checker.guarantees(), result.findings, new Set(rules)).map((proof) => {
    const writers = proof.stated.covered.map((place) => place.name).join(", ");
    const file = path.relative(dir, proof.stated.location.file);
    return `${file} ${proof.stated.name} ${proof.stated.marker}: ${describeStatus(proof)} [${writers}]`;
  });
}

describe("ownership: the guarantees it states", { timeout: 30_000 }, () => {
  it("lists each value stated owned with the modules that change it, the owner's replacements included", () => {
    expect(listed(OWNED)).toEqual([
      // The owner never changes it; three other modules do.
      "mine.ts registry Mine<Map<string, number>>: not proven: 4 errors [cast.ts, methods.ts, reexport.ts]",
      "settings.ts settings Owned<Settings>: not proven: 13 errors [alias.ts, cast.ts, direct.ts, methods.ts, reexport.ts, settings.ts]",
      "store.ts Store.items Owned<string[]>: not proven: 3 errors [alias.ts, methods.ts, store.ts]",
      // `count += 1` in its own module: replaced by its owner only.
      "store.ts count Owned<number>: proven for 1 writer [store.ts]",
      "store.ts jobs Owned<{ done: boolean }[]>: not proven: 2 errors [alias.ts, store.ts]",
    ]);
  });

  it("lists a value stated owned that nothing changes as unused, never leaves it out; a copy of it is not listed", () => {
    expect(listed(DEAD)).toEqual([
      "flags.ts flags Owned<{ beta: boolean }>: unused: no writer, so nothing to prove; use it or drop the marker []",
    ]);
  });
});

describe("ownership: the brands it states opaque", { timeout: 30_000 }, () => {
  it("lists each brand stated opaque with the places in its module that build one", () => {
    expect(listed(OPAQUE, [RULE, BRAND_RULE])).toEqual([
      // `DEFAULT_LABEL` is built in its module; `"urgent"` in orders.ts is not.
      "label.ts Label Opaque: not proven: 1 error [label.ts]",
      // `orderId()` returns `raw`, and `FIRST`; five places in orders.ts build one.
      "order-id.ts OrderId Opaque: not proven: 5 errors [order-id.ts, order-id.ts]",
      "point.ts Point Opaque: not proven: 1 error [point.ts]",
    ]);
  });
});
