import { randomUUID } from "node:crypto";
import { cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { typeErrors } from "@stateward/core/testing";
import { check, fixture } from "./helpers.js";

const DIR = fixture("ambiguous-table/map-hint");
const [found] = check(DIR);

/** The fixture with `labels.ts` replaced by `text`, as a copy next to it. */
function withLabels<T>(text: string, then: (copy: string) => T): T {
  const copy = `${DIR}-copy-${randomUUID().slice(0, 8)}`;
  try {
    cpSync(DIR, copy, { recursive: true });
    writeFileSync(path.join(copy, "labels.ts"), text);
    return then(copy);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

describe("records/ambiguous-table: a Map of literal pairs", () => {
  it("asks, as an info, and says the object needs a union of the keys that its readers use", () => {
    expect(found?.kind === "problem" ? found.severity : undefined).toBe("info");
    expect(found?.message).toBe("`labels` is a Map of literal pairs that no code changes");
    expect(found?.hint).toBe(
      [
        "one of",
        '- if its keys are fixed, write it as an object `{ … } as const satisfies Record<K, V>` with `K` the union of its keys (`"idle" | "failed"`), and type the keys that read it `K`',
        "- or, if its keys come from outside, keep the Map, whose `get` returns `undefined` for a missing key, and list `labels` under the rule's `ignore` option",
      ].join("\n"),
    );
  });

  it("no longer says a missing key fails to compile where the key is a `string`", () => {
    expect(found?.hint).not.toContain("Record<…>");
    expect(found?.hint).not.toContain("a missing or misspelt key then fails to compile");
    // The old advice, applied to the reader as it is, does not compile: a `string` indexes nothing.
    const stale = `export const labels = { idle: "Idle", failed: "Failed" } as const satisfies Record<"idle" | "failed", string>;

export function title(status: string): string {
  return labels[status];
}
`;
    expect(withLabels(stale, typeErrors)).toContain("TS7053");
  });

  it("compiles, and is no longer asked about, written as the hint says", () => {
    const written = `type K = "idle" | "failed";

const labels = { idle: "Idle", failed: "Failed" } as const satisfies Record<K, string>;

export function title(status: K): string {
  return labels[status];
}
`;
    withLabels(written, (copy) => {
      expect(typeErrors(copy)).toBe("");
      expect(check(copy)).toEqual([]);
    });
  });

  it("keeps the Map when the name is listed under `ignore`, as the hint says", () => {
    expect(check(DIR, { "records/ambiguous-table": ["error", { ignore: ["labels"] }] })).toEqual(
      [],
    );
  });
});
