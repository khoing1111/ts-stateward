import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTypeQueries } from "../src/backend/typescript6.js";
import { indexLedger, stoppedReason } from "../src/ledger.js";
import type { LedgerRef, RuleProves, StatedGuarantee } from "../src/types.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stateward-typed-flows-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const MARKERS = `export type Opaque<T, Name extends string> = T & { readonly "__guarantee:opaque"?: Name };
export type OpenUnion<T = unknown> = T & { readonly "__guarantee:open-union"?: true };
export type Pending<T, Running extends T = Extract<T, true>> = T & { readonly "__guarantee:pending"?: Running };
`;

const PROVES: RuleProves = {
  traits: ["pending"],
  flows: { produced: ["opaque"], decided: ["open-union"], escaped: ["pending"] },
};

/** The flows of each file, as "<kind> <via> <text>", with the queries of their program. */
function flowsOf(sources: Record<string, string>, budget?: number) {
  const all = { "guarantees.ts": MARKERS, ...sources };
  for (const [file, text] of Object.entries(all)) writeFileSync(path.join(dir, file), text);
  const files = Object.keys(all).map((file) => path.join(dir, file).split(path.sep).join("/"));
  const program = ts.createProgram({
    rootNames: files,
    options: { strict: true, noEmit: true, module: ts.ModuleKind.ESNext, types: [] },
  });
  const types = createTypeQueries(
    program,
    new Set(files),
    dir,
    () => undefined,
    () => false,
    () => [],
  );
  const found = new Map<string, string[]>();
  for (const file of Object.keys(sources)) {
    const sourceFile = program.getSourceFile(path.join(dir, file).split(path.sep).join("/"));
    if (sourceFile === undefined) throw new Error(`no ${file}`);
    found.set(
      file,
      types
        .typedFlowsIn(sourceFile, PROVES, budget)
        .map((flow) => `${flow.form} ${flow.via ?? ""} ${flow.text}`),
    );
  }
  return found;
}

describe("typed flows", () => {
  it("lists values made of a brand, values decided by an open union, and escaped holders", () => {
    const found = flowsOf({
      "ids.ts": `import type { Opaque, OpenUnion } from "./guarantees";
export type OrderId = Opaque<string, "OrderId">;
export type Status = OpenUnion<"a" | "b">;
`,
      "a.ts": `import type { OrderId, Status } from "./ids";
import type { Pending } from "./guarantees";
declare function get<T>(url: string): T;
export const id: OrderId = get<OrderId>("/x");
export const plain: OrderId = "o-1";
export function label(s: Status): number {
  switch (s) { case "a": return 1; default: return 0; }
}
export const same = (s: Status): boolean => s === "a";
export class Saver {
  saving: Pending<boolean> = false;
  start(): void { Object.assign(this, { saving: true }); }
}
`,
    });
    expect(found.get("a.ts")).toEqual([
      'produced generic-call get<OrderId>("/x")',
      'produced value "o-1"',
      "decided value s",
      'decided value s === "a"',
      "escaped reflect Object.assign(this, { saving: true })",
    ]);
  });

  it("lists nothing in a file whose imports do not reach a stated type", () => {
    const found = flowsOf({
      "ids.ts": `import type { Opaque } from "./guarantees";
export type OrderId = Opaque<string, "OrderId">;
`,
      "other.ts": `declare function get<T>(url: string): T;
export const name: string = get<string>("/x");
export const value = (x: unknown): string => x as string;
`,
    });
    expect(found.get("other.ts")).toEqual([]);
  });

  it("stops at its budget, with one flow at the place for each stated declaration", () => {
    const found = flowsOf(
      {
        "ids.ts": `import type { Opaque } from "./guarantees";
export type OrderId = Opaque<string, "OrderId">;
`,
        "a.ts": `import type { OrderId } from "./ids";
export const a: OrderId = "o-1";
export const b: OrderId = "o-2";
`,
      },
      0,
    );
    const list = found.get("a.ts") ?? [];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((one) => one.includes(" stopped "))).toBe(true);
  });

  it("reads a flow where the scan stopped as not checked, whatever a rule marks", () => {
    const ref: LedgerRef = {
      id: "a.ts#10-20",
      declaration: "ids.ts#0",
      name: "OrderId",
      marker: "Opaque",
      trait: "opaque",
      form: "produced",
      via: "stopped",
      location: { file: "a.ts", start: 10, end: 20 },
      text: "a = 1",
    };
    const guarantee: StatedGuarantee = {
      guarantee: "opaque",
      source: { kind: "marker" },
      marker: "Opaque",
      name: "OrderId",
      declaration: "ids.ts#0",
      location: { file: "ids.ts", start: 0, end: 10 },
      ruleId: "ownership/brand-built-outside-owner",
      promise: "",
      covers: { one: "builder", many: "builders" },
      covered: [],
    };
    const ledger = indexLedger({
      traits: ["opaque"],
      refs: [ref],
      marks: [
        {
          ruleId: guarantee.ruleId,
          ref: ref.id,
          trait: "opaque",
          outcome: { kind: "decided" },
        },
      ],
    });
    expect(ledger.uncheckedOf(guarantee, [ref])).toEqual([
      { location: ref.location, reason: stoppedReason(ref) },
    ]);
  });
});
