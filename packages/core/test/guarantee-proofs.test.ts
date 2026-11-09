import { describe, expect, it } from "vitest";
import { counted, describeStatus, guaranteeAt, proveGuarantees } from "../src/guarantees.js";
import type { Finding, StatedGuarantee } from "../src/types.js";

const RULE = "react-context/provider-missing";

function stated(name: string, start: number, covered: number): StatedGuarantee {
  return {
    guarantee: "required-context",
    marker: "RequiredContext",
    name,
    location: { file: "/p/src/theme.ts", start, end: start + 10 },
    ruleId: RULE,
    promise: "every reader is rendered under its Provider",
    covers: { one: "reader", many: "readers" },
    covered: Array.from({ length: covered }, (_, i) => ({
      name: `<Reader${String(i)}>`,
      location: { file: "/p/src/app.tsx", start: i * 10, end: i * 10 + 5 },
    })),
  };
}

function error(
  at: number,
  noteAt: number,
  ruleId = RULE,
  severity: "error" | "info" = "error",
): Finding {
  return {
    kind: "problem",
    ruleId,
    severity,
    message: `missing at ${String(at)}`,
    hint: "h",
    location: { file: "/p/src/app.tsx", start: at, end: at + 1 },
    related: [
      {
        location: { file: "/p/src/theme.ts", start: noteAt, end: noteAt + 10 },
        message: "stated here",
      },
    ],
    fixes: [],
  };
}

describe("proveGuarantees", () => {
  const all = new Set([RULE]);

  it("counts the errors of its rule that name the declaration, and nothing else", () => {
    const proofs = proveGuarantees(
      [stated("Auth", 50, 1), stated("Theme", 0, 3)],
      [error(30, 0), error(10, 0), error(20, 50, "other/rule"), error(40, 0, RULE, "info")],
      all,
    );
    expect(proofs.map((proof) => [proof.stated.name, describeStatus(proof)])).toEqual([
      ["Theme", "not proven: 2 errors"],
      ["Auth", "proven for 1 reader"],
    ]);
    const first = proofs[0]?.status;
    expect(first?.kind === "unproven" ? first.errors.map((e) => e.location.start) : []).toEqual([
      10, 30,
    ]);
  });

  it("counts an error with no note at a declaration by the covered place it lies in", () => {
    // Theme covers app.tsx 0–5, 10–15, 20–25; Auth covers 0–5 as well.
    const unnamed = (at: number): Finding => {
      const found = error(at, 0);
      return found.kind === "problem" ? { ...found, related: [] } : found;
    };
    const proofs = proveGuarantees(
      [stated("Auth", 50, 1), stated("Theme", 0, 3)],
      [unnamed(21), unnamed(31), error(1, 50)],
      all,
    );
    expect(
      proofs.map((proof) => [
        proof.stated.name,
        proof.status.kind === "unproven" ? proof.status.errors.map((e) => e.location.start) : [],
      ]),
    ).toEqual([
      // 21 lies in a place only Theme covers; 31 in none; 1 names Auth, though Theme covers it too.
      ["Theme", [21]],
      ["Auth", [1]],
    ]);
  });

  it("says a marker nothing uses is unused, and one whose rule is not on is not checked", () => {
    expect(proveGuarantees([stated("Theme", 0, 0)], [], all).map(describeStatus)).toEqual([
      "unused: no reader, so nothing to prove; use it or drop the marker",
    ]);
    expect(proveGuarantees([stated("Theme", 0, 2)], [], new Set()).map(describeStatus)).toEqual([
      `not checked: ${RULE} is not on`,
    ]);
  });

  it("finds the guarantee whose declaration holds an offset", () => {
    const proofs = proveGuarantees([stated("Theme", 0, 1), stated("Auth", 50, 1)], [], all);
    expect(guaranteeAt(proofs, "/p/src/theme.ts", 55)?.stated.name).toBe("Auth");
    expect(guaranteeAt(proofs, "/p/src/theme.ts", 30)).toBeUndefined();
    expect(guaranteeAt(proofs, "/p/src/app.tsx", 5)).toBeUndefined();
  });
});

describe("counted", () => {
  it("writes the noun in the form the count takes, as the noun gives it: never by adding an s", () => {
    const noun = { one: "switch", many: "switches" };
    expect([0, 1, 2].map((count) => counted(count, noun))).toEqual([
      "0 switches",
      "1 switch",
      "2 switches",
    ]);
    const one = { ...stated("Status", 0, 1), covers: noun };
    expect(proveGuarantees([one], [], new Set([RULE])).map(describeStatus)).toEqual([
      "proven for 1 switch",
    ]);
  });
});
