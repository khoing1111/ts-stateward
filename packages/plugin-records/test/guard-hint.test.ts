import { randomUUID } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import { check, fixture, shown } from "./helpers.js";

const DIR = fixture("ambiguous-table/flagged");
const FILE = "keys-of-itself-and-wide.ts";
const READ = "return stock[item];";

const hintOf = (dir: string): string | undefined =>
  shown(check(dir)).find((one) => one.file === FILE && one.name === "stock")?.hint;

/** The fixture copied next to itself, with `FILE` rewritten, then removed. */
function withFile<T>(text: string, then: (copy: string) => T): T {
  const copy = `${DIR}-copy-${randomUUID().slice(0, 8)}`;
  try {
    cpSync(DIR, copy, { recursive: true });
    writeFileSync(path.join(copy, FILE), text);
    return then(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

describe("records/ambiguous-table: the check of the key the hint shows", () => {
  const hint = hintOf(DIR);

  it("writes the check with the developer's table and key, and no helper that exists nowhere", () => {
    expect(hint).toContain(
      "- or read it only where `Object.hasOwn(stock, item)` is true (needs the ES2022 `lib`)",
    );
    expect(hint).not.toContain("isKeyOf");
    expect(hint).not.toContain("the quick fix of `records/unchecked-key`");
    expect(hint).not.toMatch(/, key\)/);
  });

  it("compiles and is no longer reported once the read is guarded as shown", () => {
    const original = readFileSync(path.join(DIR, FILE), "utf8");
    expect(original).toContain(READ);
    const guarded = original.replace(
      READ,
      "return Object.hasOwn(stock, item) ? stock[item] : undefined;",
    );
    withFile(guarded, (copy) => {
      expect(typeErrors(copy)).toBe("");
      expect(hintOf(copy)).toBeUndefined();
    });
  });
});
